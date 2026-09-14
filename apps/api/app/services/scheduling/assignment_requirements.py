from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ShiftRequirement


def required_provider_type_for_assignment(
    requirement_id: UUID | None,
    supplied_type: str | None,
    organization_id: UUID,
    session: Session,
) -> str | None:
    if requirement_id is None:
        return supplied_type

    statement = select(ShiftRequirement)
    statement = statement.where(ShiftRequirement.id == requirement_id)
    statement = statement.where(ShiftRequirement.organization_id == organization_id)
    requirement = session.scalar(statement)

    if requirement is None:
        raise ValueError("Shift requirement not found")

    return requirement.required_provider_type
