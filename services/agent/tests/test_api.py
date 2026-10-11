import json
import time
from pathlib import Path

import jwt
import pytest
from fastapi.testclient import TestClient
from livekit import api
from pydantic import ValidationError

from fluenz_api.config import SERVICE_ENV_FILE, Settings
from fluenz_api.main import (
    SessionMetadata,
    SessionRateLimiter,
    SessionRequest,
    create_app,
    issue_room_token,
)


def make_settings(**overrides: object) -> Settings:
    return Settings(
        _env_file=None,
        livekit_url="wss://test.livekit.cloud",
        livekit_api_key="test-api-key-long-enough-for-hmac",
        livekit_api_secret="test-api-secret-long-enough-for-hmac",
        **overrides,
    )


def make_unconfigured_settings(**overrides: object) -> Settings:
    return Settings(_env_file=None, **overrides)


def test_health_is_safe_when_livekit_is_not_configured() -> None:
    response = TestClient(create_app(make_unconfigured_settings())).get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "degraded",
        "livekit_configured": False,
        "livekit_api_reachable": False,
        "message": (
            "Live voice is unavailable; configure LIVEKIT_URL, LIVEKIT_API_KEY, "
            "LIVEKIT_API_SECRET in services/agent/.env."
        ),
    }


def test_root_endpoint_points_to_health() -> None:
    response = TestClient(create_app(Settings())).get("/")

    assert response.status_code == 200
    assert response.json() == {"service": "FluenZ API", "health": "/health"}


def test_health_names_each_missing_livekit_variable() -> None:
    settings = make_unconfigured_settings(
        livekit_url="wss://test.livekit.cloud",
        livekit_api_key="test-api-key",
    )
    response = TestClient(create_app(settings)).get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "degraded"
    assert "LIVEKIT_API_SECRET" in response.json()["message"]
    assert "LIVEKIT_URL" not in response.json()["message"]
    assert "LIVEKIT_API_KEY" not in response.json()["message"]


def test_configured_health_checks_livekit_api(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = make_settings()

    class FakeRoomService:
        async def list_rooms(self, _request: api.ListRoomsRequest) -> None:
            return None

    class FakeLiveKit:
        room = FakeRoomService()

        async def __aenter__(self) -> "FakeLiveKit":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

    monkeypatch.setattr(
        "fluenz_api.main.api.LiveKitAPI",
        lambda *_args, **_kwargs: FakeLiveKit(),
    )
    response = TestClient(create_app(settings)).get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "livekit_configured": True,
        "livekit_api_reachable": True,
        "message": (
            "LiveKit API is reachable. Agent availability and inference model access "
            "are not verified by this check."
        ),
    }


def test_configured_health_degrades_when_livekit_api_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class UnavailableLiveKit:
        async def __aenter__(self) -> "UnavailableLiveKit":
            raise ConnectionError("private transport detail")

        async def __aexit__(self, *_args: object) -> None:
            return None

    monkeypatch.setattr(
        "fluenz_api.main.api.LiveKitAPI",
        lambda *_args, **_kwargs: UnavailableLiveKit(),
    )
    response = TestClient(create_app(make_settings())).get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "degraded"
    assert response.json()["livekit_configured"] is True
    assert response.json()["livekit_api_reachable"] is False
    assert "LIVEKIT_URL" in response.json()["message"]
    assert "LIVEKIT_API_KEY" in response.json()["message"]
    assert "LIVEKIT_API_SECRET" in response.json()["message"]
    assert "private transport detail" not in response.text


