from datetime import date
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.db.models import Provider
from app.db.models import ProviderIdentityLink
from app.db.models import ProviderInvite
from app.db.models import SchedulePeriod
from app.routers.provider_portal import account_state_for_provider
from app.routers.provider_portal import admin_router
from app.routers.provider_portal import availability_completion
from app.routers.provider_portal import provider_invite_email
from app.routers.provider_portal import provider_router
from app.schemas.provider_availability_week import ProviderAvailabilityDayRead
from app.schemas.provider_availability_week import ProviderWeeklyAvailabilityRead
from app.schemas.provider_portal import ProviderInviteCreate


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


def test_availability_completion_marks_unset_week_incomplete() -> None:
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
    assert "Accept Provider Portal invite" in message.html_body
