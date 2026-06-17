from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    api_token: str | None = Field(default=None, alias="CODEX_API_TOKEN")
    google_api_key: str | None = Field(default=None, alias="GOOGLE_API_KEY")
    gemini_model: str = Field(default="gemini-3.1-flash-live-preview", alias="GEMINI_MODEL")
    gemini_live_compression_trigger_tokens: int = Field(
        default=25_000, alias="GEMINI_LIVE_COMPRESSION_TRIGGER_TOKENS"
    )
    gemini_live_compression_target_tokens: int = Field(
        default=10_000, alias="GEMINI_LIVE_COMPRESSION_TARGET_TOKENS"
    )
    gemini_text_model: str = Field(default="gemini-2.5-flash", alias="GEMINI_TEXT_MODEL")
    gemini_voice_name: str = Field(default="Aoede", alias="GEMINI_VOICE_NAME")
    gemini_language_code: str = Field(default="en-US", alias="GEMINI_LANGUAGE_CODE")
    max_audio_bytes: int = Field(default=2_000_000, alias="MAX_AUDIO_BYTES")
    codex_default_workdir: str = Field(default=str(ROOT), alias="CODEX_DEFAULT_WORKDIR")
    codex_approval_mode: str = Field(default="auto-review", alias="CODEX_APPROVAL_MODE")
    codex_sandbox_mode: str = Field(default="workspace-write", alias="CODEX_SANDBOX_MODE")
    codex_auto_checkpoint: bool = Field(default=False, alias="CODEX_AUTO_CHECKPOINT")
    data_dir: Path = Field(default=ROOT / "backend" / "data", alias="DATA_DIR")
    history_file: str = Field(default="history.json", alias="HISTORY_FILE")

    @property
    def history_path(self) -> Path:
        return self.data_dir / self.history_file


@lru_cache
def get_settings() -> Settings:
    return Settings()
