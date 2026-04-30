from datetime import datetime
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field


class ProviderSlotEligibilityInput(BaseModel):
    organization_id: UUID
    schedule_version_id: UUID | None = None
    assignment_id: UUID | None = None
    provider_id: UUID
    center_id: UUID
    room_id: UUID | None = None
    required_provider_type: str | None = None
    start_time: datetime
    end_time: datetime


class RequiredRoomTypeSkill(BaseModel):
    room_type_id: UUID
    required_proficiency_level: int = 1


class ProviderRoomTypeSkillSummary(BaseModel):
    room_type_id: UUID
    proficiency_level: int = 1


class ProviderEligibilityContext(BaseModel):
    provider_id: UUID
    provider_is_active: bool
    provider_type: str
    credential_exists: bool
    credential_is_active_for_slot: bool
    room_md_only: bool
    required_room_type_skills: list[RequiredRoomTypeSkill] = Field(default_factory=list)
    provider_room_type_skills: list[ProviderRoomTypeSkillSummary] = Field(default_factory=list)
    has_availability_conflict: bool = False
    has_double_booking: bool = False


class ProviderEligibilityViolation(BaseModel):
    severity: str
    constraint_type: str
    category: str
    message: str


class ProviderSlotEligibilityResult(BaseModel):
    provider_id: UUID
    is_eligible: bool
    violations: list[ProviderEligibilityViolation]
