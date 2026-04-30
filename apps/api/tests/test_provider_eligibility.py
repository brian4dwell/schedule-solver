from datetime import UTC
from datetime import datetime
from datetime import timedelta
from pathlib import Path
import sys
from types import SimpleNamespace
from uuid import uuid4

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.services.scheduling.provider_eligibility import credential_is_active_for_slot
from app.services.scheduling.provider_eligibility import evaluate_provider_slot_eligibility
from app.services.scheduling.provider_eligibility_contracts import ProviderEligibilityContext
from app.services.scheduling.provider_eligibility_contracts import ProviderRoomTypeSkillSummary
from app.services.scheduling.provider_eligibility_contracts import ProviderSlotEligibilityInput
from app.services.scheduling.provider_eligibility_contracts import RequiredRoomTypeSkill


def create_request(provider_id=None, room_id=None) -> ProviderSlotEligibilityInput:
    organization_id = uuid4()
    request_provider_id = provider_id or uuid4()
    request_room_id = room_id or uuid4()
    start_time = datetime(2026, 5, 4, 7, 0, tzinfo=UTC)
    end_time = datetime(2026, 5, 4, 15, 0, tzinfo=UTC)
    request = ProviderSlotEligibilityInput(
        organization_id=organization_id,
        provider_id=request_provider_id,
        center_id=uuid4(),
        room_id=request_room_id,
        start_time=start_time,
        end_time=end_time,
    )
    return request


def create_context(provider_id, room_type_id=None) -> ProviderEligibilityContext:
    required_skills: list[RequiredRoomTypeSkill] = []
    provider_skills: list[ProviderRoomTypeSkillSummary] = []

    if room_type_id is not None:
        required_skill = RequiredRoomTypeSkill(
            room_type_id=room_type_id,
            required_proficiency_level=1,
        )
        provider_skill = ProviderRoomTypeSkillSummary(
            room_type_id=room_type_id,
            proficiency_level=1,
        )
        required_skills.append(required_skill)
        provider_skills.append(provider_skill)

    context = ProviderEligibilityContext(
        provider_id=provider_id,
        provider_is_active=True,
        provider_type="doctor",
        credential_exists=True,
        credential_is_active_for_slot=True,
        room_md_only=False,
        required_room_type_skills=required_skills,
        provider_room_type_skills=provider_skills,
    )
    return context


def test_valid_provider_can_cover_slot() -> None:
    provider_id = uuid4()
    room_type_id = uuid4()
    request = create_request(provider_id)
    context = create_context(provider_id, room_type_id)

    result = evaluate_provider_slot_eligibility(request, context)

    assert result.is_eligible is True
    assert result.violations == []


def test_missing_credential_creates_visible_reason() -> None:
    provider_id = uuid4()
    request = create_request(provider_id)
    context = create_context(provider_id)
    context.credential_exists = False
    context.credential_is_active_for_slot = False

    result = evaluate_provider_slot_eligibility(request, context)

    assert result.is_eligible is False
    assert result.violations[0].constraint_type == "missing_center_credential"
    assert result.violations[0].category == "missing_credential"


def test_inactive_credential_creates_visible_reason() -> None:
    provider_id = uuid4()
    request = create_request(provider_id)
    context = create_context(provider_id)
    context.credential_is_active_for_slot = False

    result = evaluate_provider_slot_eligibility(request, context)

    assert result.is_eligible is False
    assert result.violations[0].constraint_type == "inactive_center_credential"
    assert result.violations[0].category == "credential_inactive"


def test_missing_required_skill_creates_visible_reason() -> None:
    provider_id = uuid4()
    room_type_id = uuid4()
    request = create_request(provider_id)
    context = create_context(provider_id)
    required_skill = RequiredRoomTypeSkill(
        room_type_id=room_type_id,
        required_proficiency_level=1,
    )
    context.required_room_type_skills = [required_skill]

    result = evaluate_provider_slot_eligibility(request, context)

    assert result.is_eligible is False
    assert result.violations[0].constraint_type == "missing_required_skill"
    assert result.violations[0].category == "missing_skill"


def test_insufficient_required_skill_level_creates_visible_reason() -> None:
    provider_id = uuid4()
    room_type_id = uuid4()
    request = create_request(provider_id)
    context = create_context(provider_id)
    required_skill = RequiredRoomTypeSkill(
        room_type_id=room_type_id,
        required_proficiency_level=2,
    )
    provider_skill = ProviderRoomTypeSkillSummary(
        room_type_id=room_type_id,
        proficiency_level=1,
    )
    context.required_room_type_skills = [required_skill]
    context.provider_room_type_skills = [provider_skill]

    result = evaluate_provider_slot_eligibility(request, context)

    assert result.is_eligible is False
    assert result.violations[0].constraint_type == "insufficient_required_skill_level"
    assert result.violations[0].category == "missing_skill"


def test_md_requirement_creates_visible_reason() -> None:
    provider_id = uuid4()
    request = create_request(provider_id)
    context = create_context(provider_id)
    context.provider_type = "crna"
    context.room_md_only = True

    result = evaluate_provider_slot_eligibility(request, context)

    assert result.is_eligible is False
    assert result.violations[0].constraint_type == "md_requirement_not_met"
    assert result.violations[0].category == "md_requirement_not_met"


def test_multiple_failed_constraints_are_returned_together() -> None:
    provider_id = uuid4()
    request = create_request(provider_id)
    context = create_context(provider_id)
    context.credential_exists = False
    context.provider_type = "crna"
    context.room_md_only = True

    result = evaluate_provider_slot_eligibility(request, context)
    constraint_types = [
        violation.constraint_type
        for violation in result.violations
    ]

    assert result.is_eligible is False
    assert "missing_center_credential" in constraint_types
    assert "md_requirement_not_met" in constraint_types


def test_credential_date_range_must_cover_slot() -> None:
    start_time = datetime(2026, 5, 4, 7, 0, tzinfo=UTC)
    end_time = datetime(2026, 5, 4, 15, 0, tzinfo=UTC)
    expires_at = start_time - timedelta(minutes=1)
    credential = SimpleNamespace(
        is_active=True,
        starts_at=None,
        expires_at=expires_at,
    )

    is_active = credential_is_active_for_slot(credential, start_time, end_time)

    assert is_active is False
