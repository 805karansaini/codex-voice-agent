from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    google_api_key: str | None = Field(default=None, alias="GOOGLE_API_KEY")
    gemini_model: str = Field(default="gemini-3.1-flash-live-preview", alias="GEMINI_MODEL")
    codex_default_workdir: str = Field(default=str(Path.home()), alias="CODEX_DEFAULT_WORKDIR")
    codex_approval_mode: str = Field(default="never", alias="CODEX_APPROVAL_MODE")
    codex_sandbox_mode: str = Field(default="danger-full-access", alias="CODEX_SANDBOX_MODE")
    history_path: Path = ROOT / "backend" / "data" / "history.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
