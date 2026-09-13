from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Assignment
from app.db.models import ConstraintViolation
from app.db.models import ScheduleVersion
from app.services.scheduling.provider_eligibility import create_violation
from app.services.scheduling.provider_eligibility_contracts import ProviderEligibilityViolation


def schedule_publish_violations(
    version: ScheduleVersion,
    assignments: list[Assignment],
    organization_id: UUID,
    session: Session,
) -> list[ProviderEligibilityViolation]:
    violations: list[ProviderEligibilityViolation] = []

    if len(assignments) == 0:
        violation = create_violation(
            "empty_schedule",
            "other_hard_constraint",
            "An empty schedule cannot be published.",
        )
        violations.append(violation)

    # Saved versions are immutable. A corrected draft receives fresh validation.
    # Recheck assignment eligibility separately; retain unresolved solve/coverage failures.
    statement = select(ConstraintViolation)
    statement = statement.where(ConstraintViolation.organization_id == organization_id)
    statement = statement.where(ConstraintViolation.schedule_version_id == version.id)
    statement = statement.where(ConstraintViolation.assignment_id.is_(None))
    statement = statement.where(ConstraintViolation.severity == "hard_violation")
    stored_violations = session.scalars(statement)

    for stored_violation in stored_violations:
        violation = create_violation(
            stored_violation.constraint_type,
            "other_hard_constraint",
            stored_violation.message,
        )
        violations.append(violation)

    return violations
