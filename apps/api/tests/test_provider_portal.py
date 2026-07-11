from datetime import date
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core.auth import local_development_user
from app.db.models import Provider
from app.db.models import ProviderIdentityLink
from app.db.models import ProviderInvite
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import SchedulePeriod
from app.dependencies import CurrentProvider
from app.routers.provider_portal import account_state_for_provider
from app.routers.provider_portal import admin_router
from app.routers.provider_portal import availability_completion
from app.routers.provider_portal import provider_router
from app.routers.provider_portal import replace_current_provider_weekly_availability
from app.schemas.provider_availability_week import ProviderAvailabilityDayInput
from app.schemas.provider_availability_week import ProviderAvailabilityDayRead
from app.schemas.provider_availability_week import ProviderWeeklyAvailabilityReplaceRequest
from app.schemas.provider_availability_week import ProviderWeeklyAvailabilityRead
from app.schemas.provider_portal import ProviderInviteAcceptanceRequest
from app.schemas.provider_portal import ProviderInviteCreate
from app.schemas.provider_portal import ProviderPortalWeekAvailabilityRead
from app.services.provider_portal_service import INVITE_STATUS_ACCEPTED
from app.services.provider_portal_service import accept_provider_invite_request
from app.services.provider_portal_service import provider_invite_email


class FakeProviderPortalSession:
    def __init__(self) -> None:
        self.added_rows: list[ProviderScheduleWeekAvailability] = []

    def delete(self, row: ProviderScheduleWeekAvailability) -> None:
        return None

    def flush(self) -> None:
        return None

    def add(self, row: ProviderScheduleWeekAvailability) -> None:
        self.added_rows.append(row)

    def commit(self) -> None:
        return None


class FakeInviteAcceptanceSession:
    def __init__(self) -> None:
        self.added_links: list[ProviderIdentityLink] = []
        self.committed = False

    def add(self, row: ProviderIdentityLink) -> None:
        self.added_links.append(row)

    def commit(self) -> None:
        self.committed = True


def create_provider(email: str | None = "provider@example.com") -> Provider:
    provider = Provider(
        id=uuid4(),
        organization_id=uuid4(),
        first_name="Pat",
        last_name="Provider",
        display_name="Pat Provider",
        email=email,
        phone=None,
        provider_type="doctor",
        employment_type="employee",
        is_active=True,
        notes=None,
    )
    return provider


def create_schedule_week() -> SchedulePeriod:
    schedule_week = SchedulePeriod(
        id=uuid4(),
        organization_id=uuid4(),
        name="Week of May 4",
        start_date=date(2026, 5, 4),
        end_date=date(2026, 5, 10),
        status="draft",
    )
    return schedule_week


def test_provider_portal_me_availability_route_exists() -> None:
    matching_routes = [
        route
        for route in provider_router.routes
        if route.path == "/provider-portal/me/availability"
    ]

    assert len(matching_routes) == 1


def test_provider_portal_me_preferences_route_accepts_put() -> None:
    matching_routes = [
        route
        for route in provider_router.routes
        if route.path == "/provider-portal/me/preferences"
    ]
    put_routes = [
        route
        for route in matching_routes
        if "PUT" in route.methods
    ]

    assert len(put_routes) == 1


def test_admin_provider_status_route_exists() -> None:
    matching_routes = [
        route
        for route in admin_router.routes
        if route.path == "/admin/provider-status"
    ]

    assert len(matching_routes) == 1


def test_availability_completion_marks_unset_weekday_incomplete() -> None:
    schedule_week = create_schedule_week()
    provider_id = uuid4()
    days = [
        ProviderAvailabilityDayRead(weekday="monday", options=["full_shift"]),
        ProviderAvailabilityDayRead(weekday="tuesday", options=["unset"]),
        ProviderAvailabilityDayRead(weekday="wednesday", options=["none"]),
        ProviderAvailabilityDayRead(weekday="thursday", options=["none"]),
        ProviderAvailabilityDayRead(weekday="friday", options=["none"]),
        ProviderAvailabilityDayRead(weekday="saturday", options=["none"]),
        ProviderAvailabilityDayRead(weekday="sunday", options=["none"]),
    ]
    availability = ProviderWeeklyAvailabilityRead(
        schedule_week_id=schedule_week.id,
        provider_id=provider_id,
        is_locked=False,
        min_shifts_requested=0,
        max_shifts_requested=1,
        days=days,
    )

    completion = availability_completion(schedule_week, availability)

    assert completion.is_complete is False
    assert completion.unset_weekdays == ["tuesday"]


