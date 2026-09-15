import logging
from time import perf_counter
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel
from pydantic import ConfigDict
from sqlalchemy.orm import Session

from app.db.models import Assignment
from app.db.models import ConstraintViolation
from app.db.models import ScheduleJob
from app.db.models import SchedulePeriod
from app.db.models import ScheduleVersion
from app.db.models.scheduling import current_utc_time
from app.schemas.schedule import ScheduleAssignmentCreate
from app.schemas.solver_settings import SolverWeights
from app.services.scheduling.solver import solve_schedule
from app.services.scheduling.solver_contracts import SolverGenerationMode
from app.services.scheduling.solver_contracts import SolverRunMetrics
from app.services.scheduling.solver_input_builder import build_solver_input
from app.services.scheduling.solver_outcomes import measure_solver_outcomes
from app.services.scheduling.solver_persistence import persist_solver_result
from app.services.scheduling.solver_run_contracts import SolverRunSnapshot
from app.services.scheduling.solver_runs import current_solver_runtime
from app.services.scheduling.solver_runs import organization_solver_settings
from app.services.scheduling.solver_runs import require_replay_snapshot
from app.services.scheduling.solver_runs import require_solver_organization
from app.services.scheduling.solver_runs import solver_input_fingerprint

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
    generation_mode: SolverGenerationMode = "strict",
    solver_weights: SolverWeights | None = None,
    replay_of_run_id: UUID | None = None,
    requested_by_subject: str | None = None,
) -> GeneratedScheduleDraft:
    organization = require_solver_organization(organization_id, session)
    settings = organization_solver_settings(organization)
    weights = settings.weights
    configuration_source = "organization"
    if solver_weights is not None:
        weights = solver_weights
        configuration_source = "run_override"
    replay = None
    if replay_of_run_id is not None:
        replay = require_replay_snapshot(
            replay_of_run_id, schedule_period.id, organization_id, session
        )
        if replay.generation_mode != generation_mode:
            raise HTTPException(
                status_code=409, detail="Replay must use the original generation mode"
            )
    snapshot = SolverRunSnapshot(
        weights=weights,
        configuration_source=configuration_source,
        organization_revision=settings.revision,
        generation_mode=generation_mode,
        runtime=current_solver_runtime(),
        replay_of_run_id=replay_of_run_id,
    )
    job = ScheduleJob(
        organization_id=organization_id,
        schedule_period_id=schedule_period.id,
        status="running",
        requested_by_subject=requested_by_subject,
        started_at=current_utc_time(),
        solver_snapshot=snapshot.model_dump(mode="json"),
    )
    session.add(job)
    session.commit()
    job_id = job.id
    started_at = perf_counter()
    try:
        if replay is not None:
            assert replay.input_snapshot is not None
            solver_input = replay.input_snapshot.model_copy(deep=True)
        else:
            solver_input = build_solver_input(
                schedule_period, organization_id, session, requested_assignments
            )
        solver_input.preference_weights = weights
        snapshot.input_snapshot = solver_input
        snapshot.input_fingerprint = solver_input_fingerprint(solver_input)
        job.solver_snapshot = snapshot.model_dump(mode="json")
        session.commit()
        input_size_bytes = payload_size_bytes(solver_input)
        solve_started_at = perf_counter()
        solver_result = solve_schedule(solver_input, generation_mode)
        solve_finished_at = perf_counter()
        duration_seconds = solve_finished_at - solve_started_at
        solve_duration_ms = int(duration_seconds * 1000)
        snapshot.duration_ms = solve_duration_ms
        snapshot.result = solver_result
        if solver_result.solver_score is not None:
            snapshot.outcomes = measure_solver_outcomes(solver_input, solver_result)
        schedule_version, assignments, violations = persist_solver_result(
            schedule_period.id,
            parent_schedule_version_id,
            solver_result,
            notes,
            organization_id,
            session,
            job_id,
        )
        job.status = "completed"
        job.finished_at = current_utc_time()
        job.solver_snapshot = snapshot.model_dump(mode="json")
        session.commit()
    except Exception:
        session.rollback()
        failed_job = session.get(ScheduleJob, job_id)
        if failed_job is not None:
            failed_job.status = "failed"
            failed_job.finished_at = current_utc_time()
            failed_job.error_message = (
                "Schedule generation failed. Review the request and retry."
            )
            elapsed_seconds = perf_counter() - started_at
            snapshot.duration_ms = int(elapsed_seconds * 1000)
            failed_job.solver_snapshot = snapshot.model_dump(mode="json")
            session.commit()
        logger.exception("Solver run failed", extra={"schedule_job_id": str(job_id)})
        raise
    exceeded_too_long_threshold = solve_duration_ms > TOO_LONG_SOLVE_THRESHOLD_MS
    metrics = SolverRunMetrics(
        solve_duration_ms=solve_duration_ms,
        payload_size_bytes=input_size_bytes,
        too_long_threshold_ms=TOO_LONG_SOLVE_THRESHOLD_MS,
        exceeded_too_long_threshold=exceeded_too_long_threshold,
    )
    logger.info(
        "Generated schedule draft",
        extra={"schedule_job_id": str(job_id), "solve_duration_ms": solve_duration_ms},
    )
    generated_draft = GeneratedScheduleDraft(
        version=schedule_version,
        assignments=assignments,
        violations=violations,
        metrics=metrics,
        is_feasible=solver_result.is_feasible,
    )
    return generated_draft
