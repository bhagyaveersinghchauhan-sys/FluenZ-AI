import json
import logging
import time
from collections import deque
from datetime import timedelta
from typing import Literal
from uuid import uuid4

from aiohttp import ClientTimeout
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from livekit import api
from pydantic import BaseModel, ConfigDict, Field

from .config import Settings, get_settings
from .scenarios import SessionOptions

logger = logging.getLogger("fluenz.api")


class SessionRateLimiter:
    def __init__(
        self,
        max_requests: int = 10,
        window_seconds: float = 60,
        max_clients: int = 1024,
    ) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.max_clients = max_clients
        self.requests: dict[str, deque[float]] = {}

    def allow(self, client: str, now: float | None = None) -> bool:
        current = time.monotonic() if now is None else now
        for address, timestamps in list(self.requests.items()):
            while timestamps and current - timestamps[0] >= self.window_seconds:
                timestamps.popleft()
            if not timestamps:
                del self.requests[address]

        timestamps = self.requests.get(client)
        if timestamps is None:
            if len(self.requests) >= self.max_clients:
                return False
            timestamps = self.requests[client] = deque()
        if len(timestamps) >= self.max_requests:
            return False
        timestamps.append(current)
        return True


class SessionRequest(SessionOptions):
    model_config = ConfigDict(extra="forbid")

    lesson: Literal["core"] = "core"


class SessionMetadata(SessionOptions):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    lesson: Literal["core"] = "core"
    learner_identity: str = Field(pattern=r"^learner-[0-9a-f]{32}$")


class SessionResponse(BaseModel):
    server_url: str
    room: str
    token: str


def issue_room_token(settings: Settings, room: str, identity: str) -> str:
    if not settings.livekit_configured:
        raise ValueError("LiveKit server settings are not configured")
    if not room.startswith("fluenz-") or not identity.startswith("learner-"):
        raise ValueError("Room and participant identity must be server generated")

    assert settings.livekit_api_key is not None
    assert settings.livekit_api_secret is not None
    grants = api.VideoGrants(
        room_join=True,
        room=room,
        can_publish=True,
        can_publish_sources=["microphone"],
        can_subscribe=True,
        can_publish_data=True,
        can_update_own_metadata=False,
    )
    return (
        api.AccessToken(
            settings.livekit_api_key.get_secret_value(),
            settings.livekit_api_secret.get_secret_value(),
        )
        .with_identity(identity)
        .with_name("FluenZ learner")
        .with_ttl(timedelta(seconds=settings.livekit_token_ttl_seconds))
        .with_grants(grants)
        .to_jwt()
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    configured = settings or get_settings()
    session_rate_limiter = SessionRateLimiter()
    app = FastAPI(title="FluenZ API", version="1.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=configured.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.get("/")
    async def root() -> dict[str, str]:
        return {"service": "FluenZ API", "health": "/health"}

    @app.get("/health")
    async def health() -> dict[str, str | bool]:
        if not configured.livekit_configured:
            return {
                "status": "degraded",
                "livekit_configured": False,
                "livekit_api_reachable": False,
                "message": (
                    "Live voice is unavailable; configure "
                    + ", ".join(configured.missing_livekit_settings())
                    + " in services/agent/.env."
                ),
            }

        assert configured.livekit_api_key is not None
        assert configured.livekit_api_secret is not None
        try:
            async with api.LiveKitAPI(
                configured.livekit_url,
                configured.livekit_api_key.get_secret_value(),
                configured.livekit_api_secret.get_secret_value(),
                timeout=ClientTimeout(total=3),
            ) as livekit:
                await livekit.room.list_rooms(api.ListRoomsRequest())
        except Exception as exc:
            logger.warning("LiveKit health check failed (%s)", type(exc).__name__)
            return {
                "status": "degraded",
                "livekit_configured": True,
                "livekit_api_reachable": False,
                "message": (
                    "LiveKit API check failed. Verify LIVEKIT_URL, LIVEKIT_API_KEY, "
                    "LIVEKIT_API_SECRET, and network connectivity."
                ),
            }

        return {
            "status": "ok",
            "livekit_configured": True,
            "livekit_api_reachable": True,
            "message": (
                "LiveKit API is reachable. Agent availability and inference model access "
                "are not verified by this check."
            ),
        }

    @app.post("/api/sessions", response_model=SessionResponse)
    async def create_session(
        session_request: SessionRequest,
        request: Request,
    ) -> SessionResponse:
        client = request.client.host if request.client is not None else "unknown"
        if not session_rate_limiter.allow(client):
            raise HTTPException(
                status_code=429,
                detail="Too many session requests. Wait a minute and try again.",
            )

        missing = configured.missing_livekit_settings()
        if missing:
            raise HTTPException(
                status_code=503,
                detail="Live voice is not configured. Set " + ", ".join(missing) + ".",
            )

        room_name = f"fluenz-{uuid4().hex}"
        learner_identity = f"learner-{uuid4().hex}"
        metadata = SessionMetadata(
            **session_request.model_dump(),
            learner_identity=learner_identity,
        ).model_dump_json()
        try:
            token = issue_room_token(configured, room_name, learner_identity)
            assert configured.livekit_api_key is not None
            assert configured.livekit_api_secret is not None
            async with api.LiveKitAPI(
                configured.livekit_url,
                configured.livekit_api_key.get_secret_value(),
                configured.livekit_api_secret.get_secret_value(),
            ) as livekit:
                await livekit.agent_dispatch.create_dispatch(
                    api.CreateAgentDispatchRequest(
                        agent_name=configured.livekit_agent_name,
                        room=room_name,
                        metadata=metadata,
                    )
                )
        except Exception as exc:
            logger.warning("LiveKit dispatch failed (%s)", type(exc).__name__)
            raise HTTPException(
                status_code=503,
                detail="Live voice service is unavailable. Please try again.",
            ) from None

        return SessionResponse(
            server_url=configured.livekit_url,
            room=room_name,
            token=token,
        )

    return app


app = create_app()
