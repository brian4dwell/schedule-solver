from pathlib import Path
import sys
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.core.auth import AuthenticatedUser
from app.core.auth import ClerkSessionClaims
from app.core.auth import authenticated_user_from_claims
from app.core.auth import authorization_header_token
from app.core.auth import configured_jwks_url
from app.core.auth import frontend_api_url_from_publishable_key
from app.core.auth import session_token_from_request
from app.core.auth import validate_authorized_party
from app.core.auth import user_has_admin_role
from app.core.config import Settings
from app.dependencies import require_admin_user
from app.dependencies import require_current_provider
from app.dependencies import get_current_organization_id
from app.dependencies import LOCAL_ORGANIZATION_ID
from app.db.models import Organization
from pydantic import ValidationError
from conftest import SchedulingDatabase


class ScalarSession:
    def __init__(self, values: list[object | None]) -> None:
        self.values = values

    def scalar(self, _statement: object) -> object | None:
        value = self.values.pop(0)
        return value


def test_authorization_header_token_reads_bearer_token() -> None:
    token = authorization_header_token("Bearer session-token")

    assert token == "session-token"


def test_session_token_uses_cookie_when_authorization_is_missing() -> None:
    token = session_token_from_request(None, "cookie-token")

    assert token == "cookie-token"


def test_session_token_requires_authentication() -> None:
    with pytest.raises(HTTPException) as error:
        session_token_from_request(None, None)

    assert error.value.status_code == 401


def test_publishable_key_creates_frontend_api_url() -> None:
    publishable_key = "pk_test_aGFyZHktamF5YmlyZC04MS5jbGVyay5hY2NvdW50cy5kZXYk"

    frontend_api_url = frontend_api_url_from_publishable_key(publishable_key)

    assert frontend_api_url == "https://hardy-jaybird-81.clerk.accounts.dev"


def test_configured_jwks_url_uses_frontend_api_url() -> None:
    settings = Settings(
        clerk_frontend_api_url="https://hardy-jaybird-81.clerk.accounts.dev",
    )

    jwks_url = configured_jwks_url(settings)

    expected_jwks_url = "https://hardy-jaybird-81.clerk.accounts.dev/.well-known/jwks.json"
    assert jwks_url == expected_jwks_url


def test_authenticated_user_maps_clerk_admin_claims() -> None:
    claims = ClerkSessionClaims(
        sub="user_123",
        sid="sess_123",
        org_id="org_123",
        org_role="org:admin",
    )

    user = authenticated_user_from_claims(claims)

    assert user.user_id == "user_123"
    assert user.session_id == "sess_123"
    assert user.organization_external_id == "org_123"
    assert user.organization_role == "org:admin"
    assert user_has_admin_role(user)


def test_validate_authorized_party_rejects_unknown_origin() -> None:
    claims = ClerkSessionClaims(
        sub="user_123",
        azp="https://attacker.example",
    )
    settings = Settings(
        clerk_authorized_parties="http://localhost:3000",
    )

    with pytest.raises(HTTPException) as error:
        validate_authorized_party(claims, settings)

    assert error.value.status_code == 401


def test_custom_admin_role_is_authorized() -> None:
    user = AuthenticatedUser(
        user_id="user_123",
        role="admin",
    )

    has_admin_role = user_has_admin_role(user)

    assert has_admin_role


def test_custom_admin_roles_array_is_authorized() -> None:
    claims = ClerkSessionClaims(
        sub="user_123",
        public_metadata={
            "roles": ["admin"],
        },
    )

    user = authenticated_user_from_claims(claims)
    has_admin_role = user_has_admin_role(user)

    assert has_admin_role


def test_null_custom_roles_claim_is_treated_as_missing() -> None:
    claims = ClerkSessionClaims.model_validate(
        {
            "sub": "user_123",
            "roles": None,
        },
    )

    user = authenticated_user_from_claims(claims)
    has_admin_role = user_has_admin_role(user)

    assert user.roles == []
    assert not has_admin_role


def test_require_admin_user_rejects_non_admin() -> None:
    user = AuthenticatedUser(
        user_id="user_123",
        role="scheduler",
    )

    with pytest.raises(HTTPException) as error:
        require_admin_user(user)

    assert error.value.status_code == 403


def test_require_current_provider_reports_inactive_provider_profile() -> None:
    provider_id = uuid4()
    organization_id = uuid4()
    current_user = AuthenticatedUser(user_id="user_123")
    identity_link = SimpleNamespace(provider_id=provider_id)
    provider = SimpleNamespace(is_active=False)
    session = ScalarSession([identity_link, provider])

    with pytest.raises(HTTPException) as error:
        require_current_provider(current_user, organization_id, session)

    assert error.value.status_code == 403
    assert error.value.detail == "Provider profile is inactive"


@pytest.mark.parametrize("role, is_admin", [("admin", True), ("member", False)])
def test_v2_organization_roles_are_normalized(role: str, is_admin: bool) -> None:
    claims = ClerkSessionClaims.model_validate({"sub": "user_123", "v": 2, "o": {"id": "org_123", "rol": role}})
    user = authenticated_user_from_claims(claims)
    assert user.organization_external_id == "org_123"
    assert user.organization_role == f"org:{role}"
    assert user_has_admin_role(user) is is_admin


def test_public_metadata_singular_admin_role_is_recognized() -> None:
    claims = ClerkSessionClaims.model_validate({"sub": "user_123", "public_metadata": {"role": "admin"}})
    user = authenticated_user_from_claims(claims)
    assert user_has_admin_role(user)


@pytest.mark.parametrize("legacy_claims", [{"org_id": "org_other"}, {"org_role": "org:admin"}])
def test_conflicting_v1_and_v2_organization_claims_are_rejected(legacy_claims: dict[str, str]) -> None:
    claims = {"sub": "user_123", "o": {"id": "org_123", "rol": "member"}, **legacy_claims}
    with pytest.raises(ValidationError):
        ClerkSessionClaims.model_validate(claims)


@pytest.mark.parametrize("external_id", ["org_local", "org_unknown", "org_other"])
def test_organization_admin_access_requires_the_local_mapping(
    scheduling_database: SchedulingDatabase,
    external_id: str,
) -> None:
    session = scheduling_database.session
    local = Organization(id=LOCAL_ORGANIZATION_ID, name="Local", clerk_org_id="org_local")
    scheduling_database.organization.clerk_org_id = "org_other"
    session.add(local)
    session.commit()
    claims = ClerkSessionClaims.model_validate({"sub": "user_123", "o": {"id": external_id, "rol": "admin"}})
    user = authenticated_user_from_claims(claims)
    require_admin_user(user)
    if external_id == "org_local":
        assert get_current_organization_id(user, session) == LOCAL_ORGANIZATION_ID
    else:
        with pytest.raises(HTTPException) as error:
            get_current_organization_id(user, session)
        assert error.value.status_code == 403


@pytest.mark.parametrize("role", ["admin", None])
def test_personal_admin_and_provider_sessions_keep_single_organization_access(
    scheduling_database: SchedulingDatabase,
    role: str | None,
) -> None:
    user = AuthenticatedUser(user_id="user_123", role=role)
    organization_id = get_current_organization_id(user, scheduling_database.session)
    assert organization_id == LOCAL_ORGANIZATION_ID


def test_organization_role_without_identity_is_denied(scheduling_database: SchedulingDatabase) -> None:
    user = AuthenticatedUser(user_id="user_123", organization_role="org:admin")
    with pytest.raises(HTTPException) as error:
        get_current_organization_id(user, scheduling_database.session)
    assert error.value.status_code == 403
