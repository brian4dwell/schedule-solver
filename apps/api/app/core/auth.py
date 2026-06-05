import base64
import binascii
from functools import lru_cache

import jwt
from fastapi import HTTPException
from jwt import InvalidTokenError
from jwt import PyJWKClient
from jwt import PyJWKClientError
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import field_validator

from app.core.config import Settings

CLERK_SESSION_ALGORITHM = "RS256"
CLERK_ORGANIZATION_ADMIN_ROLE = "org:admin"
SCHEDULE_SOLVER_ADMIN_ROLE = "admin"
CLERK_PENDING_SESSION_STATUS = "pending"
CLERK_PUBLISHABLE_KEY_PART_COUNT = 3


def normalize_clerk_roles_claim(value: object) -> object:
    roles_claim_is_missing = value is None

    if roles_claim_is_missing:
        return []

    return value


class ClerkPublicMetadata(BaseModel):
    role: str | None = None
    roles: list[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="ignore")

    @field_validator("roles", mode="before")
    @classmethod
    def normalize_roles(cls, value: object) -> object:
        roles = normalize_clerk_roles_claim(value)
        return roles


class ClerkSessionClaims(BaseModel):
    sub: str
    sid: str | None = None
    azp: str | None = None
    iss: str | None = None
    org_id: str | None = None
    org_role: str | None = None
    role: str | None = None
    roles: list[str] = Field(default_factory=list)
    public_metadata: ClerkPublicMetadata | None = None
    sts: str | None = None

    model_config = ConfigDict(extra="ignore")

    @field_validator("roles", mode="before")
    @classmethod
    def normalize_roles(cls, value: object) -> object:
        roles = normalize_clerk_roles_claim(value)
        return roles


class AuthenticatedUser(BaseModel):
    user_id: str
    session_id: str | None = None
    organization_external_id: str | None = None
    organization_role: str | None = None
    role: str | None = None
    roles: list[str] = Field(default_factory=list)


def authorization_header_token(authorization: str | None) -> str | None:
    if authorization is None:
        return None

    bearer_prefix = "Bearer "
    has_bearer_prefix = authorization.startswith(bearer_prefix)

    if not has_bearer_prefix:
        return None

    token = authorization.removeprefix(bearer_prefix).strip()
    token_is_empty = token == ""

    if token_is_empty:
        return None

    return token


def session_token_from_request(
    authorization: str | None,
    session_cookie: str | None,
) -> str:
    header_token = authorization_header_token(authorization)
    has_header_token = header_token is not None

    if has_header_token:
        return header_token

    has_session_cookie = session_cookie is not None

    if has_session_cookie:
        return session_cookie

    raise HTTPException(status_code=401, detail="Authentication required")


def authenticated_user_from_claims(claims: ClerkSessionClaims) -> AuthenticatedUser:
    metadata_roles = []

    if claims.public_metadata is not None:
        metadata_roles = claims.public_metadata.roles

    roles = [*claims.roles, *metadata_roles]
    user = AuthenticatedUser(
        user_id=claims.sub,
        session_id=claims.sid,
        organization_external_id=claims.org_id,
        organization_role=claims.org_role,
        role=claims.role,
        roles=roles,
    )
    return user


def user_has_admin_role(user: AuthenticatedUser) -> bool:
    has_organization_admin_role = user.organization_role == CLERK_ORGANIZATION_ADMIN_ROLE
    has_schedule_solver_admin_role = user.role == SCHEDULE_SOLVER_ADMIN_ROLE
    has_schedule_solver_admin_roles = SCHEDULE_SOLVER_ADMIN_ROLE in user.roles
    has_admin_role = (
        has_organization_admin_role
        or has_schedule_solver_admin_role
        or has_schedule_solver_admin_roles
    )
    return has_admin_role


def normalized_public_key(public_key: str) -> str:
    normalized_key = public_key.replace("\\n", "\n")
    return normalized_key


def jwks_url_from_frontend_api_url(frontend_api_url: str) -> str:
    normalized_frontend_api_url = frontend_api_url.rstrip("/")
    jwks_url = f"{normalized_frontend_api_url}/.well-known/jwks.json"
    return jwks_url


def base64_padding(encoded_value: str) -> str:
    padding_remainder = len(encoded_value) % 4
    needs_padding = padding_remainder != 0

    if not needs_padding:
        return ""

    padding_length = 4 - padding_remainder
    padding = "=" * padding_length
    return padding


def frontend_api_url_from_publishable_key(publishable_key: str) -> str:
    key_parts = publishable_key.split("_", 2)
    has_expected_parts = len(key_parts) == CLERK_PUBLISHABLE_KEY_PART_COUNT

    if not has_expected_parts:
        raise HTTPException(status_code=500, detail="Clerk publishable key is invalid")

    encoded_frontend_api = key_parts[2]
    encoded_padding = base64_padding(encoded_frontend_api)
    padded_frontend_api = f"{encoded_frontend_api}{encoded_padding}"
    try:
        decoded_bytes = base64.b64decode(padded_frontend_api)
        decoded_text = decoded_bytes.decode("utf-8")
    except (binascii.Error, UnicodeDecodeError) as error:
        raise HTTPException(status_code=500, detail="Clerk publishable key is invalid") from error

    frontend_api_host = decoded_text.rstrip("$")
    frontend_api_url = f"https://{frontend_api_host}"
    return frontend_api_url


