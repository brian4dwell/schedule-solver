from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from app.schemas.solver_settings import SolverWeights
from app.services.scheduling.solver_contracts import SolverGenerationMode
from app.services.scheduling.solver_contracts import SolverInput
from app.services.scheduling.solver_contracts import SolverResult

SolverFactor = Literal[
    "center_weight",
    "shift_type_weight",
    "manager_hidden_weight",
    "below_minimum_weight",
    "above_maximum_weight",
    "balance_weight",
    "fairness_weight",
    "unfilled_weight",
]


class SolverFactorOutcome(BaseModel):
    factor: SolverFactor
    raw_value: float
    weight: int
    contribution: int


class SolverPreferenceOutcome(BaseModel):
    positive: int = 0
    negative: int = 0
    neutral: int = 0
    missing: int = 0


class SolverOutcomes(BaseModel):
    assigned_count: int
    unfilled_count: int
    below_minimum_provider_count: int
    above_maximum_provider_count: int
    center_preferences: SolverPreferenceOutcome
    shift_preferences: SolverPreferenceOutcome
    manager_preferences: SolverPreferenceOutcome
    factors: list[SolverFactorOutcome]


class SolverRuntime(BaseModel):
    implementation_id: str
    ortools_version: str
    max_solve_seconds: float
    num_search_workers: int
    random_seed: int


class SolverRunSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    weights: SolverWeights
    configuration_source: Literal["organization", "run_override"]
    organization_revision: int
    generation_mode: SolverGenerationMode
    runtime: SolverRuntime
    replay_of_run_id: UUID | None = None
    input_snapshot: SolverInput | None = None
    input_fingerprint: str | None = None
    result: SolverResult | None = None
    outcomes: SolverOutcomes | None = None
    duration_ms: int | None = None


class SolverRunRead(BaseModel):
    id: UUID
    schedule_period_id: UUID
    schedule_version_id: UUID | None
    version_number: int | None
    status: str
    requested_by_subject: str | None
    started_at: datetime | None
    finished_at: datetime | None
    error_message: str | None
    weights: SolverWeights
    configuration_source: str
    organization_revision: int
    schema_version: int
    generation_mode: SolverGenerationMode
    runtime: SolverRuntime
    replay_of_run_id: UUID | None
    input_fingerprint: str | None
    can_replay: bool
    solver_status: str | None
    is_feasible: bool | None
    solver_score: float | None
    outcomes: SolverOutcomes | None
    duration_ms: int | None
    violation_messages: list[str] = Field(default_factory=list)
