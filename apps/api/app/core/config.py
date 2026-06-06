from pathlib import Path
from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices
from pydantic import EmailStr
from pydantic import Field
from pydantic import field_validator
from pydantic import SecretStr
from pydantic_settings import BaseSettings
from pydantic_settings import SettingsConfigDict

environment_file_path = Path(__file__).resolve().parent.parent / ".env"

AuthMode = Literal["local", "clerk"]


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/crna_scheduler"
    redis_url: str = "redis://localhost:6379/0"
    environment: str = "development"
    local_organization_name: str = "Local Scheduling Organization"
    auth_mode: AuthMode = "clerk"
    clerk_secret_key: SecretStr | None = None
    clerk_publishable_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "CLERK_PUBLISHABLE_KEY",
            "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
        ),
    )
    clerk_frontend_api_url: str | None = None
    clerk_jwks_url: str | None = None
    clerk_jwt_key: SecretStr | None = None
    clerk_pem_public_key: SecretStr | None = None
    clerk_authorized_parties: str = (
        "http://localhost:3000,"
        "http://127.0.0.1:3000,"
        "http://localhost:3001,"
        "http://127.0.0.1:3001"
    )
    provider_portal_base_url: str | None = None
    gmail_service_account_json: SecretStr | None = None
    gmail_sender_email: EmailStr | None = None

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

    @field_validator("auth_mode", mode="before")
    @classmethod
    def normalize_auth_mode(cls, auth_mode: object) -> object:
        if not isinstance(auth_mode, str):
            return auth_mode

        normalized_auth_mode = auth_mode.strip().lower()
        return normalized_auth_mode

    @field_validator("clerk_frontend_api_url", "clerk_jwks_url", "provider_portal_base_url", mode="before")
    @classmethod
    def normalize_optional_url(cls, url: object) -> object:
        if not isinstance(url, str):
            return url

        normalized_url = url.strip().rstrip("/")
        return normalized_url

    def clerk_authorized_party_list(self) -> list[str]:
        party_values = self.clerk_authorized_parties.split(",")
        normalized_parties = [
            party.strip().rstrip("/")
            for party in party_values
            if party.strip() != ""
        ]
        return normalized_parties


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    return settings
