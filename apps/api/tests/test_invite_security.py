from datetime import timedelta
from io import BytesIO
from urllib.error import URLError

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.auth import AuthenticatedUser
from app.core.config import Settings
from app.db.models import ProviderIdentityLink
from app.db.models.scheduling import current_utc_time
from app.schemas.provider_portal import ProviderInviteAcceptanceRequest
from app.schemas.provider_portal import ProviderInviteCreate
from app.services.clerk_identity import ClerkUserIdentity
from app.services.clerk_identity import load_clerk_user_identity
from app.services.provider_portal_service import accept_provider_invite_request
from app.services.provider_portal_service import create_or_reset_provider_invite
from app.routers.provider_portal import account_state_for_provider
from conftest import SchedulingDatabase


@pytest.fixture
def clerk_identity(monkeypatch: pytest.MonkeyPatch) -> ClerkUserIdentity:
    identity = ClerkUserIdentity.model_validate({
        "id": "user_123",
        "email_addresses": [{"email_address": "provider@example.com", "verification": {"status": "verified"}}],
    })
    monkeypatch.setattr("app.services.clerk_identity.load_clerk_user_identity", lambda _user_id: identity)
    return identity


def create_invite(database: SchedulingDatabase, email: str = "provider@example.com"):
    request = ProviderInviteCreate(email=email)
    invite = create_or_reset_provider_invite(database.provider, request, database.organization.id, database.session)
    database.session.commit()
    return invite


def accept_invite(database: SchedulingDatabase, token: str):
    request = ProviderInviteAcceptanceRequest(invite_token=token)
    user = AuthenticatedUser(user_id="user_123")
    return accept_provider_invite_request(request, user, database.organization.id, database.session)


def test_reset_revokes_previous_recipient_token(scheduling_database: SchedulingDatabase, clerk_identity) -> None:
    database = scheduling_database
    invite = create_invite(database, "old@example.com")
    original_token = invite.invite_token
    invite = create_invite(database)
    assert original_token != invite.invite_token
    with pytest.raises(HTTPException) as error:
        accept_invite(database, original_token)
    assert error.value.status_code == 404
    assert database.session.scalar(select(ProviderIdentityLink)) is None
    result = accept_invite(database, invite.invite_token)
    assert result.provider.provider_id == database.provider.id


def test_expired_invite_cannot_link_account(scheduling_database: SchedulingDatabase, clerk_identity) -> None:
    database = scheduling_database
    invite = create_invite(database)
    invite.expires_at = current_utc_time() - timedelta(seconds=1)
    database.session.commit()
    with pytest.raises(HTTPException) as error:
        accept_invite(database, invite.invite_token)
    assert error.value.status_code == 410
    assert database.session.scalar(select(ProviderIdentityLink)) is None


def test_accepted_invite_cannot_be_consumed_twice(scheduling_database: SchedulingDatabase, clerk_identity) -> None:
    database = scheduling_database
    invite = create_invite(database)
    accept_invite(database, invite.invite_token)
    with pytest.raises(HTTPException) as error:
        accept_invite(database, invite.invite_token)
    assert error.value.status_code == 409
    links = list(database.session.scalars(select(ProviderIdentityLink)))
    assert len(links) == 1


def test_reset_cannot_reopen_an_invite_after_acceptance(scheduling_database: SchedulingDatabase, clerk_identity) -> None:
    database = scheduling_database
    invite = create_invite(database)
    token = invite.invite_token
    accept_invite(database, token)
    with pytest.raises(HTTPException) as error:
        create_invite(database, "another@example.com")
    assert error.value.status_code == 409
    assert invite.invite_token == token
    assert invite.status == "accepted"


