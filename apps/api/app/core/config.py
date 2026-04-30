from pathlib import Path
from functools import lru_cache

from pydantic import field_validator
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

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, database_url: str) -> str:
        postgres_scheme = "postgres://"
        postgresql_scheme = "postgresql://"
        psycopg_scheme = "postgresql+psycopg://"

        if database_url.startswith(psycopg_scheme):
            normalized_database_url = database_url
            return normalized_database_url

        if database_url.startswith(postgres_scheme):
            normalized_database_url = database_url.replace(postgres_scheme, psycopg_scheme, 1)
            return normalized_database_url

        if database_url.startswith(postgresql_scheme):
            normalized_database_url = database_url.replace(postgresql_scheme, psycopg_scheme, 1)
            return normalized_database_url

        normalized_database_url = database_url
        return normalized_database_url


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    return settings
