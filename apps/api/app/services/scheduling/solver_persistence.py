from uuid import UUID

from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Assignment
from app.db.models import ConstraintViolation
from app.db.models import ScheduleVersion
from app.services.scheduling.solver_contracts import SolverAssignment
from app.services.scheduling.solver_contracts import SolverResult
from app.services.scheduling.solver_contracts import SolverViolation


def next_solver_version_number(
    schedule_period_id: UUID,
    organization_id: UUID,
    session: Session,
) -> int:
    statement = select(func.max(ScheduleVersion.version_number))
    statement = statement.where(ScheduleVersion.schedule_period_id == schedule_period_id)
    statement = statement.where(ScheduleVersion.organization_id == organization_id)
    current_max_version = session.scalar(statement)

    if current_max_version is None:
        return 1

    version_number = int(current_max_version) + 1
    return version_number


def create_schedule_version(
    schedule_period_id: UUID,
    parent_schedule_version_id: UUID | None,
    solver_result: SolverResult,
    notes: str | None,
    organization_id: UUID,
    session: Session,
) -> ScheduleVersion:
    version_number = next_solver_version_number(
        schedule_period_id,
        organization_id,
        session,
    )
    schedule_version = ScheduleVersion(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        schedule_job_id=None,
        version_number=version_number,
        status="draft",
        source="solver",
        parent_schedule_version_id=parent_schedule_version_id,
        published_at=None,
        published_by_user_id=None,
        created_by_user_id=None,
        solver_score=solver_result.solver_score,
        notes=notes,
    )
    session.add(schedule_version)
    session.flush()
    return schedule_version


def create_assignment(
    solver_assignment: SolverAssignment,
    schedule_version: ScheduleVersion,
    organization_id: UUID,
) -> Assignment:
    assignment = Assignment(
        organization_id=organization_id,
        schedule_version_id=schedule_version.id,
        schedule_period_id=schedule_version.schedule_period_id,
        provider_id=solver_assignment.provider_id,
        center_id=solver_assignment.center_id,
        room_id=solver_assignment.room_id,
        shift_requirement_id=solver_assignment.shift_requirement_id,
        required_provider_type=solver_assignment.required_provider_type,
        start_time=solver_assignment.start_time,
        end_time=solver_assignment.end_time,
        assignment_status="draft",
        source="solver",
        notes=None,
    )
    return assignment


def create_constraint_violation(
    solver_violation: SolverViolation,
    schedule_version: ScheduleVersion,
    organization_id: UUID,
) -> ConstraintViolation:
    constraint_violation = ConstraintViolation(
        organization_id=organization_id,
        schedule_version_id=schedule_version.id,
        assignment_id=None,
        severity=solver_violation.severity,
        constraint_type=solver_violation.constraint_type,
        message=solver_violation.message,
        metadata_json=None,
    )
    return constraint_violation


def persist_solver_result(
    schedule_period_id: UUID,
    parent_schedule_version_id: UUID | None,
    solver_result: SolverResult,
    notes: str | None,
    organization_id: UUID,
    session: Session,
) -> tuple[ScheduleVersion, list[Assignment], list[ConstraintViolation]]:
    schedule_version = create_schedule_version(
        schedule_period_id,
        parent_schedule_version_id,
        solver_result,
        notes,
        organization_id,
        session,
    )
    assignments: list[Assignment] = []

    for solver_assignment in solver_result.assignments:
        assignment = create_assignment(
            solver_assignment,
            schedule_version,
            organization_id,
        )
        session.add(assignment)
        assignments.append(assignment)

    violations: list[ConstraintViolation] = []

    for solver_violation in solver_result.violations:
        constraint_violation = create_constraint_violation(
            solver_violation,
            schedule_version,
            organization_id,
        )
        session.add(constraint_violation)
        violations.append(constraint_violation)

    session.commit()
    session.refresh(schedule_version)

    for assignment in assignments:
        session.refresh(assignment)

    for violation in violations:
        session.refresh(violation)

    return schedule_version, assignments, violations
