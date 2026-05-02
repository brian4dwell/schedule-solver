from datetime import datetime
from uuid import UUID

from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Assignment
from app.db.models import Provider
from app.db.models import ProviderCenterCredential
from app.db.models import ProviderRoomTypeSkill
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import Room
from app.db.models import RoomRoomType
from app.services.scheduling.provider_eligibility_contracts import ProviderEligibilityContext
from app.services.scheduling.provider_eligibility_contracts import ProviderEligibilityViolation
from app.services.scheduling.provider_eligibility_contracts import ProviderRoomTypeSkillSummary
from app.services.scheduling.provider_eligibility_contracts import ProviderSlotEligibilityInput
from app.services.scheduling.provider_eligibility_contracts import ProviderSlotEligibilityResult
from app.services.scheduling.provider_eligibility_contracts import ProviderWeeklyAvailabilitySummary
from app.services.scheduling.provider_eligibility_contracts import RequiredRoomTypeSkill


WEEKDAY_VALUES = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]


def create_violation(
    constraint_type: str,
    category: str,
    message: str,
) -> ProviderEligibilityViolation:
    violation = ProviderEligibilityViolation(
        severity="hard_violation",
        constraint_type=constraint_type,
        category=category,
        message=message,
    )
    return violation


def create_warning(
    constraint_type: str,
    category: str,
    message: str,
) -> ProviderEligibilityViolation:
    violation = ProviderEligibilityViolation(
        severity="warning",
        constraint_type=constraint_type,
        category=category,
        message=message,
    )
    return violation


def skill_for_room_type(
    room_type_id: UUID,
    provider_skills: list[ProviderRoomTypeSkillSummary],
) -> ProviderRoomTypeSkillSummary | None:
    for provider_skill in provider_skills:
        skill_matches_room_type = provider_skill.room_type_id == room_type_id

        if skill_matches_room_type:
            return provider_skill

    return None


def evaluate_provider_slot_eligibility(
    request: ProviderSlotEligibilityInput,
    context: ProviderEligibilityContext,
) -> ProviderSlotEligibilityResult:
    violations: list[ProviderEligibilityViolation] = []

    if not context.provider_is_active:
        violation = create_violation(
            "inactive_provider",
            "other_hard_constraint",
            "Provider is inactive.",
        )
        violations.append(violation)

    if request.required_provider_type is not None:
        provider_type_matches = context.provider_type == request.required_provider_type

        if not provider_type_matches:
            violation = create_violation(
                "provider_type_mismatch",
                "other_hard_constraint",
                "Provider type does not match the required provider type.",
            )
            violations.append(violation)

    if not context.credential_exists:
        violation = create_violation(
            "missing_center_credential",
            "missing_credential",
            "Provider is not credentialed for this center.",
        )
        violations.append(violation)

    if context.credential_exists and not context.credential_is_active_for_slot:
        violation = create_violation(
            "inactive_center_credential",
            "credential_inactive",
            "Provider credential is inactive or outside the assigned slot time.",
        )
        violations.append(violation)

    for required_skill in context.required_room_type_skills:
        provider_skill = skill_for_room_type(
            required_skill.room_type_id,
            context.provider_room_type_skills,
        )
        provider_has_skill = provider_skill is not None

        if not provider_has_skill:
            violation = create_violation(
                "missing_required_skill",
                "missing_skill",
                "Provider is missing a required room type skill.",
            )
            violations.append(violation)
            continue

        provider_level = provider_skill.proficiency_level
        required_level = required_skill.required_proficiency_level
        provider_has_required_level = provider_level >= required_level

        if not provider_has_required_level:
            violation = create_violation(
                "insufficient_required_skill_level",
                "missing_skill",
                "Provider skill level is below the required proficiency level.",
            )
            violations.append(violation)

    if context.room_md_only:
        provider_is_doctor = context.provider_type == "doctor"

        if not provider_is_doctor:
            violation = create_violation(
                "md_requirement_not_met",
                "md_requirement_not_met",
                "Provider does not satisfy the MD requirement for this slot.",
            )
            violations.append(violation)

    weekly_availability = context.weekly_availability
    availability_is_missing = not weekly_availability.has_row
    availability_is_unset = "unset" in weekly_availability.options

    if availability_is_missing or availability_is_unset:
        violation = create_violation(
            "provider_availability_unset",
            "availability_conflict",
            "Provider has not supplied availability for this slot day.",
        )
        violations.append(violation)
    else:
        provider_is_unavailable = "none" in weekly_availability.options

        if provider_is_unavailable:
            violation = create_violation(
                "provider_unavailable",
                "availability_conflict",
                "Provider is unavailable on this slot day.",
            )
            violations.append(violation)
        else:
            shift_type_is_available = request.shift_type in weekly_availability.options

            if not shift_type_is_available:
                violation = create_violation(
                    "provider_shift_type_unavailable",
                    "availability_conflict",
                    "Provider availability does not include this slot shift type.",
                )
                violations.append(violation)

        exceeds_maximum_shifts = context.schedule_week_assignment_count > weekly_availability.max_shifts_requested

        if exceeds_maximum_shifts:
            violation = create_warning(
                "provider_max_shifts_exceeded",
                "shift_request_conflict",
                "Provider is over the maximum requested shifts for this schedule week.",
            )
            violations.append(violation)

    if context.has_double_booking:
        violation = create_violation(
            "provider_double_booked",
            "other_hard_constraint",
            "Provider is already assigned to an overlapping slot.",
        )
        violations.append(violation)

    hard_violations = [
        violation
        for violation in violations
        if violation.severity == "hard_violation"
    ]
    is_eligible = len(hard_violations) == 0
    result = ProviderSlotEligibilityResult(
        provider_id=request.provider_id,
        is_eligible=is_eligible,
        violations=violations,
    )
    return result


