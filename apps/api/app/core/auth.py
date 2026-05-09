from functools import lru_cache

import jwt
from fastapi import HTTPException
from jwt import InvalidTokenError
from jwt import PyJWKClient
from jwt import PyJWKClientError
from pydantic import BaseModel
from pydantic import ConfigDict

from app.core.config import Settings

CLERK_SESSION_ALGORITHM = "RS256"
CLERK_ORGANIZATION_ADMIN_ROLE = "org:admin"
SCHEDULE_SOLVER_ADMIN_ROLE = "admin"


class ClerkSessionClaims(BaseModel):
    sub: str
    sid: str | None = None
    org_id: str | None = None
    org_role: str | None = None
    role: str | None = None

    model_config = ConfigDict(extra="ignore")


class AuthenticatedUser(BaseModel):
    user_id: str
    session_id: str | None = None
    organization_external_id: str | None = None
    organization_role: str | None = None
    role: str | None = None


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
    user = AuthenticatedUser(
        user_id=claims.sub,
        session_id=claims.sid,
        organization_external_id=claims.org_id,
        organization_role=claims.org_role,
        role=claims.role,
    )
    return user


def user_has_admin_role(user: AuthenticatedUser) -> bool:
    has_organization_admin_role = user.organization_role == CLERK_ORGANIZATION_ADMIN_ROLE
    has_schedule_solver_admin_role = user.role == SCHEDULE_SOLVER_ADMIN_ROLE
    has_admin_role = has_organization_admin_role or has_schedule_solver_admin_role
    return has_admin_role


@lru_cache
def jwks_client(jwks_url: str, secret_key: str) -> PyJWKClient:
    authorization_header = f"Bearer {secret_key}"
    headers = {
        "Authorization": authorization_header,
    }
    client = PyJWKClient(jwks_url, headers=headers)
    return client


def verify_clerk_session_token(token: str, settings: Settings) -> AuthenticatedUser:
    secret_key = settings.clerk_secret_key

    if secret_key is None:
        raise HTTPException(status_code=500, detail="Clerk secret key is not configured")

    secret_key_value = secret_key.get_secret_value()
    client = jwks_client(settings.clerk_jwks_url, secret_key_value)

    try:
        signing_key = client.get_signing_key_from_jwt(token)
        decoded_claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=[CLERK_SESSION_ALGORITHM],
            options={"verify_aud": False},
        )
        claims = ClerkSessionClaims.model_validate(decoded_claims)
    except (InvalidTokenError, PyJWKClientError) as error:
        raise HTTPException(status_code=401, detail="Invalid session token") from error

    user = authenticated_user_from_claims(claims)
    return user


def local_development_user() -> AuthenticatedUser:
    user = AuthenticatedUser(
        user_id="local-development-user",
        role=SCHEDULE_SOLVER_ADMIN_ROLE,
    )
    return user
