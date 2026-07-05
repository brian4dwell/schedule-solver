from datetime import UTC
from datetime import date
from datetime import datetime
from datetime import time
from uuid import UUID
from uuid import uuid4

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import delete as sqlalchemy_delete
from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy import update as sqlalchemy_update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.config import get_settings
from app.db.models import Assignment
from app.db.models import ConstraintViolation
from app.db.models import Provider
from app.db.models import ProviderFairnessEvent
from app.db.models import ProviderFairnessSnapshot
from app.db.models import ProviderFairnessState
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import Room
from app.db.models import Center
from app.db.models import ScheduleJob
from app.db.models import SchedulePeriod
from app.db.models import ScheduleStructureTemplate
from app.db.models import ScheduleStructureTemplateSlot
from app.db.models import ScheduleVersion
from app.db.session import get_db
from app.dependencies import get_current_organization_id
from app.dependencies import require_admin_user
from app.schemas.schedule import CalendarAvailabilityEmailRecipientRead
from app.schemas.schedule import CalendarAvailabilityEmailSendRead
from app.schemas.schedule import ProviderEligibilityRequest
from app.schemas.schedule import AssignmentRead
from app.schemas.schedule import ConstraintViolationRead
from app.schemas.schedule import ScheduleDraftSaveRequest
from app.schemas.schedule import ScheduleDraftSaveResponse
from app.schemas.schedule import ScheduleGenerateRequest
from app.schemas.schedule import ScheduleGenerateResponse
from app.schemas.schedule import ScheduleAssignmentCreate
from app.schemas.schedule import SchedulePeriodCloneResponse
from app.schemas.schedule import SchedulePeriodCreate
from app.schemas.schedule import SchedulePeriodRead
from app.schemas.schedule import SchedulePeriodRenameRequest
from app.schemas.schedule import SchedulePublishResponse
from app.schemas.schedule import ScheduleStructureTemplateAppliedSlot
from app.schemas.schedule import ScheduleStructureTemplateApplyRequest
from app.schemas.schedule import ScheduleStructureTemplateApplyResponse
from app.schemas.schedule import ScheduleStructureTemplateRead
from app.schemas.schedule import ScheduleStructureTemplateSkippedSlot
from app.schemas.schedule import ScheduleStructureTemplateSlotRead
from app.schemas.schedule import ScheduleStructureTemplateSlotWrite
from app.schemas.schedule import ScheduleStructureTemplateWrite
from app.schemas.schedule import ScheduleTemplateWeekday
from app.schemas.schedule import ScheduleVersionDetailRead
from app.schemas.schedule import ScheduleVersionRead
from app.db.models.scheduling import current_utc_time
from app.services.email.calendar_availability import CalendarAvailabilityEmailMessage
from app.services.email.calendar_availability import CalendarAvailabilityEmailSendResult
from app.services.email.calendar_availability import calendar_availability_email_message
from app.services.email.gmail import GmailProviderInviteEmailSender
from app.services.email.gmail import GmailSendError
from app.services.scheduling.availability_service import clone_weekly_availability_for_period
from app.services.scheduling.fairness import rebuild_published_fairness_state
from app.services.scheduling.fairness import record_fairness_for_schedule_version
from app.services.scheduling.provider_eligibility import check_provider_slot_eligibility
from app.services.scheduling.provider_eligibility_contracts import ProviderEligibilityViolation
from app.services.scheduling.provider_eligibility_contracts import ProviderSlotEligibilityInput
from app.services.scheduling.provider_eligibility_contracts import ProviderSlotEligibilityResult
from app.services.scheduling.shift_request_warning_service import shift_request_constraint_violations
from app.services.scheduling.solver_service import generate_schedule_draft

router = APIRouter(tags=["schedules"], dependencies=[Depends(require_admin_user)])


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


def require_open_schedule_period(schedule_period: SchedulePeriod) -> None:
    schedule_period_status = schedule_period.status
    schedule_period_is_open = schedule_period_status == "draft"

    if not schedule_period_is_open:
        detail = "Availability email can only be sent for open schedule weeks"
        raise HTTPException(status_code=409, detail=detail)


def active_providers_with_email(organization_id: UUID, session: Session) -> list[Provider]:
    statement = select(Provider)
    statement = statement.where(Provider.organization_id == organization_id)
    statement = statement.where(Provider.is_active.is_(True))
    statement = statement.where(Provider.email.is_not(None))
    statement = statement.order_by(Provider.display_name, Provider.id)
    providers = list(session.scalars(statement))
    return providers


def require_provider_portal_base_url(settings: Settings) -> str:
    provider_portal_base_url = settings.provider_portal_base_url

    if provider_portal_base_url is None:
        raise HTTPException(status_code=500, detail="Provider Portal base URL is not configured")

    return provider_portal_base_url


def require_gmail_sender_email(settings: Settings) -> str:
    gmail_sender_email = settings.gmail_sender_email

    if gmail_sender_email is None:
        raise HTTPException(status_code=500, detail="Gmail sender email is not configured")

    sender_email = str(gmail_sender_email)
    return sender_email


def require_gmail_app_password(settings: Settings) -> str:
    gmail_app_password = settings.gmail_app_password

    if gmail_app_password is None:
        raise HTTPException(status_code=500, detail="Gmail app password is not configured")

    app_password = gmail_app_password.get_secret_value()
    return app_password


