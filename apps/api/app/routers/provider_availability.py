from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Provider
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import SchedulePeriod
from app.db.session import get_db
from app.dependencies import get_current_organization_id
from app.schemas.provider_availability_week import ProviderAvailabilityDayRead
from app.schemas.provider_availability_week import ProviderWeeklyAvailabilityRead
from app.schemas.provider_availability_week import ProviderWeeklyAvailabilityReplaceRequest
from app.schemas.provider_availability_week import WEEKDAY_VALUES
from app.schemas.provider_availability_week import options_include_work_availability

router = APIRouter(tags=["provider-availability"])
DEFAULT_MIN_SHIFTS_REQUESTED = 0
DEFAULT_MAX_SHIFTS_REQUESTED = 0
WEEKEND_VALUES = ["saturday", "sunday"]


def default_options_for_weekday(weekday: str) -> list[str]:
    weekday_is_weekend = weekday in WEEKEND_VALUES
    default_options = ["none"] if weekday_is_weekend else ["unset"]
    return default_options


def require_schedule_week(schedule_week_id: UUID, organization_id: UUID, session: Session) -> SchedulePeriod:
    statement = select(SchedulePeriod).where(SchedulePeriod.id == schedule_week_id)
    statement = statement.where(SchedulePeriod.organization_id == organization_id)
    schedule_week = session.scalar(statement)

    if schedule_week is None:
        raise HTTPException(status_code=404, detail="Schedule week not found")

    return schedule_week


def require_provider(provider_id: UUID, organization_id: UUID, session: Session) -> Provider:
    statement = select(Provider).where(Provider.id == provider_id)
    statement = statement.where(Provider.organization_id == organization_id)
    provider = session.scalar(statement)

    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found")

    return provider


def schedule_week_is_locked(schedule_week: SchedulePeriod) -> bool:
    week_status = schedule_week.status
    week_is_published = week_status == "published"
    is_locked = week_is_published
    return is_locked


def rows_for_provider_week(schedule_week_id: UUID, provider_id: UUID, organization_id: UUID, session: Session) -> list[ProviderScheduleWeekAvailability]:
    statement = select(ProviderScheduleWeekAvailability)
    statement = statement.where(ProviderScheduleWeekAvailability.schedule_week_id == schedule_week_id)
    statement = statement.where(ProviderScheduleWeekAvailability.provider_id == provider_id)
    statement = statement.where(ProviderScheduleWeekAvailability.organization_id == organization_id)
    rows = list(session.scalars(statement))
    return rows


def build_read_response(schedule_week: SchedulePeriod, provider_id: UUID, rows: list[ProviderScheduleWeekAvailability]) -> ProviderWeeklyAvailabilityRead:
    row_by_weekday = {row.weekday: row for row in rows}
    first_row = rows[0] if len(rows) > 0 else None
    min_shifts_requested = DEFAULT_MIN_SHIFTS_REQUESTED
    max_shifts_requested = DEFAULT_MAX_SHIFTS_REQUESTED
    day_values: list[ProviderAvailabilityDayRead] = []

    if first_row is not None:
        min_shifts_requested = first_row.min_shifts_requested
        max_shifts_requested = first_row.max_shifts_requested

    for weekday in WEEKDAY_VALUES:
        row = row_by_weekday.get(weekday)
        options = default_options_for_weekday(weekday)

        if row is not None:
            options = row.availability_options

        day_values.append(ProviderAvailabilityDayRead(weekday=weekday, options=options))

    work_available_days = [day for day in day_values if options_include_work_availability(day.options)]
    work_available_day_count = len(work_available_days)
    max_shifts_requested = min(max_shifts_requested, work_available_day_count)
    min_shifts_requested = min(min_shifts_requested, max_shifts_requested)
    is_locked = schedule_week_is_locked(schedule_week)
    response = ProviderWeeklyAvailabilityRead(
        schedule_week_id=schedule_week.id,
        provider_id=provider_id,
        is_locked=is_locked,
        min_shifts_requested=min_shifts_requested,
        max_shifts_requested=max_shifts_requested,
        days=day_values,
    )
    return response


@router.get("/schedule-weeks/{schedule_week_id}/providers/{provider_id}/availability", response_model=ProviderWeeklyAvailabilityRead)
def read_provider_weekly_availability(schedule_week_id: UUID, provider_id: UUID, organization_id: UUID = Depends(get_current_organization_id), session: Session = Depends(get_db)) -> ProviderWeeklyAvailabilityRead:
    schedule_week = require_schedule_week(schedule_week_id, organization_id, session)
    require_provider(provider_id, organization_id, session)
    rows = rows_for_provider_week(schedule_week_id, provider_id, organization_id, session)
    response = build_read_response(schedule_week, provider_id, rows)
    return response


@router.put("/schedule-weeks/{schedule_week_id}/providers/{provider_id}/availability", response_model=ProviderWeeklyAvailabilityRead)
def replace_provider_weekly_availability(schedule_week_id: UUID, provider_id: UUID, request: ProviderWeeklyAvailabilityReplaceRequest, organization_id: UUID = Depends(get_current_organization_id), session: Session = Depends(get_db)) -> ProviderWeeklyAvailabilityRead:
    schedule_week = require_schedule_week(schedule_week_id, organization_id, session)
    require_provider(provider_id, organization_id, session)

    if schedule_week_is_locked(schedule_week):
        raise HTTPException(status_code=409, detail="Availability is locked for published weeks")

    existing_rows = rows_for_provider_week(schedule_week_id, provider_id, organization_id, session)

    for row in existing_rows:
        session.delete(row)

    session.flush()

    for day in request.days:
        created_row = ProviderScheduleWeekAvailability(
            organization_id=organization_id,
            schedule_week_id=schedule_week_id,
            provider_id=provider_id,
            weekday=day.weekday,
            availability_options=day.options,
            min_shifts_requested=request.min_shifts_requested,
            max_shifts_requested=request.max_shifts_requested,
        )
        session.add(created_row)

    session.commit()
    rows = rows_for_provider_week(schedule_week_id, provider_id, organization_id, session)
    response = build_read_response(schedule_week, provider_id, rows)
    return response


@router.delete("/schedule-weeks/{schedule_week_id}/providers/{provider_id}/availability", response_model=ProviderWeeklyAvailabilityRead)
def delete_provider_weekly_availability(schedule_week_id: UUID, provider_id: UUID, organization_id: UUID = Depends(get_current_organization_id), session: Session = Depends(get_db)) -> ProviderWeeklyAvailabilityRead:
    schedule_week = require_schedule_week(schedule_week_id, organization_id, session)
    require_provider(provider_id, organization_id, session)

    if schedule_week_is_locked(schedule_week):
        raise HTTPException(status_code=409, detail="Availability is locked for published weeks")

    rows = rows_for_provider_week(schedule_week_id, provider_id, organization_id, session)

    for row in rows:
        session.delete(row)

    session.commit()
    remaining_rows: list[ProviderScheduleWeekAvailability] = []
    response = build_read_response(schedule_week, provider_id, remaining_rows)
    return response
