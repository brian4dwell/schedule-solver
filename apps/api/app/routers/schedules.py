from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Assignment
from app.db.models import ConstraintViolation
from app.db.models import SchedulePeriod
from app.db.models import ScheduleVersion
from app.db.session import get_db
from app.dependencies import get_current_organization_id
from app.schemas.schedule import ProviderEligibilityRequest
from app.schemas.schedule import ScheduleDraftSaveRequest
from app.schemas.schedule import ScheduleDraftSaveResponse
from app.schemas.schedule import SchedulePublishResponse
from app.services.scheduling.provider_eligibility import check_provider_slot_eligibility
from app.services.scheduling.provider_eligibility_contracts import ProviderEligibilityViolation
from app.services.scheduling.provider_eligibility_contracts import ProviderSlotEligibilityInput
from app.services.scheduling.provider_eligibility_contracts import ProviderSlotEligibilityResult

router = APIRouter(tags=["schedules"])


def require_schedule_period(
    schedule_period_id: UUID,
    organization_id: UUID,
    session: Session,
) -> SchedulePeriod:
    statement = select(SchedulePeriod).where(SchedulePeriod.id == schedule_period_id)
    statement = statement.where(SchedulePeriod.organization_id == organization_id)
    schedule_period = session.scalar(statement)

    if schedule_period is None:
        raise HTTPException(status_code=404, detail="Schedule period not found")

    return schedule_period


def require_schedule_version(
    schedule_version_id: UUID,
    organization_id: UUID,
    session: Session,
) -> ScheduleVersion:
    statement = select(ScheduleVersion).where(ScheduleVersion.id == schedule_version_id)
    statement = statement.where(ScheduleVersion.organization_id == organization_id)
    schedule_version = session.scalar(statement)

    if schedule_version is None:
        raise HTTPException(status_code=404, detail="Schedule version not found")

    return schedule_version


