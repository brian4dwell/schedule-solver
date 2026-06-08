from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ProviderScheduleWeekAvailability


def weekly_availability_rows_for_period(
    schedule_period_id: UUID,
    organization_id: UUID,
    session: Session,
) -> list[ProviderScheduleWeekAvailability]:
    statement = select(ProviderScheduleWeekAvailability)
    statement = statement.where(ProviderScheduleWeekAvailability.schedule_week_id == schedule_period_id)
    statement = statement.where(ProviderScheduleWeekAvailability.organization_id == organization_id)
    statement = statement.order_by(
        ProviderScheduleWeekAvailability.provider_id,
        ProviderScheduleWeekAvailability.weekday,
    )
    availability_rows = list(session.scalars(statement))
    return availability_rows


def create_cloned_weekly_availability_row(
    source_availability: ProviderScheduleWeekAvailability,
    target_schedule_period_id: UUID,
) -> ProviderScheduleWeekAvailability:
    availability_options = list(source_availability.availability_options)
    availability = ProviderScheduleWeekAvailability(
        organization_id=source_availability.organization_id,
        schedule_week_id=target_schedule_period_id,
        provider_id=source_availability.provider_id,
        weekday=source_availability.weekday,
        availability_options=availability_options,
        min_shifts_requested=source_availability.min_shifts_requested,
        max_shifts_requested=source_availability.max_shifts_requested,
        min_shifts_requested_units=source_availability.min_shifts_requested_units,
        max_shifts_requested_units=source_availability.max_shifts_requested_units,
    )
    return availability


def clone_weekly_availability_for_period(
    source_schedule_period_id: UUID,
    target_schedule_period_id: UUID,
    organization_id: UUID,
    session: Session,
) -> None:
    source_availability_rows = weekly_availability_rows_for_period(
        source_schedule_period_id,
        organization_id,
        session,
    )

    for source_availability in source_availability_rows:
        availability = create_cloned_weekly_availability_row(
            source_availability,
            target_schedule_period_id,
        )
        session.add(availability)
