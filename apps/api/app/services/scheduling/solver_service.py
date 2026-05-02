import logging
from time import perf_counter
from uuid import UUID

from pydantic import BaseModel
from pydantic import ConfigDict
from sqlalchemy.orm import Session

from app.db.models import Assignment
from app.db.models import ConstraintViolation
from app.db.models import SchedulePeriod
from app.db.models import ScheduleVersion
from app.schemas.schedule import ScheduleAssignmentCreate
from app.services.scheduling.solver import solve_schedule
from app.services.scheduling.solver_contracts import SolverRunMetrics
from app.services.scheduling.solver_input_builder import build_solver_input
from app.services.scheduling.solver_persistence import persist_solver_result

logger = logging.getLogger(__name__)
TOO_LONG_SOLVE_THRESHOLD_MS = 10_000


class GeneratedScheduleDraft(BaseModel):
    version: ScheduleVersion
    assignments: list[Assignment]
    violations: list[ConstraintViolation]
    metrics: SolverRunMetrics
    is_feasible: bool

    model_config = ConfigDict(arbitrary_types_allowed=True)


def payload_size_bytes(payload: BaseModel) -> int:
    payload_json = payload.model_dump_json()
    payload_bytes = payload_json.encode("utf-8")
    size_bytes = len(payload_bytes)
    return size_bytes


def generate_schedule_draft(
    schedule_period: SchedulePeriod,
    parent_schedule_version_id: UUID | None,
    notes: str | None,
    organization_id: UUID,
    session: Session,
    requested_assignments: list[ScheduleAssignmentCreate] | None = None,
) -> GeneratedScheduleDraft:
    solver_input = build_solver_input(
        schedule_period,
        organization_id,
        session,
        requested_assignments,
    )
    input_size_bytes = payload_size_bytes(solver_input)
    started_at = perf_counter()
    solver_result = solve_schedule(solver_input)
    finished_at = perf_counter()
    duration_seconds = finished_at - started_at
    solve_duration_ms = int(duration_seconds * 1000)
    exceeded_too_long_threshold = solve_duration_ms > TOO_LONG_SOLVE_THRESHOLD_MS
    schedule_version, assignments, violations = persist_solver_result(
        schedule_period.id,
        parent_schedule_version_id,
        solver_result,
        notes,
        organization_id,
        session,
    )
    metrics = SolverRunMetrics(
        solve_duration_ms=solve_duration_ms,
        payload_size_bytes=input_size_bytes,
        too_long_threshold_ms=TOO_LONG_SOLVE_THRESHOLD_MS,
        exceeded_too_long_threshold=exceeded_too_long_threshold,
    )
    logger.info(
        "Generated schedule draft",
        extra={
            "organization_id": str(organization_id),
            "schedule_period_id": str(schedule_period.id),
            "schedule_version_id": str(schedule_version.id),
            "solve_duration_ms": solve_duration_ms,
            "payload_size_bytes": input_size_bytes,
            "too_long_threshold_ms": TOO_LONG_SOLVE_THRESHOLD_MS,
            "exceeded_too_long_threshold": exceeded_too_long_threshold,
            "is_feasible": solver_result.is_feasible,
        },
    )
    generated_draft = GeneratedScheduleDraft(
        version=schedule_version,
        assignments=assignments,
        violations=violations,
        metrics=metrics,
        is_feasible=solver_result.is_feasible,
    )
    return generated_draft