def configured_frontend_api_url(settings: Settings) -> str | None:
    if settings.clerk_frontend_api_url is not None:
        return settings.clerk_frontend_api_url

    if settings.clerk_publishable_key is not None:
        frontend_api_url = frontend_api_url_from_publishable_key(
            settings.clerk_publishable_key,
        )
        return frontend_api_url

    return None


@lru_cache
def jwks_client(jwks_url: str) -> PyJWKClient:
    client = PyJWKClient(jwks_url)
    return client


def public_verification_key(settings: Settings) -> str | None:
    jwt_key = settings.clerk_jwt_key
    pem_public_key = settings.clerk_pem_public_key

    if jwt_key is not None:
        public_key = jwt_key.get_secret_value()
        normalized_key = normalized_public_key(public_key)
        return normalized_key

    if pem_public_key is not None:
        public_key = pem_public_key.get_secret_value()
        normalized_key = normalized_public_key(public_key)
        return normalized_key

    return None


def configured_jwks_url(settings: Settings) -> str | None:
    if settings.clerk_jwks_url is not None:
        return settings.clerk_jwks_url

    frontend_api_url = configured_frontend_api_url(settings)

    if frontend_api_url is not None:
        jwks_url = jwks_url_from_frontend_api_url(frontend_api_url)
        return jwks_url

    return None


def token_issuer(settings: Settings) -> str | None:
    issuer = configured_frontend_api_url(settings)
    return issuer


def verify_with_public_key(token: str, public_key: str, settings: Settings) -> ClerkSessionClaims:
    issuer = token_issuer(settings)
    decoded_claims = jwt.decode(
        token,
        public_key,
        algorithms=[CLERK_SESSION_ALGORITHM],
        issuer=issuer,
        options={"verify_aud": False},
    )
    claims = ClerkSessionClaims.model_validate(decoded_claims)
    return claims


def verify_with_jwks(token: str, jwks_url: str, settings: Settings) -> ClerkSessionClaims:
    issuer = token_issuer(settings)
    client = jwks_client(jwks_url)
    signing_key = client.get_signing_key_from_jwt(token)
    decoded_claims = jwt.decode(
        token,
        signing_key.key,
        algorithms=[CLERK_SESSION_ALGORITHM],
        issuer=issuer,
        options={"verify_aud": False},
    )
    claims = ClerkSessionClaims.model_validate(decoded_claims)
    return claims


def validate_authorized_party(claims: ClerkSessionClaims, settings: Settings) -> None:
    authorized_party = claims.azp
    has_authorized_party = authorized_party is not None

    if not has_authorized_party:
        return

    normalized_authorized_party = authorized_party.rstrip("/")
    authorized_parties = settings.clerk_authorized_party_list()
    party_is_allowed = normalized_authorized_party in authorized_parties

    if not party_is_allowed:
        raise HTTPException(status_code=401, detail="Invalid session token origin")


def validate_session_status(claims: ClerkSessionClaims) -> None:
    session_is_pending = claims.sts == CLERK_PENDING_SESSION_STATUS

    if session_is_pending:
        raise HTTPException(status_code=401, detail="Session setup is incomplete")


def validate_session_claims(claims: ClerkSessionClaims, settings: Settings) -> None:
    validate_authorized_party(claims, settings)
    validate_session_status(claims)


def verify_clerk_session_token(token: str, settings: Settings) -> AuthenticatedUser:
    public_key = public_verification_key(settings)
    jwks_url = configured_jwks_url(settings)
    has_public_key = public_key is not None
    has_jwks_url = jwks_url is not None

    if not has_public_key and not has_jwks_url:
        detail = "Clerk JWT verification key or Frontend API URL is not configured"
        raise HTTPException(status_code=500, detail=detail)

    try:
        if has_public_key:
            claims = verify_with_public_key(token, public_key, settings)
        elif has_jwks_url:
            claims = verify_with_jwks(token, jwks_url, settings)
        else:
            raise HTTPException(status_code=500, detail="Clerk verification is not configured")
    except (InvalidTokenError, PyJWKClientError) as error:
        raise HTTPException(status_code=401, detail="Invalid session token") from error

    validate_session_claims(claims, settings)
    user = authenticated_user_from_claims(claims)
    return user


def local_development_user() -> AuthenticatedUser:
    user = AuthenticatedUser(
        user_id="local-development-user",
        role=SCHEDULE_SOLVER_ADMIN_ROLE,
    )
    return user
