from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field

SolverGenerationMode = Literal["strict", "best_effort"]


class SolverWeeklyAvailabilityDay(BaseModel):
    weekday: str
    options: list[str] = Field(default_factory=list)


class SolverProviderWeekAvailability(BaseModel):
    provider_id: UUID
    min_shifts_requested: int = 0
    max_shifts_requested: int = 0
    min_shifts_requested_units: int = 0
    max_shifts_requested_units: int = 0
    days: list[SolverWeeklyAvailabilityDay] = Field(default_factory=list)


class SolverRequiredRoomTypeSkill(BaseModel):
    room_type_id: UUID
    required_proficiency_level: int = 1


class SolverRoom(BaseModel):
    id: UUID
    name: str
    center_id: UUID
    center_name: str
    md_only: bool
    is_active: bool
    required_room_type_skills: list[SolverRequiredRoomTypeSkill] = Field(default_factory=list)


class SolverShiftRequirement(BaseModel):
    id: UUID
    room_slot_id: UUID
    assignment_id: UUID | None = None
    source_shift_requirement_id: UUID | None = None
    locked_provider_id: UUID | None = None
    center_id: UUID
    center_name: str
    room_id: UUID | None
    room_name: str | None
    shift_type: str = "full_shift"
    start_time: datetime
    end_time: datetime
    required_provider_count: int
    required_provider_type: str | None


class SolverProviderRoomTypeSkill(BaseModel):
    room_type_id: UUID
    proficiency_level: int = 1


class SolverProviderCenterPreference(BaseModel):
    center_id: UUID
    preference_level: int = Field(ge=-3, le=3)


class SolverProviderShiftTypePreference(BaseModel):
    shift_type: str
    preference_level: int = Field(ge=-3, le=3)


class SolverManagerCenterPreference(BaseModel):
    center_id: UUID
    preference_level: int = Field(ge=-3, le=3)


class SolverPreferenceWeights(BaseModel):
    center_weight: int = 4
    shift_type_weight: int = 6
    manager_hidden_weight: int = 5


class SolverProvider(BaseModel):
    id: UUID
    display_name: str
    is_active: bool
    provider_type: str
    fairness_debt: float = 0.0
    favor_credit: float = 0.0
    fairness_priority_multiplier: float = 1.0
    provider_room_type_skills: list[SolverProviderRoomTypeSkill] = Field(default_factory=list)
    center_preferences: list[SolverProviderCenterPreference] = Field(default_factory=list)
    shift_type_preferences: list[SolverProviderShiftTypePreference] = Field(default_factory=list)
    manager_center_preferences: list[SolverManagerCenterPreference] = Field(default_factory=list)
    week_availability: SolverProviderWeekAvailability


class SolverCenterCredential(BaseModel):
    provider_id: UUID
    center_id: UUID
    starts_at: datetime | None = None
    expires_at: datetime | None = None
    is_active: bool


class SolverInput(BaseModel):
    organization_id: UUID
    schedule_period_id: UUID
    rooms: list[SolverRoom] = Field(default_factory=list)
    providers: list[SolverProvider] = Field(default_factory=list)
    center_credentials: list[SolverCenterCredential] = Field(default_factory=list)
    shift_requirements: list[SolverShiftRequirement] = Field(default_factory=list)
    preference_weights: SolverPreferenceWeights = Field(default_factory=SolverPreferenceWeights)


class SolverAssignment(BaseModel):
    room_slot_id: UUID
    provider_id: UUID
    shift_requirement_id: UUID | None
    center_id: UUID
    room_id: UUID | None
    required_provider_type: str | None
    shift_type: str
    start_time: datetime
    end_time: datetime


class SolverViolation(BaseModel):
    severity: str
    constraint_type: str
    message: str
    metadata_json: dict[str, object] | None = None


class SolverResult(BaseModel):
    assignments: list[SolverAssignment] = Field(default_factory=list)
    violations: list[SolverViolation] = Field(default_factory=list)
    solver_score: float | None
    is_feasible: bool


class SolverRunMetrics(BaseModel):
    solve_duration_ms: int
    payload_size_bytes: int
    too_long_threshold_ms: int
    exceeded_too_long_threshold: bool
