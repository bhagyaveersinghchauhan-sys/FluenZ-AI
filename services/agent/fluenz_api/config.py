from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parents[1]
SERVICE_ENV_FILE = SERVICE_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=SERVICE_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        hide_input_in_errors=True,
    )

    livekit_url: str = ""
    livekit_api_key: SecretStr | None = None
    livekit_api_secret: SecretStr | None = None
    livekit_agent_name: str = "fluenz-tutor"
    livekit_token_ttl_seconds: int = 600
    livekit_stt_model: str = "assemblyai/universal-3-6-pro"
    livekit_llm_model: str = "google/gemma-4-31b-it"
    livekit_tts_model: str = "cartesia/sonic-3"
    livekit_tts_voice: str = "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
    fluency_pause_threshold_seconds: float = 1.5
    cors_origins: str = "http://localhost:5173"

    @field_validator("livekit_url")
    @classmethod
    def validate_livekit_url(cls, value: str) -> str:
        value = value.strip()
        if not value:
            return value
        parsed = urlsplit(value)
        if parsed.scheme not in {"wss", "ws"} or not parsed.hostname:
            raise ValueError("LIVEKIT_URL must be a LiveKit ws:// or wss:// URL")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("LIVEKIT_URL must not contain credentials or query parameters")
        return value.rstrip("/")

    @field_validator("livekit_agent_name")
    @classmethod
    def validate_agent_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or len(normalized) > 64:
            raise ValueError("LIVEKIT_AGENT_NAME must contain 1 to 64 characters")
        return normalized

    @field_validator("livekit_token_ttl_seconds")
    @classmethod
    def validate_token_ttl(cls, value: int) -> int:
        if not 60 <= value <= 900:
            raise ValueError("LIVEKIT_TOKEN_TTL_SECONDS must be between 60 and 900")
        return value

    @field_validator("fluency_pause_threshold_seconds")
    @classmethod
    def validate_fluency_pause_threshold(cls, value: float) -> float:
        if not 0.5 <= value <= 5:
            raise ValueError("FLUENCY_PAUSE_THRESHOLD_SECONDS must be between 0.5 and 5")
        return value

    @field_validator("cors_origins")
    @classmethod
    def validate_cors_origins(cls, value: str) -> str:
        origins = [origin.strip() for origin in value.split(",") if origin.strip()]
        if not origins or "*" in origins:
            raise ValueError("CORS_ORIGINS must contain explicit browser origins, not *")
        for origin in origins:
            parsed = urlsplit(origin)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                raise ValueError("CORS_ORIGINS must contain valid http:// or https:// origins")
            if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
                raise ValueError("CORS_ORIGINS entries must be origins without paths or queries")
        return ",".join(origins)

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]

    @property
    def livekit_configured(self) -> bool:
        return bool(
            self.livekit_url
            and self.livekit_api_key
            and self.livekit_api_key.get_secret_value().strip()
            and self.livekit_api_secret
            and self.livekit_api_secret.get_secret_value().strip()
        )

    def missing_livekit_settings(self) -> list[str]:
        missing: list[str] = []
        if not self.livekit_url:
            missing.append("LIVEKIT_URL")
        if not self.livekit_api_key or not self.livekit_api_key.get_secret_value().strip():
            missing.append("LIVEKIT_API_KEY")
        if not self.livekit_api_secret or not self.livekit_api_secret.get_secret_value().strip():
            missing.append("LIVEKIT_API_SECRET")
        return missing


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
