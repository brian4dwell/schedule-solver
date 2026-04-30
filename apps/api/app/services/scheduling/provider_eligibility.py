from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Assignment
from app.db.models import Provider
from app.db.models import ProviderAvailability
from app.db.models import ProviderCenterCredential
from app.db.models import ProviderRoomTypeSkill
from app.db.models import Room
from app.db.models import RoomRoomType
from app.services.scheduling.provider_eligibility_contracts import ProviderEligibilityContext
from app.services.scheduling.provider_eligibility_contracts import ProviderEligibilityViolation
from app.services.scheduling.provider_eligibility_contracts import ProviderRoomTypeSkillSummary
from app.services.scheduling.provider_eligibility_contracts import ProviderSlotEligibilityInput
from app.services.scheduling.provider_eligibility_contracts import ProviderSlotEligibilityResult
from app.services.scheduling.provider_eligibility_contracts import RequiredRoomTypeSkill


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

    if context.has_availability_conflict:
        violation = create_violation(
            "provider_unavailable",
            "availability_conflict",
            "Provider has an availability conflict during this slot.",
        )
        violations.append(violation)

    if context.has_double_booking:
        violation = create_violation(
            "provider_double_booked",
            "other_hard_constraint",
            "Provider is already assigned to an overlapping slot.",
        )
        violations.append(violation)

    is_eligible = len(violations) == 0
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


def overlapping_times_filter(statement, start_time: datetime, end_time: datetime):
    statement = statement.where(ProviderAvailability.start_time < end_time)
    statement = statement.where(ProviderAvailability.end_time > start_time)
    return statement


def has_availability_conflict(
    request: ProviderSlotEligibilityInput,
    session: Session,
) -> bool:
    statement = select(ProviderAvailability.id)
    statement = statement.where(ProviderAvailability.organization_id == request.organization_id)
    statement = statement.where(ProviderAvailability.provider_id == request.provider_id)
    statement = statement.where(ProviderAvailability.availability_type == "unavailable")
    statement = overlapping_times_filter(statement, request.start_time, request.end_time)
    statement = statement.limit(1)
    availability_id = session.scalar(statement)
    has_conflict = availability_id is not None
    return has_conflict


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

    availability_conflict = has_availability_conflict(request, session)
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
        has_availability_conflict=availability_conflict,
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
