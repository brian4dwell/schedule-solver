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

router = APIRouter(tags=["provider-availability"])


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
    day_values: list[ProviderAvailabilityDayRead] = []

    for weekday in WEEKDAY_VALUES:
        row = row_by_weekday.get(weekday)
        options = ["unset"]

        if row is not None:
            options = row.availability_options

        day_values.append(ProviderAvailabilityDayRead(weekday=weekday, options=options))

    is_locked = schedule_week_is_locked(schedule_week)
    response = ProviderWeeklyAvailabilityRead(
        schedule_week_id=schedule_week.id,
        provider_id=provider_id,
        is_locked=is_locked,
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

    for day in request.days:
        created_row = ProviderScheduleWeekAvailability(
            organization_id=organization_id,
            schedule_week_id=schedule_week_id,
            provider_id=provider_id,
            weekday=day.weekday,
            availability_options=day.options,
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
