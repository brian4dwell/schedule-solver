import pytest
from fastapi import HTTPException

from app.core.auth import AuthenticatedUser
from app.core.auth import ClerkSessionClaims
from app.core.auth import authenticated_user_from_claims
from app.core.auth import authorization_header_token
from app.core.auth import session_token_from_request
from app.core.auth import user_has_admin_role
from app.dependencies import require_admin_user


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


def test_custom_admin_role_is_authorized() -> None:
    user = AuthenticatedUser(
        user_id="user_123",
        role="admin",
    )

    has_admin_role = user_has_admin_role(user)

    assert has_admin_role


def test_require_admin_user_rejects_non_admin() -> None:
    user = AuthenticatedUser(
        user_id="user_123",
        role="scheduler",
    )

    with pytest.raises(HTTPException) as error:
        require_admin_user(user)

    assert error.value.status_code == 403