def test_invite_reset_renews_expiry(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    invite = create_invite(database)
    invite.expires_at = current_utc_time() - timedelta(days=1)
    database.session.commit()
    invite = create_invite(database)
    assert invite.expires_at > current_utc_time() + timedelta(days=6)


@pytest.mark.parametrize("seconds_until_expiry, expected", [(-1, "expired"), (0, "expired"), (1, "invited")])
def test_admin_status_matches_invite_expiry(
    scheduling_database: SchedulingDatabase,
    monkeypatch,
    seconds_until_expiry: int,
    expected: str,
) -> None:
    database = scheduling_database
    invite = create_invite(database)
    now = current_utc_time()
    invite.expires_at = now + timedelta(seconds=seconds_until_expiry)
    monkeypatch.setattr("app.services.provider_portal_service.current_utc_time", lambda: now)
    account_state = account_state_for_provider(database.provider.id, {database.provider.id: invite}, {})
    assert account_state == expected


def test_accepted_and_linked_accounts_do_not_show_expired(scheduling_database: SchedulingDatabase, clerk_identity) -> None:
    database = scheduling_database
    invite = create_invite(database)
    accept_invite(database, invite.invite_token)
    invite.expires_at = current_utc_time() - timedelta(days=1)
    invites = {database.provider.id: invite}
    accepted_state = account_state_for_provider(database.provider.id, invites, {})
    assert accepted_state == "accepted"
    link = database.session.scalar(select(ProviderIdentityLink))
    links = {database.provider.id: link}
    linked_state = account_state_for_provider(database.provider.id, invites, links)
    assert linked_state == "linked"


def test_reissued_invitation_changes_admin_status_from_expired_to_invited(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    invite = create_invite(database)
    invite.expires_at = current_utc_time() - timedelta(days=1)
    database.session.commit()
    invites = {database.provider.id: invite}
    assert account_state_for_provider(database.provider.id, invites, {}) == "expired"
    create_invite(database)
    assert account_state_for_provider(database.provider.id, invites, {}) == "invited"


def test_provider_without_an_invite_has_no_account_state(scheduling_database: SchedulingDatabase) -> None:
    provider_id = scheduling_database.provider.id
    assert account_state_for_provider(provider_id, {}, {}) is None


@pytest.mark.parametrize("email, status", [("wrong@example.com", "verified"), ("provider@example.com", "unverified")])
def test_invite_requires_matching_verified_email(
    scheduling_database: SchedulingDatabase,
    clerk_identity: ClerkUserIdentity,
    email: str,
    status: str,
) -> None:
    database = scheduling_database
    invite = create_invite(database)
    clerk_identity.email_addresses[0].email_address = email
    clerk_identity.email_addresses[0].verification.status = status
    with pytest.raises(HTTPException) as error:
        accept_invite(database, invite.invite_token)
    assert error.value.status_code == 403
    assert database.session.scalar(select(ProviderIdentityLink)) is None
    assert invite.status == "invited"


def test_identity_service_failure_does_not_consume_invite(scheduling_database: SchedulingDatabase, monkeypatch) -> None:
    database = scheduling_database
    invite = create_invite(database)

    def fail_identity_lookup(_user_id):
        raise HTTPException(status_code=503, detail="Clerk unavailable")

    monkeypatch.setattr("app.services.clerk_identity.load_clerk_user_identity", fail_identity_lookup)
    with pytest.raises(HTTPException) as error:
        accept_invite(database, invite.invite_token)
    assert error.value.status_code == 503
    assert invite.status == "invited"
    assert database.session.scalar(select(ProviderIdentityLink)) is None


def test_clerk_identity_lookup_validates_response(monkeypatch) -> None:
    settings = Settings(clerk_secret_key="test-only-secret")
    monkeypatch.setattr("app.services.clerk_identity.get_settings", lambda: settings)

    def respond(request, timeout):
        assert request.full_url == "https://api.clerk.com/v1/users/user_123"
        assert timeout == 10
        return BytesIO(b'{"id":"user_123","email_addresses":[]}')

    monkeypatch.setattr("app.services.clerk_identity.urlopen", respond)
    identity = load_clerk_user_identity("user_123")
    assert identity.id == "user_123"


@pytest.mark.parametrize("response", [b'{}', b'{"id":"wrong-user","email_addresses":[]}'])
def test_clerk_identity_rejects_bad_responses(monkeypatch, response: bytes) -> None:
    settings = Settings(clerk_secret_key="test-only-secret")
    monkeypatch.setattr("app.services.clerk_identity.get_settings", lambda: settings)
    monkeypatch.setattr("app.services.clerk_identity.urlopen", lambda _request, timeout: BytesIO(response))
    with pytest.raises(HTTPException) as error:
        load_clerk_user_identity("user_123")
    assert error.value.status_code == 503


def test_clerk_identity_rejects_network_failure(monkeypatch) -> None:
    settings = Settings(clerk_secret_key="test-only-secret")
    monkeypatch.setattr("app.services.clerk_identity.get_settings", lambda: settings)

    def fail_request(_request, timeout):
        raise URLError("Unavailable")

    monkeypatch.setattr("app.services.clerk_identity.urlopen", fail_request)
    with pytest.raises(HTTPException) as error:
        load_clerk_user_identity("user_123")
    assert error.value.status_code == 503