def send_calendar_availability_email_message(
    message: CalendarAvailabilityEmailMessage,
    settings: Settings,
) -> CalendarAvailabilityEmailSendResult:
    app_password = require_gmail_app_password(settings)
    sender_email = require_gmail_sender_email(settings)
    sender = GmailProviderInviteEmailSender(app_password, sender_email)
    result = sender.send_calendar_availability(message)
    return result


def send_calendar_availability_email_to_provider(
    provider: Provider,
    schedule_period: SchedulePeriod,
    provider_portal_base_url: str,
    sender_email: str,
    settings: Settings,
) -> CalendarAvailabilityEmailRecipientRead:
    message = calendar_availability_email_message(
        provider,
        schedule_period,
        provider_portal_base_url,
        sender_email,
    )
    send_result = send_calendar_availability_email_message(message, settings)
    recipient = CalendarAvailabilityEmailRecipientRead(
        provider_id=provider.id,
        recipient_email=str(message.recipient_email),
        gmail_message_id=send_result.gmail_message_id,
        sent_at=send_result.sent_at,
    )
    return recipient


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
        schedule_period_id=request.schedule_period_id,
        schedule_version_id=request.schedule_version_id,
        assignment_id=request.assignment_id,
        provider_id=request.provider_id,
        center_id=request.center_id,
        room_id=request.room_id,
        required_provider_type=request.required_provider_type,
        shift_type=request.shift_type,
        start_time=request.start_time,
        end_time=request.end_time,
    )
    return eligibility_input


