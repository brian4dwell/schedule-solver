from secrets import token_urlsafe
from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import AuthenticatedUser
from app.db.models import Provider
from app.db.models import ProviderCenterPreference
from app.db.models import ProviderIdentityLink
from app.db.models import ProviderInvite
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import ProviderShiftTypePreference
from app.db.models import SchedulePeriod
from app.db.models import Center
from app.db.models.scheduling import current_utc_time
from app.db.session import get_db
from app.dependencies import CurrentProvider
from app.dependencies import get_current_organization_id
from app.dependencies import get_current_user
from app.dependencies import require_admin_user
from app.dependencies import require_current_provider
from app.routers.provider_availability import build_read_response
from app.routers.provider_availability import require_schedule_week
from app.routers.provider_availability import rows_for_provider_week
from app.routers.provider_availability import schedule_week_is_locked
from app.routers.preferences import delete_visible_preferences
from app.routers.preferences import provider_preferences_response
from app.routers.preferences import validate_center_ids
from app.routers.preferences import validate_no_duplicate_ids
from app.routers.preferences import validate_no_duplicate_values
from app.schemas.preferences import ProviderPreferencesRead
from app.schemas.preferences import ProviderPreferencesReplace
from app.schemas.provider_availability_week import ProviderWeeklyAvailabilityRead
from app.schemas.provider_availability_week import ProviderWeeklyAvailabilityReplaceRequest
from app.schemas.provider_availability_week import half_shift_units
from app.schemas.provider_portal import AdminProviderStatusRow
from app.schemas.provider_portal import ProviderAccountState
from app.schemas.provider_portal import ProviderInviteAcceptanceRequest
from app.schemas.provider_portal import ProviderInviteCreate
from app.schemas.provider_portal import ProviderInviteRead
from app.schemas.provider_portal import ProviderPortalCenterOption
from app.schemas.provider_portal import ProviderPortalPreferenceOptionsRead
from app.schemas.provider_portal import ProviderPortalInviteAcceptanceRead
from app.schemas.provider_portal import ProviderPortalProfileRead
from app.schemas.provider_portal import ProviderPortalWeekAvailabilityRead
from app.schemas.provider_portal import ProviderWeeklyAvailabilityCompletion


provider_router = APIRouter(prefix="/provider-portal", tags=["provider-portal"])
admin_router = APIRouter(
    prefix="/admin",
    tags=["provider-portal-admin"],
    dependencies=[Depends(require_admin_user)],
)

INVITE_TOKEN_BYTE_COUNT = 32
INVITE_STATUS_INVITED = "invited"
INVITE_STATUS_ACCEPTED = "accepted"
SCHEDULE_PERIOD_STATUS_DRAFT = "draft"


def provider_profile(provider: Provider) -> ProviderPortalProfileRead:
    profile = ProviderPortalProfileRead(
        provider_id=provider.id,
        display_name=provider.display_name,
        email=provider.email,
    )
    return profile


def require_active_provider(provider_id: UUID, organization_id: UUID, session: Session) -> Provider:
    statement = select(Provider)
    statement = statement.where(Provider.id == provider_id)
    statement = statement.where(Provider.organization_id == organization_id)
    statement = statement.where(Provider.is_active.is_(True))
    provider = session.scalar(statement)

    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found")

    return provider


def open_schedule_weeks(organization_id: UUID, session: Session) -> list[SchedulePeriod]:
    statement = select(SchedulePeriod)
    statement = statement.where(SchedulePeriod.organization_id == organization_id)
    statement = statement.where(SchedulePeriod.status == SCHEDULE_PERIOD_STATUS_DRAFT)
    statement = statement.order_by(SchedulePeriod.start_date, SchedulePeriod.id)
    schedule_weeks = list(session.scalars(statement))
    return schedule_weeks