def test_availability_completion_ignores_unset_weekends() -> None:
    schedule_week = create_schedule_week()
    provider_id = uuid4()
    days = [
        ProviderAvailabilityDayRead(weekday="monday", options=["full_shift"]),
        ProviderAvailabilityDayRead(weekday="tuesday", options=["none"]),
        ProviderAvailabilityDayRead(weekday="wednesday", options=["none"]),
        ProviderAvailabilityDayRead(weekday="thursday", options=["none"]),
        ProviderAvailabilityDayRead(weekday="friday", options=["none"]),
        ProviderAvailabilityDayRead(weekday="saturday", options=["unset"]),
        ProviderAvailabilityDayRead(weekday="sunday", options=["unset"]),
    ]
    availability = ProviderWeeklyAvailabilityRead(
        schedule_week_id=schedule_week.id,
        provider_id=provider_id,
        is_locked=False,
        min_shifts_requested=0,
        max_shifts_requested=1,
        days=days,
    )

    completion = availability_completion(schedule_week, availability)

    assert completion.is_complete is True
    assert completion.unset_weekdays == []


def test_provider_portal_availability_save_changes_unset_to_none(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = create_provider()
    schedule_week = create_schedule_week()
    user = local_development_user()
    current_provider = CurrentProvider(user=user, provider=provider)
    organization_id = provider.organization_id
    session = FakeProviderPortalSession()

    def fake_require_schedule_week(
        schedule_week_id: object,
        scoped_organization_id: object,
        scoped_session: object,
    ) -> SchedulePeriod:
        return schedule_week

    def fake_rows_for_provider_week(
        schedule_week_id: object,
        provider_id: object,
        scoped_organization_id: object,
        scoped_session: object,
    ) -> list[ProviderScheduleWeekAvailability]:
        return []

    def fake_provider_week_availability_response(
        selected_schedule_week: SchedulePeriod,
        provider_id: object,
        scoped_organization_id: object,
        scoped_session: object,
    ) -> ProviderPortalWeekAvailabilityRead:
        days = [
            ProviderAvailabilityDayRead(weekday="monday", options=["full_shift"]),
            ProviderAvailabilityDayRead(weekday="tuesday", options=["none"]),
            ProviderAvailabilityDayRead(weekday="wednesday", options=["none"]),
            ProviderAvailabilityDayRead(weekday="thursday", options=["none"]),
            ProviderAvailabilityDayRead(weekday="friday", options=["none"]),
            ProviderAvailabilityDayRead(weekday="saturday", options=["none"]),
            ProviderAvailabilityDayRead(weekday="sunday", options=["none"]),
        ]
        availability = ProviderWeeklyAvailabilityRead(
            schedule_week_id=selected_schedule_week.id,
            provider_id=provider.id,
            is_locked=False,
            min_shifts_requested=0,
            max_shifts_requested=1,
            days=days,
        )
        completion = availability_completion(selected_schedule_week, availability)
        response = ProviderPortalWeekAvailabilityRead(
            schedule_week_id=selected_schedule_week.id,
            schedule_week_name=selected_schedule_week.name,
            schedule_week_start_date=selected_schedule_week.start_date,
            schedule_week_end_date=selected_schedule_week.end_date,
            availability=availability,
            completion=completion,
        )
        return response

    monkeypatch.setattr(
        "app.routers.provider_portal.require_schedule_week",
        fake_require_schedule_week,
    )
    monkeypatch.setattr(
        "app.routers.provider_portal.rows_for_provider_week",
        fake_rows_for_provider_week,
    )
    monkeypatch.setattr(
        "app.routers.provider_portal.provider_week_availability_response",
        fake_provider_week_availability_response,
    )
    days = [
        ProviderAvailabilityDayInput(weekday="monday", options=["full_shift"]),
        ProviderAvailabilityDayInput(weekday="tuesday", options=["unset"]),
        ProviderAvailabilityDayInput(weekday="wednesday", options=["none"]),
        ProviderAvailabilityDayInput(weekday="thursday", options=["unset"]),
        ProviderAvailabilityDayInput(weekday="friday", options=["unset"]),
        ProviderAvailabilityDayInput(weekday="saturday", options=["none"]),
        ProviderAvailabilityDayInput(weekday="sunday", options=["none"]),
    ]
    request = ProviderWeeklyAvailabilityReplaceRequest(
        min_shifts_requested=0,
        max_shifts_requested=1,
        days=days,
    )

    replace_current_provider_weekly_availability(
        schedule_week.id,
        request,
        current_provider,
        organization_id,
        session,
    )

    monday_row = next(row for row in session.added_rows if row.weekday == "monday")
    tuesday_row = next(row for row in session.added_rows if row.weekday == "tuesday")
    thursday_row = next(row for row in session.added_rows if row.weekday == "thursday")

    assert monday_row.availability_options == ["full_shift"]
    assert tuesday_row.availability_options == ["none"]
    assert thursday_row.availability_options == ["none"]


def test_account_state_prefers_linked_over_invited() -> None:
    organization_id = uuid4()
    provider_id = uuid4()
    invite = ProviderInvite(
        id=uuid4(),
        organization_id=organization_id,
        provider_id=provider_id,
        email="provider@example.com",
        invite_token="token",
        status="invited",
    )
    identity_link = ProviderIdentityLink(
        id=uuid4(),
        organization_id=organization_id,
        provider_id=provider_id,
        clerk_user_id="user_123",
    )

    account_state = account_state_for_provider(
        provider_id,
        {provider_id: invite},
        {provider_id: identity_link},
    )

    assert account_state == "linked"


def test_provider_invite_email_requires_email_source() -> None:
    provider = create_provider(email=None)
    request = ProviderInviteCreate(email=None)

    with pytest.raises(HTTPException) as error:
        provider_invite_email(provider, request)

    assert error.value.status_code == 400


def test_admin_provider_invite_email_route_exists() -> None:
    matching_routes = [
        route
        for route in admin_router.routes
        if route.path == "/admin/providers/{provider_id}/invite-email"
    ]

    assert len(matching_routes) == 1


def test_provider_invite_url_uses_configured_base_url() -> None:
    from app.services.email.provider_invites import provider_invite_url

    invite_url = provider_invite_url("https://scheduler.example/", "token-123")

    assert invite_url == "https://scheduler.example/provider-portal/accept?token=token-123"


def test_provider_invite_email_message_builds_accept_link() -> None:
    from app.services.email.provider_invites import provider_invite_email_message

    provider = create_provider()
    invite = ProviderInvite(
        id=uuid4(),
        organization_id=provider.organization_id,
        provider_id=provider.id,
        email="provider@example.com",
        invite_token="token-123",
        status="invited",
    )

    message = provider_invite_email_message(
        provider,
        invite,
        "https://scheduler.example",
        "scheduling@example.com",
    )

    assert str(message.recipient_email) == "provider@example.com"
    assert str(message.sender_email) == "scheduling@example.com"
    assert "token-123" in str(message.invite_url)
    assert "Schedule Solver's Provider Portal" in message.plain_text_body
    assert "submit availability for open schedule weeks" in message.plain_text_body
    assert "For your security, this link is intended only for you." in message.plain_text_body
    assert "Schedule Solver Team" in message.plain_text_body
    assert "Accept Provider Portal invite" in message.html_body
    assert "submit availability for open schedule weeks" in message.html_body
    assert "Schedule Solver Team" in message.html_body


def test_accept_provider_invite_moves_user_link_from_inactive_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    organization_id = uuid4()
    current_user = local_development_user()
    provider = create_provider()
    provider.organization_id = organization_id
    inactive_provider = create_provider()
    inactive_provider.organization_id = organization_id
    inactive_provider.is_active = False
    invite = ProviderInvite(
        id=uuid4(),
        organization_id=organization_id,
        provider_id=provider.id,
        email="provider@example.com",
        invite_token="token-123",
        status="invited",
    )
    existing_user_link = ProviderIdentityLink(
        id=uuid4(),
        organization_id=organization_id,
        provider_id=inactive_provider.id,
        clerk_user_id=current_user.user_id,
    )
    session = FakeInviteAcceptanceSession()
    request = ProviderInviteAcceptanceRequest(invite_token=invite.invite_token)

    def fake_invite_for_acceptance(
        invite_token: str,
        scoped_organization_id: object,
        scoped_session: object,
    ) -> ProviderInvite:
        return invite

    def fake_require_active_provider(
        provider_id: object,
        scoped_organization_id: object,
        scoped_session: object,
    ) -> Provider:
        return provider

    def fake_provider_identity_link(
        provider_id: object,
        scoped_organization_id: object,
        scoped_session: object,
    ) -> ProviderIdentityLink | None:
        return None

    def fake_user_identity_link(
        clerk_user_id: str,
        scoped_organization_id: object,
        scoped_session: object,
    ) -> ProviderIdentityLink | None:
        return existing_user_link

    def fake_provider_for_identity_link(
        identity_link: ProviderIdentityLink,
        scoped_organization_id: object,
        scoped_session: object,
    ) -> Provider | None:
        return inactive_provider

    monkeypatch.setattr(
        "app.services.provider_portal_service.invite_for_acceptance",
        fake_invite_for_acceptance,
    )
    monkeypatch.setattr(
        "app.services.provider_portal_service.require_active_provider",
        fake_require_active_provider,
    )
    monkeypatch.setattr(
        "app.services.provider_portal_service.provider_identity_link",
        fake_provider_identity_link,
    )
    monkeypatch.setattr(
        "app.services.provider_portal_service.user_identity_link",
        fake_user_identity_link,
    )
    monkeypatch.setattr(
        "app.services.provider_portal_service.provider_for_identity_link",
        fake_provider_for_identity_link,
    )

    response = accept_provider_invite_request(
        request,
        current_user,
        organization_id,
        session,
    )

    assert existing_user_link.provider_id == provider.id
    assert invite.status == INVITE_STATUS_ACCEPTED
    assert invite.accepted_by_clerk_user_id == current_user.user_id
    assert session.added_links == []
    assert session.committed is True
    assert response.provider.provider_id == provider.id


def test_accept_provider_invite_keeps_active_user_link_conflict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    organization_id = uuid4()
    current_user = local_development_user()
    provider = create_provider()
    provider.organization_id = organization_id
    linked_provider = create_provider()
    linked_provider.organization_id = organization_id
    invite = ProviderInvite(
        id=uuid4(),
        organization_id=organization_id,
        provider_id=provider.id,
        email="provider@example.com",
        invite_token="token-123",
        status="invited",
    )
    existing_user_link = ProviderIdentityLink(
        id=uuid4(),
        organization_id=organization_id,
        provider_id=linked_provider.id,
        clerk_user_id=current_user.user_id,
    )
    session = FakeInviteAcceptanceSession()
    request = ProviderInviteAcceptanceRequest(invite_token=invite.invite_token)

    def fake_invite_for_acceptance(
        invite_token: str,
        scoped_organization_id: object,
        scoped_session: object,
    ) -> ProviderInvite:
        return invite

    def fake_require_active_provider(
        provider_id: object,
        scoped_organization_id: object,
        scoped_session: object,
    ) -> Provider:
        return provider

    def fake_provider_identity_link(
        provider_id: object,
        scoped_organization_id: object,
        scoped_session: object,
    ) -> ProviderIdentityLink | None:
        return None

    def fake_user_identity_link(
        clerk_user_id: str,
        scoped_organization_id: object,
        scoped_session: object,
    ) -> ProviderIdentityLink | None:
        return existing_user_link

    def fake_provider_for_identity_link(
        identity_link: ProviderIdentityLink,
        scoped_organization_id: object,
        scoped_session: object,
    ) -> Provider | None:
        return linked_provider

    monkeypatch.setattr(
        "app.services.provider_portal_service.invite_for_acceptance",
        fake_invite_for_acceptance,
    )
    monkeypatch.setattr(
        "app.services.provider_portal_service.require_active_provider",
        fake_require_active_provider,
    )
    monkeypatch.setattr(
        "app.services.provider_portal_service.provider_identity_link",
        fake_provider_identity_link,
    )
    monkeypatch.setattr(
        "app.services.provider_portal_service.user_identity_link",
        fake_user_identity_link,
    )
    monkeypatch.setattr(
        "app.services.provider_portal_service.provider_for_identity_link",
        fake_provider_for_identity_link,
    )

    with pytest.raises(HTTPException) as error:
        accept_provider_invite_request(
            request,
            current_user,
            organization_id,
            session,
        )

    assert error.value.status_code == 409
    assert error.value.detail == "User is already linked to another Provider"
    assert existing_user_link.provider_id == linked_provider.id
    assert session.committed is False
