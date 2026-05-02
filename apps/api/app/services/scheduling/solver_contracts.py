from datetime import datetime
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field


class SolverTimeBlock(BaseModel):
    start_time: datetime
    end_time: datetime
    availability_type: str


class SolverRoom(BaseModel):
    id: UUID
    center_id: UUID
    md_only: bool
    room_type_ids: list[UUID] = Field(default_factory=list)


class SolverShiftRequirement(BaseModel):
    id: UUID
    assignment_id: UUID | None = None
    source_shift_requirement_id: UUID | None = None
    center_id: UUID
    room_id: UUID | None
    start_time: datetime
    end_time: datetime
    required_provider_count: int
    required_provider_type: str | None


class SolverProvider(BaseModel):
    id: UUID
    provider_type: str
    credentialed_center_ids: list[UUID] = Field(default_factory=list)
    skill_room_type_ids: list[UUID] = Field(default_factory=list)
    unavailable_blocks: list[SolverTimeBlock] = Field(default_factory=list)
    preferred_blocks: list[SolverTimeBlock] = Field(default_factory=list)
    avoid_blocks: list[SolverTimeBlock] = Field(default_factory=list)


class SolverInput(BaseModel):
    organization_id: UUID
    schedule_period_id: UUID
    rooms: list[SolverRoom] = Field(default_factory=list)
    providers: list[SolverProvider] = Field(default_factory=list)
    shift_requirements: list[SolverShiftRequirement] = Field(default_factory=list)


class SolverAssignment(BaseModel):
    provider_id: UUID
    shift_requirement_id: UUID | None
    center_id: UUID
    room_id: UUID | None
    required_provider_type: str | None
    start_time: datetime
    end_time: datetime


class SolverViolation(BaseModel):
    severity: str
    constraint_type: str
    message: str


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