def credential_is_active_for_slot(
    credential: ProviderCenterCredential,
    start_time: datetime,
    end_time: datetime,
) -> bool:
    if not credential.is_active:
        return False

    if credential.starts_at is not None:
        starts_before_slot_ends = credential.starts_at <= start_time

        if not starts_before_slot_ends:
            return False

    if credential.expires_at is not None:
        expires_after_slot_starts = credential.expires_at >= end_time

        if not expires_after_slot_starts:
            return False

    return True


def load_provider(
    request: ProviderSlotEligibilityInput,
    session: Session,
) -> Provider:
    statement = select(Provider).where(Provider.id == request.provider_id)
    statement = statement.where(Provider.organization_id == request.organization_id)
    provider = session.scalar(statement)

    if provider is None:
        raise ValueError("Provider not found")

    return provider


def load_room(
    request: ProviderSlotEligibilityInput,
    session: Session,
) -> Room | None:
    if request.room_id is None:
        return None

    statement = select(Room).where(Room.id == request.room_id)
    statement = statement.where(Room.organization_id == request.organization_id)
    room = session.scalar(statement)

    if room is None:
        raise ValueError("Room not found")

    return room


def load_center_credential(
    request: ProviderSlotEligibilityInput,
    session: Session,
) -> ProviderCenterCredential | None:
    statement = select(ProviderCenterCredential)
    statement = statement.where(ProviderCenterCredential.organization_id == request.organization_id)
    statement = statement.where(ProviderCenterCredential.provider_id == request.provider_id)
    statement = statement.where(ProviderCenterCredential.center_id == request.center_id)
    credential = session.scalar(statement)
    return credential


def load_required_room_type_skills(
    request: ProviderSlotEligibilityInput,
    session: Session,
) -> list[RequiredRoomTypeSkill]:
    if request.room_id is None:
        return []

    statement = select(RoomRoomType)
    statement = statement.where(RoomRoomType.organization_id == request.organization_id)
    statement = statement.where(RoomRoomType.room_id == request.room_id)
    room_type_assignments = list(session.scalars(statement))
    required_skills = [
        RequiredRoomTypeSkill(
            room_type_id=room_type_assignment.room_type_id,
            required_proficiency_level=room_type_assignment.required_proficiency_level,
        )
        for room_type_assignment in room_type_assignments
    ]
    return required_skills


def load_provider_room_type_skills(
    request: ProviderSlotEligibilityInput,
    session: Session,
) -> list[ProviderRoomTypeSkillSummary]:
    statement = select(ProviderRoomTypeSkill)
    statement = statement.where(ProviderRoomTypeSkill.organization_id == request.organization_id)
    statement = statement.where(ProviderRoomTypeSkill.provider_id == request.provider_id)
    provider_skills = list(session.scalars(statement))
    skill_summaries = [
        ProviderRoomTypeSkillSummary(
            room_type_id=provider_skill.room_type_id,
            proficiency_level=provider_skill.proficiency_level,
        )
        for provider_skill in provider_skills
    ]
    return skill_summaries


