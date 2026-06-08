from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Assignment
from app.db.models import ConstraintViolation
from app.db.models import Provider
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import ScheduleVersion
from app.services.scheduling.shift_request_units import shift_request_units_for_shift_type
from app.services.scheduling.shift_request_units import shift_units_text


def active_providers_for_shift_request_warnings(
    organization_id: UUID,
    session: Session,
) -> list[Provider]:
    statement = select(Provider)
    statement = statement.where(Provider.organization_id == organization_id)
    statement = statement.where(Provider.is_active.is_(True))
    statement = statement.order_by(Provider.display_name)
    providers = list(session.scalars(statement))
    return providers


def weekly_availability_rows_for_shift_request_warnings(
    schedule_period_id: UUID,
    organization_id: UUID,
    session: Session,
) -> list[ProviderScheduleWeekAvailability]:
    statement = select(ProviderScheduleWeekAvailability)
    statement = statement.where(ProviderScheduleWeekAvailability.organization_id == organization_id)
    statement = statement.where(ProviderScheduleWeekAvailability.schedule_week_id == schedule_period_id)
    statement = statement.order_by(
        ProviderScheduleWeekAvailability.provider_id,
        ProviderScheduleWeekAvailability.weekday,
    )
    availability_rows = list(session.scalars(statement))
    return availability_rows


def weekly_availability_for_shift_request_warning(
    provider_id: UUID,
    availability_rows: list[ProviderScheduleWeekAvailability],
) -> ProviderScheduleWeekAvailability | None:
    for availability in availability_rows:
        provider_matches = availability.provider_id == provider_id

        if provider_matches:
            return availability

    return None


def assignment_units_for_provider(
    provider_id: UUID,
    assignments: list[Assignment],
) -> int:
    assignment_units = 0

    for assignment in assignments:
        provider_matches = assignment.provider_id == provider_id

        if not provider_matches:
            continue

        shift_units = shift_request_units_for_shift_type(assignment.shift_type)
        assignment_units = assignment_units + shift_units

    return assignment_units


def create_shift_request_constraint_violation(
    provider: Provider,
    schedule_version: ScheduleVersion,
    organization_id: UUID,
    constraint_type: str,
    message: str,
    assigned_shift_units: int,
    requested_shift_units: int,
) -> ConstraintViolation:
    assigned_shift_count = shift_units_text(assigned_shift_units)
    requested_shift_count = shift_units_text(requested_shift_units)
    metadata_json = {
        "provider_id": str(provider.id),
        "assigned_shift_count": assigned_shift_count,
        "requested_shift_count": requested_shift_count,
        "assigned_shift_units": assigned_shift_units,
        "requested_shift_units": requested_shift_units,
    }
    constraint_violation = ConstraintViolation(
        organization_id=organization_id,
        schedule_version_id=schedule_version.id,
        assignment_id=None,
        severity="warning",
        constraint_type=constraint_type,
        message=message,
        metadata_json=metadata_json,
    )
    return constraint_violation


def shift_request_constraint_violations_for_provider(
    provider: Provider,
    assignments: list[Assignment],
    availability: ProviderScheduleWeekAvailability,
    schedule_version: ScheduleVersion,
    organization_id: UUID,
) -> list[ConstraintViolation]:
    violations: list[ConstraintViolation] = []
    assigned_shift_units = assignment_units_for_provider(provider.id, assignments)
    assigned_shift_count = shift_units_text(assigned_shift_units)
    min_shifts_requested_units = availability.min_shifts_requested_units
    max_shifts_requested_units = availability.max_shifts_requested_units
    min_shifts_requested = shift_units_text(min_shifts_requested_units)
    max_shifts_requested = shift_units_text(max_shifts_requested_units)
    provider_is_below_minimum = assigned_shift_units < min_shifts_requested_units
    provider_is_above_maximum = assigned_shift_units > max_shifts_requested_units

    if provider_is_below_minimum:
        message = (
            f"{provider.display_name} is scheduled for "
            f"{assigned_shift_count}/{min_shifts_requested} requested minimum shifts."
        )
        violation = create_shift_request_constraint_violation(
            provider,
            schedule_version,
            organization_id,
            "provider_min_shifts_not_met",
            message,
            assigned_shift_units,
            min_shifts_requested_units,
        )
        violations.append(violation)

    if provider_is_above_maximum:
        message = (
            f"{provider.display_name} is scheduled for "
            f"{assigned_shift_count}/{max_shifts_requested} requested maximum shifts."
        )
        violation = create_shift_request_constraint_violation(
            provider,
            schedule_version,
            organization_id,
            "provider_max_shifts_exceeded",
            message,
            assigned_shift_units,
            max_shifts_requested_units,
        )
        violations.append(violation)

    return violations


def shift_request_constraint_violations(
    assignments: list[Assignment],
    schedule_version: ScheduleVersion,
    organization_id: UUID,
    session: Session,
) -> list[ConstraintViolation]:
    providers = active_providers_for_shift_request_warnings(
        organization_id,
        session,
    )
    availability_rows = weekly_availability_rows_for_shift_request_warnings(
        schedule_version.schedule_period_id,
        organization_id,
        session,
    )
    violations: list[ConstraintViolation] = []

    for provider in providers:
        availability = weekly_availability_for_shift_request_warning(
            provider.id,
            availability_rows,
        )

        if availability is None:
            continue

        provider_violations = shift_request_constraint_violations_for_provider(
            provider,
            assignments,
            availability,
            schedule_version,
            organization_id,
        )
        violations.extend(provider_violations)

    return violations