def test_settings_load_exact_names_from_service_env_file_outside_cwd(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected_path = SERVICE_ENV_FILE
    assert expected_path.is_absolute()
    assert Settings.model_config["env_file"] == expected_path

    for name in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"):
        monkeypatch.delenv(name, raising=False)

    service_dir = tmp_path / "services" / "agent"
    service_dir.mkdir(parents=True)
    env_file = service_dir / ".env"
    env_file.write_text(
        "LIVEKIT_URL=wss://configured.livekit.cloud\n"
        "LIVEKIT_API_KEY=test-api-key\n"
        "LIVEKIT_API_SECRET=test-api-secret\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setitem(Settings.model_config, "env_file", env_file)

    settings = Settings()

    assert settings.livekit_url == "wss://configured.livekit.cloud"
    assert settings.livekit_api_key is not None
    assert settings.livekit_api_secret is not None
    assert settings.livekit_configured


def test_invalid_livekit_url_names_setting_without_echoing_value() -> None:
    unsafe_url = "https://user:private-value@example.invalid"

    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, livekit_url=unsafe_url)

    diagnostic = str(error.value)
    assert "LIVEKIT_URL must be a LiveKit ws:// or wss:// URL" in diagnostic
    assert unsafe_url not in diagnostic
    assert "private-value" not in diagnostic


def test_session_requires_livekit_configuration() -> None:
    response = TestClient(create_app(make_unconfigured_settings())).post(
        "/api/sessions",
        json={"lesson": "core"},
    )
    assert response.status_code == 503
    assert "LIVEKIT_API_SECRET" in response.json()["detail"]
    assert "test-secret" not in response.text


def test_session_response_binds_token_and_agent_dispatch_to_new_room(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = make_settings()

    class FakeAgentDispatch:
        request: api.CreateAgentDispatchRequest | None = None

        async def create_dispatch(self, request: api.CreateAgentDispatchRequest) -> None:
            self.request = request

    class FakeLiveKit:
        def __init__(self) -> None:
            self.agent_dispatch = FakeAgentDispatch()

        async def __aenter__(self) -> "FakeLiveKit":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

    fake_livekit = FakeLiveKit()
    monkeypatch.setattr(
        "fluenz_api.main.api.LiveKitAPI",
        lambda *_args, **_kwargs: fake_livekit,
    )
    response = TestClient(create_app(settings)).post("/api/sessions", json={"lesson": "core"})

    assert response.status_code == 200
    session = response.json()
    claims = jwt.decode(session["token"], options={"verify_signature": False})
    assert claims["video"]["room"] == session["room"]
    assert session["room"].startswith("fluenz-")
    assert fake_livekit.agent_dispatch.request is not None
    dispatch = fake_livekit.agent_dispatch.request
    assert dispatch.room == session["room"]
    assert dispatch.agent_name == settings.livekit_agent_name
    metadata = json.loads(dispatch.metadata)
    assert metadata["learner_identity"] == claims["sub"]


def test_session_request_rejects_room_or_identity_overrides() -> None:
    client = TestClient(create_app(make_unconfigured_settings()))
    response = client.post(
        "/api/sessions",
        json={"lesson": "core", "room": "someone-else", "identity": "victim"},
    )
    assert response.status_code == 422


def test_session_request_rejects_prompt_key_for_another_scenario() -> None:
    response = TestClient(create_app(make_unconfigured_settings())).post(
        "/api/sessions",
        json={
            "scenario": "shop",
            "prompt_key": "cafe_menu",
            "ui_language": "en",
            "voice_key": "default",
        },
    )
    assert response.status_code == 422


def test_session_options_are_validated_and_copied_into_agent_metadata() -> None:
    request = SessionRequest(
        scenario="custom",
        custom_scenario="  at a park  ",
        prompt_key="custom_clarify",
        ui_language="hi",
        voice_key="default",
    )
    metadata = SessionMetadata(
        **request.model_dump(),
        learner_identity="learner-" + "a" * 32,
    )
    serialized = json.loads(metadata.model_dump_json())

    assert serialized["scenario"] == "custom"
    assert serialized["custom_scenario"] == "at a park"
    assert serialized["prompt_key"] == "custom_clarify"
    assert serialized["ui_language"] == "hi"
    assert serialized["voice_key"] == "default"


def test_session_endpoint_dispatches_validated_custom_scenario_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeAgentDispatch:
        request: api.CreateAgentDispatchRequest | None = None

        async def create_dispatch(self, request: api.CreateAgentDispatchRequest) -> None:
            self.request = request

    class FakeLiveKit:
        def __init__(self) -> None:
            self.agent_dispatch = FakeAgentDispatch()

        async def __aenter__(self) -> "FakeLiveKit":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

    livekit = FakeLiveKit()
    monkeypatch.setattr(
        "fluenz_api.main.api.LiveKitAPI",
        lambda *_args, **_kwargs: livekit,
    )
    response = TestClient(create_app(make_settings())).post(
        "/api/sessions",
        json={
            "scenario": "custom",
            "custom_scenario": "  at a park  ",
            "ui_language": "hi",
            "voice_key": "default",
        },
    )

    assert response.status_code == 200
    assert livekit.agent_dispatch.request is not None
    metadata = json.loads(livekit.agent_dispatch.request.metadata)
    assert metadata["scenario"] == "custom"
    assert metadata["custom_scenario"] == "at a park"
    assert metadata["ui_language"] == "hi"
    assert metadata["voice_key"] == "default"


@pytest.mark.parametrize(
    "request_data",
    [
        {"ui_language": "fr"},
        {"voice_key": "arbitrary-provider-voice"},
        {"scenario": "not-a-scenario"},
        {"scenario": "custom"},
        {"custom_scenario": "unpaired custom text"},
        {"scenario": "custom", "custom_scenario": " "},
        {"scenario": "custom", "custom_scenario": "x" * 201},
    ],
)
def test_session_request_rejects_invalid_options(request_data: dict[str, str]) -> None:
    with pytest.raises(ValidationError):
        SessionRequest(**request_data)


def test_signed_token_is_short_lived_and_limited_to_one_room() -> None:
    settings = make_settings()
    room = "fluenz-" + "a" * 32
    identity = "learner-" + "b" * 32
    token = issue_room_token(settings, room, identity)
    claims = jwt.decode(token, options={"verify_signature": False})
    grants = claims["video"]

    assert claims["sub"] == identity
    assert 0 < claims["exp"] - time.time() <= 600
    assert grants["room"] == room
    assert grants["roomJoin"] is True
    assert grants["canSubscribe"] is True
    assert grants["canPublish"] is True
    assert grants["canPublishSources"] == ["microphone"]
    assert grants["canPublishData"] is True
    assert grants.get("roomAdmin", False) is False
    assert grants.get("roomCreate", False) is False


@pytest.mark.parametrize(
    "values",
    [
        {"livekit_url": "https://test.livekit.cloud"},
        {"livekit_url": "wss://user:password@test.livekit.cloud"},
        {"cors_origins": "*"},
    ],
)
def test_settings_reject_unsafe_values(values: dict[str, str]) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **values)


def test_livekit_sdk_token_grants_accept_microphone_source() -> None:
    grant = api.VideoGrants(
        room_join=True,
        room="fluenz-demo",
        can_publish_sources=["microphone"],
        can_publish_data=True,
    )
    assert grant.room == "fluenz-demo"
    assert grant.can_publish_sources == ["microphone"]
    assert grant.can_publish_data is True


def test_session_rate_limiter_expires_old_requests_and_caps_clients() -> None:
    limiter = SessionRateLimiter(max_requests=2, window_seconds=60, max_clients=1)

    assert limiter.allow("127.0.0.1", now=100)
    assert limiter.allow("127.0.0.1", now=110)
    assert not limiter.allow("127.0.0.1", now=120)
    assert limiter.allow("127.0.0.1", now=160)
    assert not limiter.allow("192.0.2.1", now=160)