def weekday_for_start_time(start_time: datetime) -> str:
    weekday_index = start_time.weekday()
    weekday = WEEKDAY_VALUES[weekday_index]
    return weekday


def load_weekly_availability(
    request: ProviderSlotEligibilityInput,
    session: Session,
) -> ProviderWeeklyAvailabilitySummary:
    weekday = weekday_for_start_time(request.start_time)
    statement = select(ProviderScheduleWeekAvailability)
    statement = statement.where(ProviderScheduleWeekAvailability.organization_id == request.organization_id)
    statement = statement.where(ProviderScheduleWeekAvailability.schedule_week_id == request.schedule_period_id)
    statement = statement.where(ProviderScheduleWeekAvailability.provider_id == request.provider_id)
    statement = statement.where(ProviderScheduleWeekAvailability.weekday == weekday)
    availability = session.scalar(statement)

    if availability is None:
        summary = ProviderWeeklyAvailabilitySummary(
            has_row=False,
            weekday=weekday,
            options=["unset"],
        )
        return summary

    summary = ProviderWeeklyAvailabilitySummary(
        has_row=True,
        weekday=availability.weekday,
        options=availability.availability_options,
        min_shifts_requested=availability.min_shifts_requested,
        max_shifts_requested=availability.max_shifts_requested,
    )
    return summary


def provider_assignment_count_for_week(
    request: ProviderSlotEligibilityInput,
    session: Session,
) -> int:
    if request.schedule_version_id is None:
        return 1

    statement = select(func.count(Assignment.id))
    statement = statement.where(Assignment.organization_id == request.organization_id)
    statement = statement.where(Assignment.schedule_period_id == request.schedule_period_id)
    statement = statement.where(Assignment.schedule_version_id == request.schedule_version_id)
    statement = statement.where(Assignment.provider_id == request.provider_id)
    assignment_count = session.scalar(statement)

    if assignment_count is None:
        return 0

    count = int(assignment_count)

    if request.assignment_id is None:
        count = count + 1

    return count


def has_double_booking(
    request: ProviderSlotEligibilityInput,
    session: Session,
) -> bool:
    if request.schedule_version_id is None:
        return False

    statement = select(Assignment.id)
    statement = statement.where(Assignment.organization_id == request.organization_id)
    statement = statement.where(Assignment.schedule_version_id == request.schedule_version_id)
    statement = statement.where(Assignment.provider_id == request.provider_id)
    statement = statement.where(Assignment.start_time < request.end_time)
    statement = statement.where(Assignment.end_time > request.start_time)

    if request.assignment_id is not None:
        statement = statement.where(Assignment.id != request.assignment_id)

    statement = statement.limit(1)
    assignment_id = session.scalar(statement)
    is_double_booked = assignment_id is not None
    return is_double_booked


def load_provider_eligibility_context(
    request: ProviderSlotEligibilityInput,
    session: Session,
) -> ProviderEligibilityContext:
    provider = load_provider(request, session)
    room = load_room(request, session)
    credential = load_center_credential(request, session)
    required_skills = load_required_room_type_skills(request, session)
    provider_skills = load_provider_room_type_skills(request, session)
    credential_exists = credential is not None
    credential_active = False

    if credential is not None:
        credential_active = credential_is_active_for_slot(
            credential,
            request.start_time,
            request.end_time,
        )

    room_md_only = False

    if room is not None:
        room_md_only = room.md_only

    weekly_availability = load_weekly_availability(request, session)
    schedule_week_assignment_count = provider_assignment_count_for_week(request, session)
    double_booking = has_double_booking(request, session)
    context = ProviderEligibilityContext(
        provider_id=provider.id,
        provider_is_active=provider.is_active,
        provider_type=provider.provider_type,
        credential_exists=credential_exists,
        credential_is_active_for_slot=credential_active,
        room_md_only=room_md_only,
        required_room_type_skills=required_skills,
        provider_room_type_skills=provider_skills,
        weekly_availability=weekly_availability,
        schedule_week_assignment_count=schedule_week_assignment_count,
        has_double_booking=double_booking,
    )
    return context


def check_provider_slot_eligibility(
    request: ProviderSlotEligibilityInput,
    session: Session,
) -> ProviderSlotEligibilityResult:
    context = load_provider_eligibility_context(request, session)
    result = evaluate_provider_slot_eligibility(request, context)
    return result