def availability_completion(
    schedule_week: SchedulePeriod,
    availability: ProviderWeeklyAvailabilityRead,
) -> ProviderWeeklyAvailabilityCompletion:
    unset_weekdays = [
        day.weekday
        for day in availability.days
        if "unset" in day.options
    ]
    is_complete = len(unset_weekdays) == 0
    completion = ProviderWeeklyAvailabilityCompletion(
        schedule_week_id=schedule_week.id,
        schedule_week_name=schedule_week.name,
        is_complete=is_complete,
        unset_weekdays=unset_weekdays,
    )
    return completion


def provider_week_availability_response(
    schedule_week: SchedulePeriod,
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> ProviderPortalWeekAvailabilityRead:
    rows = rows_for_provider_week(schedule_week.id, provider_id, organization_id, session)
    availability = build_read_response(schedule_week, provider_id, rows)
    completion = availability_completion(schedule_week, availability)
    response = ProviderPortalWeekAvailabilityRead(
        schedule_week_id=schedule_week.id,
        schedule_week_name=schedule_week.name,
        availability=availability,
        completion=completion,
    )
    return response


def current_provider_week_availabilities(
    current_provider: CurrentProvider,
    organization_id: UUID,
    session: Session,
) -> list[ProviderPortalWeekAvailabilityRead]:
    schedule_weeks = open_schedule_weeks(organization_id, session)
    responses = [
        provider_week_availability_response(
            schedule_week,
            current_provider.provider.id,
            organization_id,
            session,
        )
        for schedule_week in schedule_weeks
    ]
    return responses


def account_state_for_provider(
    provider_id: UUID,
    invite_by_provider_id: dict[UUID, ProviderInvite],
    link_by_provider_id: dict[UUID, ProviderIdentityLink],
) -> ProviderAccountState | None:
    identity_link = link_by_provider_id.get(provider_id)

    if identity_link is not None:
        return "linked"

    invite = invite_by_provider_id.get(provider_id)

    if invite is None:
        return None

    invite_was_accepted = invite.status == INVITE_STATUS_ACCEPTED

    if invite_was_accepted:
        return "accepted"

    return "invited"


def provider_invite_email(provider: Provider, request: ProviderInviteCreate) -> str:
    requested_email = request.email

    if requested_email is not None:
        return str(requested_email)

    provider_email = provider.email

    if provider_email is None:
        raise HTTPException(status_code=400, detail="Provider email is required before inviting")

    return provider_email


def existing_provider_invite(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> ProviderInvite | None:
    statement = select(ProviderInvite)
    statement = statement.where(ProviderInvite.provider_id == provider_id)
    statement = statement.where(ProviderInvite.organization_id == organization_id)
    invite = session.scalar(statement)
    return invite


def provider_identity_link(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> ProviderIdentityLink | None:
    statement = select(ProviderIdentityLink)
    statement = statement.where(ProviderIdentityLink.provider_id == provider_id)
    statement = statement.where(ProviderIdentityLink.organization_id == organization_id)
    identity_link = session.scalar(statement)
    return identity_link


def user_identity_link(
    clerk_user_id: str,
    organization_id: UUID,
    session: Session,
) -> ProviderIdentityLink | None:
    statement = select(ProviderIdentityLink)
    statement = statement.where(ProviderIdentityLink.clerk_user_id == clerk_user_id)
    statement = statement.where(ProviderIdentityLink.organization_id == organization_id)
    identity_link = session.scalar(statement)
    return identity_link


@admin_router.post(
    "/providers/{provider_id}/invite",
    response_model=ProviderInviteRead,
    status_code=201,
)
def create_provider_invite(
    provider_id: UUID,
    request: ProviderInviteCreate,
    organization_id: UUID = Depends(get_current_organization_id),
    session: Session = Depends(get_db),
) -> ProviderInvite:
    provider = require_active_provider(provider_id, organization_id, session)
    existing_link = provider_identity_link(provider_id, organization_id, session)

    if existing_link is not None:
        raise HTTPException(status_code=409, detail="Provider is already linked")

    invite_email = provider_invite_email(provider, request)
    invite = existing_provider_invite(provider_id, organization_id, session)

    if invite is None:
        invite_token = token_urlsafe(INVITE_TOKEN_BYTE_COUNT)
        invite = ProviderInvite(
            organization_id=organization_id,
            provider_id=provider_id,
            email=invite_email,
            invite_token=invite_token,
            status=INVITE_STATUS_INVITED,
            accepted_by_clerk_user_id=None,
            accepted_at=None,
        )
        session.add(invite)
    else:
        invite.email = invite_email
        invite.status = INVITE_STATUS_INVITED
        invite.accepted_by_clerk_user_id = None
        invite.accepted_at = None

    session.commit()
    session.refresh(invite)
    return invite


@provider_router.post(
    "/invite-acceptance",
    response_model=ProviderPortalInviteAcceptanceRead,
)
def accept_provider_invite(
    request: ProviderInviteAcceptanceRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    organization_id: UUID = Depends(get_current_organization_id),
    session: Session = Depends(get_db),
) -> ProviderPortalInviteAcceptanceRead:
    statement = select(ProviderInvite)
    statement = statement.where(ProviderInvite.organization_id == organization_id)
    statement = statement.where(ProviderInvite.invite_token == request.invite_token)
    invite = session.scalar(statement)

    if invite is None:
        raise HTTPException(status_code=404, detail="Provider invite not found")

    provider = require_active_provider(invite.provider_id, organization_id, session)
    existing_provider_link = provider_identity_link(provider.id, organization_id, session)
    existing_user_link = user_identity_link(current_user.user_id, organization_id, session)
    provider_link_conflicts = (
        existing_provider_link is not None
        and existing_provider_link.clerk_user_id != current_user.user_id
    )
    user_link_conflicts = (
        existing_user_link is not None
        and existing_user_link.provider_id != provider.id
    )

    if provider_link_conflicts:
        raise HTTPException(status_code=409, detail="Provider is already linked to another user")

    if user_link_conflicts:
        raise HTTPException(status_code=409, detail="User is already linked to another Provider")

    if existing_provider_link is None:
        identity_link = ProviderIdentityLink(
            organization_id=organization_id,
            provider_id=provider.id,
            clerk_user_id=current_user.user_id,
        )
        session.add(identity_link)

    invite.status = INVITE_STATUS_ACCEPTED
    invite.accepted_by_clerk_user_id = current_user.user_id
    invite.accepted_at = current_utc_time()
    session.commit()
    profile = provider_profile(provider)
    response = ProviderPortalInviteAcceptanceRead(provider=profile)
    return response


@provider_router.get("/me", response_model=ProviderPortalProfileRead)
def read_current_provider(
    current_provider: CurrentProvider = Depends(require_current_provider),
) -> ProviderPortalProfileRead:
    profile = provider_profile(current_provider.provider)
    return profile


@provider_router.get("/me/preferences", response_model=ProviderPreferencesRead)
def read_current_provider_preferences(
    current_provider: CurrentProvider = Depends(require_current_provider),
    organization_id: UUID = Depends(get_current_organization_id),
    session: Session = Depends(get_db),
) -> ProviderPreferencesRead:
    response = provider_preferences_response(current_provider.provider.id, organization_id, session)
    return response


@provider_router.get("/me/preference-options", response_model=ProviderPortalPreferenceOptionsRead)
def read_current_provider_preference_options(
    current_provider: CurrentProvider = Depends(require_current_provider),
    organization_id: UUID = Depends(get_current_organization_id),
    session: Session = Depends(get_db),
) -> ProviderPortalPreferenceOptionsRead:
    statement = select(Center)
    statement = statement.where(Center.organization_id == organization_id)
    statement = statement.where(Center.is_active.is_(True))
    statement = statement.order_by(Center.name)
    centers = list(session.scalars(statement))
    center_options = [
        ProviderPortalCenterOption(center_id=center.id, name=center.name)
        for center in centers
    ]
    response = ProviderPortalPreferenceOptionsRead(center_options=center_options)
    return response


@provider_router.put("/me/preferences", response_model=ProviderPreferencesRead)
def replace_current_provider_preferences(
    request: ProviderPreferencesReplace,
    current_provider: CurrentProvider = Depends(require_current_provider),
    organization_id: UUID = Depends(get_current_organization_id),
    session: Session = Depends(get_db),
) -> ProviderPreferencesRead:
    provider_id = current_provider.provider.id
    requested_center_ids = [
        preference.center_id
        for preference in request.center_preferences
    ]
    validate_center_ids(requested_center_ids, organization_id, session)
    validate_no_duplicate_ids(requested_center_ids, "Duplicate center preference")
    requested_shift_types = [
        preference.shift_type
        for preference in request.shift_type_preferences
    ]
    validate_no_duplicate_values(requested_shift_types, "Duplicate shift type preference")
    delete_visible_preferences(provider_id, organization_id, session)

    for preference in request.center_preferences:
        row = ProviderCenterPreference(
            organization_id=organization_id,
            provider_id=provider_id,
            center_id=preference.center_id,
            preference_level=preference.preference_level,
            is_active=True,
        )
        session.add(row)

    for preference in request.shift_type_preferences:
        row = ProviderShiftTypePreference(
            organization_id=organization_id,
            provider_id=provider_id,
            shift_type=preference.shift_type,
            preference_level=preference.preference_level,
            is_active=True,
        )
        session.add(row)

    session.commit()
    response = provider_preferences_response(provider_id, organization_id, session)
    return response


@provider_router.get(
    "/me/availability",
    response_model=list[ProviderPortalWeekAvailabilityRead],
)
def read_current_provider_open_week_availability(
    current_provider: CurrentProvider = Depends(require_current_provider),
    organization_id: UUID = Depends(get_current_organization_id),
    session: Session = Depends(get_db),
) -> list[ProviderPortalWeekAvailabilityRead]:
    responses = current_provider_week_availabilities(current_provider, organization_id, session)
    return responses


@provider_router.get(
    "/me/schedule-weeks/{schedule_week_id}/availability",
    response_model=ProviderPortalWeekAvailabilityRead,
)
def read_current_provider_weekly_availability(
    schedule_week_id: UUID,
    current_provider: CurrentProvider = Depends(require_current_provider),
    organization_id: UUID = Depends(get_current_organization_id),
    session: Session = Depends(get_db),
) -> ProviderPortalWeekAvailabilityRead:
    schedule_week = require_schedule_week(schedule_week_id, organization_id, session)
    response = provider_week_availability_response(
        schedule_week,
        current_provider.provider.id,
        organization_id,
        session,
    )
    return response


@provider_router.put(
    "/me/schedule-weeks/{schedule_week_id}/availability",
    response_model=ProviderPortalWeekAvailabilityRead,
)
def replace_current_provider_weekly_availability(
    schedule_week_id: UUID,
    request: ProviderWeeklyAvailabilityReplaceRequest,
    current_provider: CurrentProvider = Depends(require_current_provider),
    organization_id: UUID = Depends(get_current_organization_id),
    session: Session = Depends(get_db),
) -> ProviderPortalWeekAvailabilityRead:
    schedule_week = require_schedule_week(schedule_week_id, organization_id, session)

    if schedule_week_is_locked(schedule_week):
        raise HTTPException(status_code=409, detail="Availability is locked for published weeks")

    provider_id = current_provider.provider.id
    existing_rows = rows_for_provider_week(schedule_week_id, provider_id, organization_id, session)

    for row in existing_rows:
        session.delete(row)

    session.flush()

    minimum_units = half_shift_units(request.min_shifts_requested)
    maximum_units = half_shift_units(request.max_shifts_requested)

    for day in request.days:
        created_row = ProviderScheduleWeekAvailability(
            organization_id=organization_id,
            schedule_week_id=schedule_week_id,
            provider_id=provider_id,
            weekday=day.weekday,
            availability_options=day.options,
            min_shifts_requested=minimum_units // 2,
            max_shifts_requested=maximum_units // 2,
            min_shifts_requested_units=minimum_units,
            max_shifts_requested_units=maximum_units,
        )
        session.add(created_row)

    session.commit()
    response = provider_week_availability_response(
        schedule_week,
        provider_id,
        organization_id,
        session,
    )
    return response


@admin_router.get("/provider-status", response_model=list[AdminProviderStatusRow])
def list_admin_provider_status(
    account_state: ProviderAccountState | None = Query(default=None),
    open_week_availability_complete: bool | None = Query(default=None),
    organization_id: UUID = Depends(get_current_organization_id),
    session: Session = Depends(get_db),
) -> list[AdminProviderStatusRow]:
    provider_statement = select(Provider)
    provider_statement = provider_statement.where(Provider.organization_id == organization_id)
    provider_statement = provider_statement.where(Provider.is_active.is_(True))
    provider_statement = provider_statement.order_by(Provider.display_name)
    providers = list(session.scalars(provider_statement))
    provider_ids = [provider.id for provider in providers]
    invite_statement = select(ProviderInvite)
    invite_statement = invite_statement.where(ProviderInvite.organization_id == organization_id)
    invite_statement = invite_statement.where(ProviderInvite.provider_id.in_(provider_ids))
    invites = list(session.scalars(invite_statement))
    link_statement = select(ProviderIdentityLink)
    link_statement = link_statement.where(ProviderIdentityLink.organization_id == organization_id)
    link_statement = link_statement.where(ProviderIdentityLink.provider_id.in_(provider_ids))
    identity_links = list(session.scalars(link_statement))
    schedule_weeks = open_schedule_weeks(organization_id, session)
    invite_by_provider_id = {invite.provider_id: invite for invite in invites}
    link_by_provider_id = {identity_link.provider_id: identity_link for identity_link in identity_links}
    status_rows: list[AdminProviderStatusRow] = []

    for provider in providers:
        provider_account_state = account_state_for_provider(
            provider.id,
            invite_by_provider_id,
            link_by_provider_id,
        )

        if account_state is not None and provider_account_state != account_state:
            continue

        completion_values: list[ProviderWeeklyAvailabilityCompletion] = []

        for schedule_week in schedule_weeks:
            rows = rows_for_provider_week(schedule_week.id, provider.id, organization_id, session)
            availability = build_read_response(schedule_week, provider.id, rows)
            completion = availability_completion(schedule_week, availability)
            completion_values.append(completion)

        incomplete_completions = [
            completion
            for completion in completion_values
            if not completion.is_complete
        ]
        incomplete_count = len(incomplete_completions)
        open_week_count = len(schedule_weeks)
        all_open_weeks_complete = incomplete_count == 0

        if open_week_availability_complete is not None:
            completion_matches_filter = all_open_weeks_complete == open_week_availability_complete

            if not completion_matches_filter:
                continue

        updated_statement = select(func.max(ProviderScheduleWeekAvailability.updated_at))
        updated_statement = updated_statement.where(ProviderScheduleWeekAvailability.organization_id == organization_id)
        updated_statement = updated_statement.where(ProviderScheduleWeekAvailability.provider_id == provider.id)
        last_availability_update_at = session.scalar(updated_statement)
        status_row = AdminProviderStatusRow(
            provider_id=provider.id,
            provider_name=provider.display_name,
            provider_email=provider.email,
            account_state=provider_account_state,
            last_availability_update_at=last_availability_update_at,
            open_week_count=open_week_count,
            incomplete_open_required_week_count=incomplete_count,
            open_week_availability_complete=all_open_weeks_complete,
        )
        status_rows.append(status_row)

    return status_rows