def next_version_number(
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


def eligibility_input_from_request(
    request: ProviderEligibilityRequest,
    organization_id: UUID,
) -> ProviderSlotEligibilityInput:
    eligibility_input = ProviderSlotEligibilityInput(
        organization_id=organization_id,
        schedule_version_id=request.schedule_version_id,
        assignment_id=request.assignment_id,
        provider_id=request.provider_id,
        center_id=request.center_id,
        room_id=request.room_id,
        required_provider_type=request.required_provider_type,
        start_time=request.start_time,
        end_time=request.end_time,
    )
    return eligibility_input


def eligibility_input_from_assignment(
    assignment: Assignment,
    required_provider_type: str | None,
    organization_id: UUID,
) -> ProviderSlotEligibilityInput:
    eligibility_input = ProviderSlotEligibilityInput(
        organization_id=organization_id,
        schedule_version_id=assignment.schedule_version_id,
        assignment_id=assignment.id,
        provider_id=assignment.provider_id,
        center_id=assignment.center_id,
        room_id=assignment.room_id,
        required_provider_type=required_provider_type,
        start_time=assignment.start_time,
        end_time=assignment.end_time,
    )
    return eligibility_input


def constraint_violation_from_result(
    result: ProviderSlotEligibilityResult,
    assignment: Assignment,
    violation: ProviderEligibilityViolation,
    organization_id: UUID,
) -> ConstraintViolation:
    metadata_json = {
        "provider_id": str(result.provider_id),
        "category": violation.category,
    }
    constraint_violation = ConstraintViolation(
        organization_id=organization_id,
        schedule_version_id=assignment.schedule_version_id,
        assignment_id=assignment.id,
        severity=violation.severity,
        constraint_type=violation.constraint_type,
        message=violation.message,
        metadata_json=metadata_json,
    )
    return constraint_violation


def validate_parent_version(
    parent_schedule_version_id: UUID | None,
    schedule_period_id: UUID,
    organization_id: UUID,
    session: Session,
) -> None:
    if parent_schedule_version_id is None:
        return

    parent_version = require_schedule_version(
        parent_schedule_version_id,
        organization_id,
        session,
    )
    belongs_to_period = parent_version.schedule_period_id == schedule_period_id

    if not belongs_to_period:
        raise HTTPException(status_code=400, detail="Parent version belongs to another period")


def assignments_for_version(
    schedule_version_id: UUID,
    organization_id: UUID,
    session: Session,
) -> list[Assignment]:
    statement = select(Assignment).where(Assignment.schedule_version_id == schedule_version_id)
    statement = statement.where(Assignment.organization_id == organization_id)
    assignments = list(session.scalars(statement))
    return assignments


@router.post("/schedule-provider-eligibility", response_model=ProviderSlotEligibilityResult)
def read_provider_eligibility(
    request: ProviderEligibilityRequest,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> ProviderSlotEligibilityResult:
    eligibility_input = eligibility_input_from_request(request, organization_id)

    try:
        result = check_provider_slot_eligibility(eligibility_input, session)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    return result


@router.post("/schedule-versions/draft", response_model=ScheduleDraftSaveResponse, status_code=201)
def save_draft_schedule_version(
    request: ScheduleDraftSaveRequest,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> ScheduleDraftSaveResponse:
    require_schedule_period(request.schedule_period_id, organization_id, session)
    validate_parent_version(
        request.parent_schedule_version_id,
        request.schedule_period_id,
        organization_id,
        session,
    )
    version_number = next_version_number(
        request.schedule_period_id,
        organization_id,
        session,
    )
    schedule_version = ScheduleVersion(
        organization_id=organization_id,
        schedule_period_id=request.schedule_period_id,
        schedule_job_id=None,
        version_number=version_number,
        status="draft",
        solver_score=None,
        notes=request.notes,
    )
    session.add(schedule_version)
    session.flush()
    assignments: list[Assignment] = []

    for requested_assignment in request.assignments:
        assignment = Assignment(
            organization_id=organization_id,
            schedule_version_id=schedule_version.id,
            schedule_period_id=request.schedule_period_id,
            provider_id=requested_assignment.provider_id,
            center_id=requested_assignment.center_id,
            room_id=requested_assignment.room_id,
            shift_requirement_id=requested_assignment.shift_requirement_id,
            required_provider_type=requested_assignment.required_provider_type,
            start_time=requested_assignment.start_time,
            end_time=requested_assignment.end_time,
            assignment_status="draft",
            source=requested_assignment.source,
            notes=requested_assignment.notes,
        )
        session.add(assignment)
        assignments.append(assignment)

    session.flush()
    violations: list[ConstraintViolation] = []

    for assignment_index, assignment in enumerate(assignments):
        requested_assignment = request.assignments[assignment_index]
        eligibility_input = eligibility_input_from_assignment(
            assignment,
            requested_assignment.required_provider_type,
            organization_id,
        )

        try:
            result = check_provider_slot_eligibility(eligibility_input, session)
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

        for violation in result.violations:
            constraint_violation = constraint_violation_from_result(
                result,
                assignment,
                violation,
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

    response = ScheduleDraftSaveResponse(
        version=schedule_version,
        assignments=assignments,
        violations=violations,
    )
    return response


@router.post("/schedule-versions/{schedule_version_id}/publish", response_model=SchedulePublishResponse)
def publish_schedule_version(
    schedule_version_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> SchedulePublishResponse:
    schedule_version = require_schedule_version(schedule_version_id, organization_id, session)
    assignments = assignments_for_version(schedule_version_id, organization_id, session)
    violations: list[ProviderEligibilityViolation] = []

    for assignment in assignments:
        eligibility_input = eligibility_input_from_assignment(
            assignment,
            assignment.required_provider_type,
            organization_id,
        )

        try:
            result = check_provider_slot_eligibility(eligibility_input, session)
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

        violations.extend(result.violations)

    if len(violations) > 0:
        response = SchedulePublishResponse(
            version=schedule_version,
            violations=violations,
        )
        raise HTTPException(status_code=409, detail=response.model_dump(mode="json"))

    schedule_version.status = "published"
    session.commit()
    session.refresh(schedule_version)
    response = SchedulePublishResponse(
        version=schedule_version,
        violations=[],
    )
    return response