def eligibility_input_from_assignment(
    assignment: Assignment,
    required_provider_type: str | None,
    organization_id: UUID,
) -> ProviderSlotEligibilityInput:
    provider_id = assignment.provider_id

    if provider_id is None:
        raise ValueError("Provider is required for eligibility checks")

    eligibility_input = ProviderSlotEligibilityInput(
        organization_id=organization_id,
        schedule_period_id=assignment.schedule_period_id,
        schedule_version_id=assignment.schedule_version_id,
        assignment_id=assignment.id,
        provider_id=provider_id,
        center_id=assignment.center_id,
        room_id=assignment.room_id,
        required_provider_type=required_provider_type,
        shift_type=assignment.shift_type,
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


def unassigned_provider_violation() -> ProviderEligibilityViolation:
    violation = ProviderEligibilityViolation(
        severity="hard_violation",
        constraint_type="provider_assignment_required",
        category="other_hard_constraint",
        message="Assign a provider before publishing this slot.",
    )
    return violation


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
    statement = statement.order_by(Assignment.start_time, Assignment.created_at, Assignment.id)
    assignments = list(session.scalars(statement))
    return assignments


def violations_for_version(
    schedule_version_id: UUID,
    organization_id: UUID,
    session: Session,
) -> list[ConstraintViolation]:
    statement = select(ConstraintViolation)
    statement = statement.where(ConstraintViolation.schedule_version_id == schedule_version_id)
    statement = statement.where(ConstraintViolation.organization_id == organization_id)
    statement = statement.order_by(ConstraintViolation.created_at)
    violations = list(session.scalars(statement))
    return violations


def schedule_versions_for_period(
    schedule_period_id: UUID,
    organization_id: UUID,
    session: Session,
) -> list[ScheduleVersion]:
    statement = select(ScheduleVersion)
    statement = statement.where(ScheduleVersion.schedule_period_id == schedule_period_id)
    statement = statement.where(ScheduleVersion.organization_id == organization_id)
    statement = statement.order_by(ScheduleVersion.version_number.desc())
    schedule_versions = list(session.scalars(statement))
    return schedule_versions


def delete_constraint_violations_for_period(
    schedule_version_ids: list[UUID],
    organization_id: UUID,
    session: Session,
) -> None:
    has_schedule_versions = len(schedule_version_ids) > 0

    if not has_schedule_versions:
        return

    statement = sqlalchemy_delete(ConstraintViolation)
    statement = statement.where(ConstraintViolation.organization_id == organization_id)
    statement = statement.where(ConstraintViolation.schedule_version_id.in_(schedule_version_ids))
    session.execute(statement)


def clear_fairness_state_links_for_period(
    schedule_period_id: UUID,
    schedule_version_ids: list[UUID],
    organization_id: UUID,
    session: Session,
) -> None:
    statement = sqlalchemy_update(ProviderFairnessState)
    statement = statement.where(ProviderFairnessState.organization_id == organization_id)
    period_matches = ProviderFairnessState.last_applied_schedule_period_id == schedule_period_id

    if len(schedule_version_ids) > 0:
        version_matches = ProviderFairnessState.last_applied_schedule_version_id.in_(schedule_version_ids)
        statement = statement.where(period_matches | version_matches)
    else:
        statement = statement.where(period_matches)

    statement = statement.values(
        last_applied_schedule_period_id=None,
        last_applied_schedule_version_id=None,
    )
    session.execute(statement)


def delete_fairness_records_for_period(
    schedule_period_id: UUID,
    organization_id: UUID,
    session: Session,
) -> None:
    event_statement = sqlalchemy_delete(ProviderFairnessEvent)
    event_statement = event_statement.where(ProviderFairnessEvent.schedule_period_id == schedule_period_id)
    event_statement = event_statement.where(ProviderFairnessEvent.organization_id == organization_id)
    session.execute(event_statement)
    snapshot_statement = sqlalchemy_delete(ProviderFairnessSnapshot)
    snapshot_statement = snapshot_statement.where(ProviderFairnessSnapshot.schedule_period_id == schedule_period_id)
    snapshot_statement = snapshot_statement.where(ProviderFairnessSnapshot.organization_id == organization_id)
    session.execute(snapshot_statement)


def delete_assignments_for_period(
    schedule_period_id: UUID,
    organization_id: UUID,
    session: Session,
) -> None:
    statement = sqlalchemy_delete(Assignment)
    statement = statement.where(Assignment.schedule_period_id == schedule_period_id)
    statement = statement.where(Assignment.organization_id == organization_id)
    session.execute(statement)


def clear_parent_schedule_version_links(
    schedule_version_ids: list[UUID],
    organization_id: UUID,
    session: Session,
) -> None:
    has_schedule_versions = len(schedule_version_ids) > 0

    if not has_schedule_versions:
        return

    statement = sqlalchemy_update(ScheduleVersion)
    statement = statement.where(ScheduleVersion.organization_id == organization_id)
    statement = statement.where(ScheduleVersion.id.in_(schedule_version_ids))
    statement = statement.values(parent_schedule_version_id=None)
    session.execute(statement)


def delete_schedule_versions_for_period(
    schedule_version_ids: list[UUID],
    organization_id: UUID,
    session: Session,
) -> None:
    has_schedule_versions = len(schedule_version_ids) > 0

    if not has_schedule_versions:
        return

    statement = sqlalchemy_delete(ScheduleVersion)
    statement = statement.where(ScheduleVersion.organization_id == organization_id)
    statement = statement.where(ScheduleVersion.id.in_(schedule_version_ids))
    session.execute(statement)


def delete_schedule_jobs_for_period(
    schedule_period_id: UUID,
    organization_id: UUID,
    session: Session,
) -> None:
    statement = sqlalchemy_delete(ScheduleJob)
    statement = statement.where(ScheduleJob.schedule_period_id == schedule_period_id)
    statement = statement.where(ScheduleJob.organization_id == organization_id)
    session.execute(statement)


def delete_weekly_availability_for_period(
    schedule_period_id: UUID,
    organization_id: UUID,
    session: Session,
) -> None:
    statement = sqlalchemy_delete(ProviderScheduleWeekAvailability)
    statement = statement.where(ProviderScheduleWeekAvailability.schedule_week_id == schedule_period_id)
    statement = statement.where(ProviderScheduleWeekAvailability.organization_id == organization_id)
    session.execute(statement)


def validate_schedule_period_dates(request: SchedulePeriodCreate) -> None:
    end_is_before_start = request.end_date < request.start_date

    if end_is_before_start:
        raise HTTPException(status_code=400, detail="End date must be on or after start date")


def normalized_template_name(name: str) -> str:
    normalized_name = name.strip()
    has_name = len(normalized_name) > 0

    if not has_name:
        raise HTTPException(status_code=400, detail="Template name is required")

    return normalized_name


def require_schedule_structure_template(
    template_id: UUID,
    organization_id: UUID,
    session: Session,
) -> ScheduleStructureTemplate:
    statement = select(ScheduleStructureTemplate)
    statement = statement.where(ScheduleStructureTemplate.id == template_id)
    statement = statement.where(ScheduleStructureTemplate.organization_id == organization_id)
    template = session.scalar(statement)

    if template is None:
        raise HTTPException(status_code=404, detail="Schedule structure template not found")

    return template


def template_with_name(
    name: str,
    organization_id: UUID,
    session: Session,
) -> ScheduleStructureTemplate | None:
    statement = select(ScheduleStructureTemplate)
    statement = statement.where(ScheduleStructureTemplate.organization_id == organization_id)
    statement = statement.where(ScheduleStructureTemplate.name == name)
    template = session.scalar(statement)
    return template


def require_unique_template_name(
    name: str,
    organization_id: UUID,
    session: Session,
    current_template_id: UUID | None = None,
) -> None:
    template = template_with_name(name, organization_id, session)

    if template is None:
        return

    same_template = template.id == current_template_id

    if same_template:
        return

    raise HTTPException(status_code=409, detail="A schedule structure template with this name already exists")


def slots_for_template(
    template_id: UUID,
    organization_id: UUID,
    session: Session,
) -> list[ScheduleStructureTemplateSlot]:
    statement = select(ScheduleStructureTemplateSlot)
    statement = statement.where(ScheduleStructureTemplateSlot.template_id == template_id)
    statement = statement.where(ScheduleStructureTemplateSlot.organization_id == organization_id)
    statement = statement.order_by(
        ScheduleStructureTemplateSlot.weekday,
        ScheduleStructureTemplateSlot.display_order,
        ScheduleStructureTemplateSlot.id,
    )
    slots = list(session.scalars(statement))
    return slots


def read_model_for_template(
    template: ScheduleStructureTemplate,
    slots: list[ScheduleStructureTemplateSlot],
) -> ScheduleStructureTemplateRead:
    slot_reads = [
        ScheduleStructureTemplateSlotRead.model_validate(slot)
        for slot in slots
    ]
    template_read = ScheduleStructureTemplateRead.model_validate(template)
    template_read.slots = slot_reads
    return template_read


def create_template_slot(
    request: ScheduleStructureTemplateSlotWrite,
    template_id: UUID,
    organization_id: UUID,
) -> ScheduleStructureTemplateSlot:
    slot = ScheduleStructureTemplateSlot(
        organization_id=organization_id,
        template_id=template_id,
        weekday=request.weekday,
        room_id=request.room_id,
        shift_type=request.shift_type,
        start_time=request.start_time,
        end_time=request.end_time,
        display_order=request.display_order,
    )
    return slot


def replace_template_slots(
    template_id: UUID,
    slots: list[ScheduleStructureTemplateSlotWrite],
    organization_id: UUID,
    session: Session,
) -> list[ScheduleStructureTemplateSlot]:
    statement = sqlalchemy_delete(ScheduleStructureTemplateSlot)
    statement = statement.where(ScheduleStructureTemplateSlot.template_id == template_id)
    statement = statement.where(ScheduleStructureTemplateSlot.organization_id == organization_id)
    session.execute(statement)
    template_slots: list[ScheduleStructureTemplateSlot] = []

    for slot_request in slots:
        slot = create_template_slot(slot_request, template_id, organization_id)
        session.add(slot)
        template_slots.append(slot)

    return template_slots


def weekday_index(weekday: ScheduleTemplateWeekday) -> int:
    if weekday == "monday":
        return 0

    if weekday == "tuesday":
        return 1

    if weekday == "wednesday":
        return 2

    if weekday == "thursday":
        return 3

    if weekday == "friday":
        return 4

    if weekday == "saturday":
        return 5

    return 6


def schedule_date_for_template_weekday(
    schedule_period: SchedulePeriod,
    weekday: ScheduleTemplateWeekday,
) -> date:
    period_start_weekday = schedule_period.start_date.weekday()
    target_weekday = weekday_index(weekday)
    weekday_offset = (target_weekday - period_start_weekday + 7) % 7
    schedule_date = schedule_period.start_date.toordinal() + weekday_offset
    date_value = date.fromordinal(schedule_date)
    return date_value


def datetime_for_template_slot(
    schedule_date: date,
    slot_time: time,
) -> datetime:
    date_time = datetime.combine(schedule_date, slot_time, tzinfo=UTC)
    return date_time


def active_room_for_template_slot(
    slot: ScheduleStructureTemplateSlot,
    organization_id: UUID,
    session: Session,
) -> Room | None:
    statement = select(Room)
    statement = statement.join(Center, Center.id == Room.center_id)
    statement = statement.where(Room.id == slot.room_id)
    statement = statement.where(Room.organization_id == organization_id)
    statement = statement.where(Room.is_active.is_(True))
    statement = statement.where(Center.organization_id == organization_id)
    statement = statement.where(Center.is_active.is_(True))
    room = session.scalar(statement)
    return room


def skipped_template_slot(
    slot: ScheduleStructureTemplateSlot,
) -> ScheduleStructureTemplateSkippedSlot:
    message = "Room is inactive or unavailable."
    skipped_slot = ScheduleStructureTemplateSkippedSlot(
        weekday=slot.weekday,
        room_id=slot.room_id,
        reason="room_unavailable",
        message=message,
    )
    return skipped_slot


def applied_template_slot(
    slot: ScheduleStructureTemplateSlot,
    room: Room,
    schedule_period: SchedulePeriod,
) -> ScheduleStructureTemplateAppliedSlot:
    schedule_date = schedule_date_for_template_weekday(schedule_period, slot.weekday)
    start_time = datetime_for_template_slot(schedule_date, slot.start_time)
    end_time = datetime_for_template_slot(schedule_date, slot.end_time)
    room_slot_id = uuid4()
    applied_slot = ScheduleStructureTemplateAppliedSlot(
        room_slot_id=room_slot_id,
        weekday=slot.weekday,
        room_id=room.id,
        center_id=room.center_id,
        shift_type=slot.shift_type,
        schedule_date=schedule_date,
        start_time=start_time,
        end_time=end_time,
        display_order=slot.display_order,
    )
    return applied_slot


def create_assignment_from_request(
    requested_assignment: ScheduleAssignmentCreate,
    schedule_period_id: UUID,
    schedule_version_id: UUID,
    organization_id: UUID,
) -> Assignment:
    assignment = Assignment(
        room_slot_id=requested_assignment.room_slot_id,
        organization_id=organization_id,
        schedule_version_id=schedule_version_id,
        schedule_period_id=schedule_period_id,
        provider_id=requested_assignment.provider_id,
        center_id=requested_assignment.center_id,
        room_id=requested_assignment.room_id,
        shift_requirement_id=requested_assignment.shift_requirement_id,
        required_provider_type=requested_assignment.required_provider_type,
        shift_type=requested_assignment.shift_type,
        schedule_date=requested_assignment.schedule_date,
        start_time=requested_assignment.start_time,
        end_time=requested_assignment.end_time,
        assignment_status="draft",
        source=requested_assignment.source,
        notes=requested_assignment.notes,
    )
    return assignment


def datetime_with_date(source_datetime: datetime, target_date: date) -> datetime:
    source_time = source_datetime.timetz()
    updated_datetime = datetime.combine(target_date, source_time)
    return updated_datetime


def assignment_request_with_schedule_date_times(
    requested_assignment: ScheduleAssignmentCreate,
) -> ScheduleAssignmentCreate:
    start_time = datetime_with_date(
        requested_assignment.start_time,
        requested_assignment.schedule_date,
    )
    end_time = datetime_with_date(
        requested_assignment.end_time,
        requested_assignment.schedule_date,
    )
    updated_assignment = requested_assignment.model_copy(
        update={
            "start_time": start_time,
            "end_time": end_time,
        },
    )
    return updated_assignment


def parent_assignments_for_version(
    parent_schedule_version_id: UUID | None,
    organization_id: UUID,
    session: Session,
) -> list[Assignment]:
    if parent_schedule_version_id is None:
        return []

    parent_assignments = assignments_for_version(
        parent_schedule_version_id,
        organization_id,
        session,
    )
    return parent_assignments


def preserve_parent_assignment_dates(
    requested_assignment: ScheduleAssignmentCreate,
    parent_assignment: Assignment,
) -> ScheduleAssignmentCreate:
    start_date = parent_assignment.schedule_date
    end_date = parent_assignment.schedule_date
    start_time = datetime_with_date(requested_assignment.start_time, start_date)
    end_time = datetime_with_date(requested_assignment.end_time, end_date)
    updated_assignment = requested_assignment.model_copy(
        update={
            "schedule_date": parent_assignment.schedule_date,
            "start_time": start_time,
            "end_time": end_time,
        },
    )
    return updated_assignment


def stable_assignment_request(
    requested_assignment: ScheduleAssignmentCreate,
    parent_assignments: list[Assignment],
) -> ScheduleAssignmentCreate:
    parent_assignment = None

    for candidate in parent_assignments:
        room_slot_matches = candidate.room_slot_id == requested_assignment.room_slot_id

        if not room_slot_matches:
            continue

        parent_assignment = candidate
        break

    if parent_assignment is None:
        stable_assignment = assignment_request_with_schedule_date_times(requested_assignment)
        return stable_assignment

    if requested_assignment.allow_slot_date_change:
        stable_assignment = assignment_request_with_schedule_date_times(requested_assignment)
        return stable_assignment

    stable_assignment = preserve_parent_assignment_dates(
        requested_assignment,
        parent_assignment,
    )
    return stable_assignment


def stable_assignment_requests(
    requested_assignments: list[ScheduleAssignmentCreate],
    parent_schedule_version_id: UUID | None,
    organization_id: UUID,
    session: Session,
) -> list[ScheduleAssignmentCreate]:
    parent_assignments = parent_assignments_for_version(
        parent_schedule_version_id,
        organization_id,
        session,
    )
    stable_assignments = [
        stable_assignment_request(requested_assignment, parent_assignments)
        for requested_assignment in requested_assignments
    ]
    return stable_assignments


def duplicate_assignment_request(assignment: Assignment) -> ScheduleAssignmentCreate:
    requested_assignment = ScheduleAssignmentCreate(
        room_slot_id=assignment.room_slot_id,
        allow_slot_date_change=False,
        provider_id=assignment.provider_id,
        center_id=assignment.center_id,
        room_id=assignment.room_id,
        shift_requirement_id=assignment.shift_requirement_id,
        required_provider_type=assignment.required_provider_type,
        shift_type=assignment.shift_type,
        schedule_date=assignment.schedule_date,
        start_time=assignment.start_time,
        end_time=assignment.end_time,
        source="duplicate",
        notes=assignment.notes,
    )
    return requested_assignment


def clone_schedule_period_name(schedule_period: SchedulePeriod) -> str:
    name = f"Copy of {schedule_period.name}"
    return name


def latest_schedule_version_for_period(
    schedule_period_id: UUID,
    organization_id: UUID,
    session: Session,
) -> ScheduleVersion | None:
    statement = select(ScheduleVersion)
    statement = statement.where(ScheduleVersion.schedule_period_id == schedule_period_id)
    statement = statement.where(ScheduleVersion.organization_id == organization_id)
    statement = statement.order_by(ScheduleVersion.version_number.desc())
    schedule_version = session.scalar(statement)
    return schedule_version


def duplicate_assignment_requests(assignments: list[Assignment]) -> list[ScheduleAssignmentCreate]:
    requested_assignments: list[ScheduleAssignmentCreate] = []

    for assignment in assignments:
        requested_assignment = duplicate_assignment_request(assignment)
        requested_assignments.append(requested_assignment)

    return requested_assignments


def save_schedule_version(
    request: ScheduleDraftSaveRequest,
    source: str,
    session: Session,
    organization_id: UUID,
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
    requested_assignments = stable_assignment_requests(
        request.assignments,
        request.parent_schedule_version_id,
        organization_id,
        session,
    )
    schedule_version = ScheduleVersion(
        organization_id=organization_id,
        schedule_period_id=request.schedule_period_id,
        schedule_job_id=None,
        version_number=version_number,
        status="draft",
        source=source,
        parent_schedule_version_id=request.parent_schedule_version_id,
        published_at=None,
        published_by_user_id=None,
        created_by_user_id=None,
        solver_score=None,
        notes=request.notes,
    )
    session.add(schedule_version)
    session.flush()
    assignments: list[Assignment] = []

    for requested_assignment in requested_assignments:
        assignment = create_assignment_from_request(
            requested_assignment,
            request.schedule_period_id,
            schedule_version.id,
            organization_id,
        )
        session.add(assignment)
        assignments.append(assignment)

    session.flush()
    violations: list[ConstraintViolation] = []

    for assignment_index, assignment in enumerate(assignments):
        assignment_has_provider = assignment.provider_id is not None

        if not assignment_has_provider:
            continue

        requested_assignment = requested_assignments[assignment_index]
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

    shift_request_violations = shift_request_constraint_violations(
        assignments,
        schedule_version,
        organization_id,
        session,
    )

    for violation in shift_request_violations:
        session.add(violation)
        violations.append(violation)

    session.flush()
    record_fairness_for_schedule_version(
        schedule_version,
        assignments,
        organization_id,
        session,
    )
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


@router.get("/schedule-structure-templates", response_model=list[ScheduleStructureTemplateRead])
def list_schedule_structure_templates(
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> list[ScheduleStructureTemplateRead]:
    statement = select(ScheduleStructureTemplate)
    statement = statement.where(ScheduleStructureTemplate.organization_id == organization_id)
    statement = statement.order_by(ScheduleStructureTemplate.name, ScheduleStructureTemplate.id)
    templates = list(session.scalars(statement))
    template_reads: list[ScheduleStructureTemplateRead] = []

    for template in templates:
        slots = slots_for_template(template.id, organization_id, session)
        template_read = read_model_for_template(template, slots)
        template_reads.append(template_read)

    return template_reads


@router.post(
    "/schedule-structure-templates",
    response_model=ScheduleStructureTemplateRead,
    status_code=201,
)
def create_schedule_structure_template(
    request: ScheduleStructureTemplateWrite,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> ScheduleStructureTemplateRead:
    name = normalized_template_name(request.name)
    require_unique_template_name(name, organization_id, session)
    template = ScheduleStructureTemplate(
        organization_id=organization_id,
        name=name,
    )
    session.add(template)
    session.flush()
    slots = replace_template_slots(
        template.id,
        request.slots,
        organization_id,
        session,
    )
    session.flush()
    session.commit()
    session.refresh(template)

    for slot in slots:
        session.refresh(slot)

    response = read_model_for_template(template, slots)
    return response


@router.put(
    "/schedule-structure-templates/{template_id}",
    response_model=ScheduleStructureTemplateRead,
)
def update_schedule_structure_template(
    template_id: UUID,
    request: ScheduleStructureTemplateWrite,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> ScheduleStructureTemplateRead:
    template = require_schedule_structure_template(template_id, organization_id, session)
    name = normalized_template_name(request.name)
    require_unique_template_name(name, organization_id, session, template.id)
    template.name = name
    slots = replace_template_slots(
        template.id,
        request.slots,
        organization_id,
        session,
    )
    session.flush()
    session.commit()
    session.refresh(template)

    for slot in slots:
        session.refresh(slot)

    response = read_model_for_template(template, slots)
    return response


@router.delete(
    "/schedule-structure-templates/{template_id}",
    response_model=ScheduleStructureTemplateRead,
)
def delete_schedule_structure_template(
    template_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> ScheduleStructureTemplateRead:
    template = require_schedule_structure_template(template_id, organization_id, session)
    slots = slots_for_template(template.id, organization_id, session)
    response = read_model_for_template(template, slots)
    statement = sqlalchemy_delete(ScheduleStructureTemplateSlot)
    statement = statement.where(ScheduleStructureTemplateSlot.template_id == template.id)
    statement = statement.where(ScheduleStructureTemplateSlot.organization_id == organization_id)
    session.execute(statement)
    session.delete(template)
    session.commit()
    return response


@router.post(
    "/schedule-structure-templates/{template_id}/apply",
    response_model=ScheduleStructureTemplateApplyResponse,
)
def apply_schedule_structure_template(
    template_id: UUID,
    request: ScheduleStructureTemplateApplyRequest,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> ScheduleStructureTemplateApplyResponse:
    template = require_schedule_structure_template(template_id, organization_id, session)
    schedule_period = require_schedule_period(
        request.schedule_period_id,
        organization_id,
        session,
    )
    slots = slots_for_template(template.id, organization_id, session)
    applied_slots: list[ScheduleStructureTemplateAppliedSlot] = []
    skipped_slots: list[ScheduleStructureTemplateSkippedSlot] = []

    for slot in slots:
        room = active_room_for_template_slot(slot, organization_id, session)

        if room is None:
            skipped_slot = skipped_template_slot(slot)
            skipped_slots.append(skipped_slot)
            continue

        applied_slot = applied_template_slot(slot, room, schedule_period)
        applied_slots.append(applied_slot)

    template_read = read_model_for_template(template, slots)
    response = ScheduleStructureTemplateApplyResponse(
        template=template_read,
        applied_slots=applied_slots,
        skipped_slots=skipped_slots,
    )
    return response


@router.get("/schedule-periods", response_model=list[SchedulePeriodRead])
def list_schedule_periods(
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> list[SchedulePeriod]:
    statement = select(SchedulePeriod).where(SchedulePeriod.organization_id == organization_id)
    statement = statement.order_by(SchedulePeriod.start_date, SchedulePeriod.id)
    periods = list(session.scalars(statement))
    return periods


@router.post("/schedule-periods", response_model=SchedulePeriodRead, status_code=201)
def create_schedule_period(
    request: SchedulePeriodCreate,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> SchedulePeriod:
    validate_schedule_period_dates(request)
    schedule_period = SchedulePeriod(
        organization_id=organization_id,
        name=request.name,
        start_date=request.start_date,
        end_date=request.end_date,
        status=request.status,
    )
    session.add(schedule_period)
    session.commit()
    session.refresh(schedule_period)
    return schedule_period


@router.post(
    "/schedule-periods/{period_id}/availability-email",
    response_model=CalendarAvailabilityEmailSendRead,
    status_code=201,
)
def email_calendar_availability_request(
    period_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
    settings: Settings = Depends(get_settings),
) -> CalendarAvailabilityEmailSendRead:
    schedule_period = require_schedule_period(period_id, organization_id, session)
    require_open_schedule_period(schedule_period)
    provider_portal_base_url = require_provider_portal_base_url(settings)
    sender_email = require_gmail_sender_email(settings)
    providers = active_providers_with_email(organization_id, session)
    recipients: list[CalendarAvailabilityEmailRecipientRead] = []

    try:
        for provider in providers:
            recipient = send_calendar_availability_email_to_provider(
                provider,
                schedule_period,
                provider_portal_base_url,
                sender_email,
                settings,
            )
            recipients.append(recipient)
    except GmailSendError as error:
        raise HTTPException(status_code=502, detail="Calendar availability email failed") from error

    sent_count = len(recipients)
    response = CalendarAvailabilityEmailSendRead(
        schedule_period=SchedulePeriodRead.model_validate(schedule_period),
        sent_count=sent_count,
        recipients=recipients,
    )
    return response


@router.get("/schedule-periods/{period_id}", response_model=SchedulePeriodRead)
def read_schedule_period(
    period_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> SchedulePeriod:
    schedule_period = require_schedule_period(period_id, organization_id, session)
    return schedule_period


@router.patch("/schedule-periods/{period_id}", response_model=SchedulePeriodRead)
def rename_schedule_period(
    period_id: UUID,
    request: SchedulePeriodRenameRequest,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> SchedulePeriod:
    schedule_period = require_schedule_period(period_id, organization_id, session)
    next_name = request.name.strip()
    has_name = len(next_name) > 0

    if not has_name:
        raise HTTPException(status_code=400, detail="Schedule name is required")

    schedule_period.name = next_name
    session.commit()
    session.refresh(schedule_period)
    return schedule_period


@router.delete("/schedule-periods/{period_id}", response_model=SchedulePeriodRead)
def delete_schedule_period(
    period_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> SchedulePeriodRead:
    schedule_period = require_schedule_period(period_id, organization_id, session)
    schedule_period_read = SchedulePeriodRead.model_validate(schedule_period)
    schedule_versions = schedule_versions_for_period(period_id, organization_id, session)
    schedule_version_ids = [
        schedule_version.id
        for schedule_version in schedule_versions
    ]
    clear_fairness_state_links_for_period(period_id, schedule_version_ids, organization_id, session)
    delete_fairness_records_for_period(period_id, organization_id, session)
    delete_constraint_violations_for_period(schedule_version_ids, organization_id, session)
    delete_assignments_for_period(period_id, organization_id, session)
    clear_parent_schedule_version_links(schedule_version_ids, organization_id, session)
    delete_schedule_versions_for_period(schedule_version_ids, organization_id, session)
    delete_schedule_jobs_for_period(period_id, organization_id, session)
    delete_weekly_availability_for_period(period_id, organization_id, session)
    session.delete(schedule_period)
    session.commit()
    return schedule_period_read


@router.post(
    "/schedule-periods/{period_id}/clone",
    response_model=SchedulePeriodCloneResponse,
    status_code=201,
)
def clone_schedule_period(
    period_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> SchedulePeriodCloneResponse:
    source_schedule_period = require_schedule_period(period_id, organization_id, session)
    source_schedule_version = latest_schedule_version_for_period(
        period_id,
        organization_id,
        session,
    )

    if source_schedule_version is None:
        raise HTTPException(status_code=409, detail="Save a version before cloning this schedule")

    cloned_name = clone_schedule_period_name(source_schedule_period)
    cloned_schedule_period = SchedulePeriod(
        organization_id=organization_id,
        name=cloned_name,
        start_date=source_schedule_period.start_date,
        end_date=source_schedule_period.end_date,
        status="draft",
    )
    session.add(cloned_schedule_period)
    session.flush()
    clone_weekly_availability_for_period(
        source_schedule_period.id,
        cloned_schedule_period.id,
        organization_id,
        session,
    )
    session.flush()
    source_assignments = assignments_for_version(
        source_schedule_version.id,
        organization_id,
        session,
    )
    requested_assignments = duplicate_assignment_requests(source_assignments)
    request = ScheduleDraftSaveRequest(
        schedule_period_id=cloned_schedule_period.id,
        parent_schedule_version_id=None,
        notes=source_schedule_version.notes,
        assignments=requested_assignments,
    )
    schedule_version = save_schedule_version(request, "duplicate", session, organization_id)
    session.refresh(cloned_schedule_period)
    response = SchedulePeriodCloneResponse(
        schedule_period=cloned_schedule_period,
        schedule_version=schedule_version,
    )
    return response


@router.get("/schedule-periods/{period_id}/versions", response_model=list[ScheduleVersionRead])
def list_schedule_versions(
    period_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> list[ScheduleVersion]:
    require_schedule_period(period_id, organization_id, session)
    statement = select(ScheduleVersion).where(ScheduleVersion.schedule_period_id == period_id)
    statement = statement.where(ScheduleVersion.organization_id == organization_id)
    statement = statement.order_by(ScheduleVersion.version_number.desc())
    versions = list(session.scalars(statement))
    return versions


@router.post(
    "/schedule-periods/{period_id}/generate",
    response_model=ScheduleGenerateResponse,
    status_code=201,
)
def generate_schedule_period(
    period_id: UUID,
    request: ScheduleGenerateRequest | None = None,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> ScheduleGenerateResponse:
    generate_request = request

    if generate_request is None:
        generate_request = ScheduleGenerateRequest()

    schedule_period = require_schedule_period(period_id, organization_id, session)
    validate_parent_version(
        generate_request.parent_schedule_version_id,
        period_id,
        organization_id,
        session,
    )
    requested_assignments = None

    if generate_request.assignments is not None:
        requested_assignments = stable_assignment_requests(
            generate_request.assignments,
            generate_request.parent_schedule_version_id,
            organization_id,
            session,
        )

    generated_draft = generate_schedule_draft(
        schedule_period,
        generate_request.parent_schedule_version_id,
        generate_request.notes,
        organization_id,
        session,
        requested_assignments,
    )
    response = ScheduleGenerateResponse(
        version=generated_draft.version,
        assignments=generated_draft.assignments,
        violations=generated_draft.violations,
        metrics=generated_draft.metrics,
        is_feasible=generated_draft.is_feasible,
    )

    if not generated_draft.is_feasible:
        detail = response.model_dump(mode="json")
        raise HTTPException(status_code=409, detail=detail)

    return response


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
    response = save_schedule_version(request, "manual", session, organization_id)
    return response


@router.post(
    "/schedule-periods/{period_id}/versions",
    response_model=ScheduleDraftSaveResponse,
    status_code=201,
)
def save_period_schedule_version(
    period_id: UUID,
    request: ScheduleDraftSaveRequest,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> ScheduleDraftSaveResponse:
    path_matches_body = period_id == request.schedule_period_id

    if not path_matches_body:
        raise HTTPException(status_code=400, detail="Path period does not match request period")

    response = save_schedule_version(request, "manual", session, organization_id)
    return response


@router.get("/schedule-versions/{schedule_version_id}", response_model=ScheduleVersionDetailRead)
def read_schedule_version(
    schedule_version_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> ScheduleVersionDetailRead:
    schedule_version = require_schedule_version(schedule_version_id, organization_id, session)
    assignments = assignments_for_version(schedule_version_id, organization_id, session)
    violations = violations_for_version(schedule_version_id, organization_id, session)
    response = ScheduleVersionDetailRead(
        version=schedule_version,
        assignments=assignments,
        violations=violations,
    )
    return response


@router.get("/schedule-versions/{schedule_version_id}/assignments", response_model=list[AssignmentRead])
def read_schedule_version_assignments(
    schedule_version_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> list[Assignment]:
    require_schedule_version(schedule_version_id, organization_id, session)
    assignments = assignments_for_version(schedule_version_id, organization_id, session)
    return assignments


@router.get("/schedule-versions/{schedule_version_id}/violations", response_model=list[ConstraintViolationRead])
def read_schedule_version_violations(
    schedule_version_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> list[ConstraintViolation]:
    require_schedule_version(schedule_version_id, organization_id, session)
    violations = violations_for_version(schedule_version_id, organization_id, session)
    return violations


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
        assignment_has_provider = assignment.provider_id is not None

        if not assignment_has_provider:
            violation = unassigned_provider_violation()
            violations.append(violation)
            continue

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

    hard_violations = [
        violation
        for violation in violations
        if violation.severity == "hard_violation"
    ]

    if len(hard_violations) > 0:
        response = SchedulePublishResponse(
            version=schedule_version,
            violations=hard_violations,
        )
        raise HTTPException(status_code=409, detail=response.model_dump(mode="json"))

    statement = select(ScheduleVersion)
    statement = statement.where(ScheduleVersion.organization_id == organization_id)
    statement = statement.where(ScheduleVersion.schedule_period_id == schedule_version.schedule_period_id)
    statement = statement.where(ScheduleVersion.status == "published")
    published_versions = list(session.scalars(statement))

    for published_version in published_versions:
        same_version = published_version.id == schedule_version.id

        if same_version:
            continue

        published_version.status = "superseded"

    schedule_period = require_schedule_period(
        schedule_version.schedule_period_id,
        organization_id,
        session,
    )
    published_at = current_utc_time()
    schedule_version.status = "published"
    schedule_version.published_at = published_at
    schedule_period.status = "published"
    rebuild_published_fairness_state(
        organization_id,
        session,
    )
    session.commit()
    session.refresh(schedule_version)
    response = SchedulePublishResponse(
        version=schedule_version,
        violations=[],
    )
    return response
