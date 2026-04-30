from pathlib import Path
from functools import lru_cache

from pydantic_settings import BaseSettings
from pydantic_settings import SettingsConfigDict

environment_file_path = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/crna_scheduler"
    redis_url: str = "redis://localhost:6379/0"
    environment: str = "development"
    local_organization_name: str = "Local Scheduling Organization"

    model_config = SettingsConfigDict(
        env_file=environment_file_path,
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    return settings
