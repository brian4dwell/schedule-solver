from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field


class SolverWeights(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    center_weight: int = Field(default=4, ge=0, le=8, strict=True)
    shift_type_weight: int = Field(default=6, ge=0, le=12, strict=True)
    manager_hidden_weight: int = Field(default=5, ge=0, le=10, strict=True)
    below_minimum_weight: int = Field(default=10, ge=0, le=20, strict=True)
    above_maximum_weight: int = Field(default=15, ge=0, le=30, strict=True)
    balance_weight: int = Field(default=3, ge=0, le=6, strict=True)
    fairness_weight: int = Field(default=10, ge=0, le=20, strict=True)
    unfilled_weight: int = Field(default=100_000, ge=100_000, le=100_000, strict=True)


def baseline_solver_weights_json() -> dict[str, object]:
    weights = SolverWeights()
    serialized_weights = weights.model_dump(mode="json")
    return serialized_weights


class SolverSettingsRead(BaseModel):
    weights: SolverWeights
    baseline: SolverWeights
    revision: int


class SolverSettingsWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    weights: SolverWeights
    expected_revision: int = Field(ge=1)
