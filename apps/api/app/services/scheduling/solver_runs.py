import hashlib
import json
from functools import lru_cache
from pathlib import Path
from uuid import UUID

import ortools
from fastapi import HTTPException
from ortools.sat.python import cp_model
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Organization
from app.db.models import ScheduleJob
from app.db.models import ScheduleVersion
from app.schemas.solver_settings import SolverSettingsRead
from app.schemas.solver_settings import SolverWeights
from app.services.scheduling.solver import MAX_SOLVE_SECONDS
from app.services.scheduling.solver_contracts import SolverInput
from app.services.scheduling.solver_run_contracts import SolverRunRead
from app.services.scheduling.solver_run_contracts import SolverRunSnapshot
from app.services.scheduling.solver_run_contracts import SolverRuntime


@lru_cache(maxsize=1)
def current_solver_runtime() -> SolverRuntime:
    digest = hashlib.sha256()
    source_directory = Path(__file__).parent
    source_paths = sorted(source_directory.glob("*.py"))
    settings_path = source_directory.parents[1] / "schemas" / "solver_settings.py"
    source_paths.append(settings_path)
    for source_path in source_paths:
        digest.update(source_path.name.encode("utf-8"))
        source_text = source_path.read_text(encoding="utf-8")
        digest.update(source_text.encode("utf-8"))
    solver = cp_model.CpSolver()
    runtime = SolverRuntime(
        implementation_id=digest.hexdigest(),
        ortools_version=ortools.__version__,
        max_solve_seconds=MAX_SOLVE_SECONDS,
        num_search_workers=solver.parameters.num_search_workers,
        random_seed=solver.parameters.random_seed,
    )
    return runtime


def solver_input_fingerprint(solver_input: SolverInput) -> str:
    input_data = solver_input.model_dump(mode="json", exclude={"preference_weights"})
    canonical_json = json.dumps(input_data, sort_keys=True, separators=(",", ":"))
    encoded_input = canonical_json.encode("utf-8")
    digest = hashlib.sha256(encoded_input)
    return digest.hexdigest()


def require_solver_organization(
    organization_id: UUID, session: Session
) -> Organization:
    statement = select(Organization).where(Organization.id == organization_id)
    organization = session.scalar(statement)
    if organization is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return organization


def organization_solver_settings(organization: Organization) -> SolverSettingsRead:
    weights = SolverWeights.model_validate(organization.solver_weights)
    settings = SolverSettingsRead(
        weights=weights,
        baseline=SolverWeights(),
        revision=organization.solver_weights_revision,
    )
    return settings


def require_solver_job(
    run_id: UUID, period_id: UUID, organization_id: UUID, session: Session
) -> ScheduleJob:
    statement = select(ScheduleJob)
    statement = statement.where(ScheduleJob.id == run_id)
    statement = statement.where(ScheduleJob.organization_id == organization_id)
    statement = statement.where(ScheduleJob.schedule_period_id == period_id)
    job = session.scalar(statement)
    if job is None:
        raise HTTPException(status_code=404, detail="Solver run not found")
    if job.solver_snapshot is None:
        raise HTTPException(
            status_code=409, detail="Settings not recorded for this run"
        )
    return job


def require_replay_snapshot(
    run_id: UUID, period_id: UUID, organization_id: UUID, session: Session
) -> SolverRunSnapshot:
    job = require_solver_job(run_id, period_id, organization_id, session)
    snapshot = SolverRunSnapshot.model_validate(job.solver_snapshot)
    runtime = current_solver_runtime()
    if snapshot.runtime != runtime:
        raise HTTPException(
            status_code=409,
            detail="This run used a different solver implementation or runtime. Use its settings with current inputs instead.",
        )
    if snapshot.input_snapshot is None:
        raise HTTPException(
            status_code=409, detail="This run did not capture scheduling inputs"
        )
    return snapshot


def solver_run_read(job: ScheduleJob, session: Session) -> SolverRunRead:
    snapshot = SolverRunSnapshot.model_validate(job.solver_snapshot)
    version_statement = select(ScheduleVersion)
    version_statement = version_statement.where(
        ScheduleVersion.organization_id == job.organization_id
    )
    version_statement = version_statement.where(
        ScheduleVersion.schedule_job_id == job.id
    )
    version_statement = version_statement.where(ScheduleVersion.source == "solver")
    version_statement = version_statement.order_by(ScheduleVersion.version_number)
    version = session.scalar(version_statement)
    result = snapshot.result
    runtime = current_solver_runtime()
    can_replay = snapshot.input_snapshot is not None and snapshot.runtime == runtime
    violation_messages: list[str] = []
    if result is not None:
        violation_messages = [violation.message for violation in result.violations]
    response = SolverRunRead(
        id=job.id,
        schedule_period_id=job.schedule_period_id,
        schedule_version_id=version.id if version is not None else None,
        version_number=version.version_number if version is not None else None,
        status=job.status,
        requested_by_subject=job.requested_by_subject,
        started_at=job.started_at,
        finished_at=job.finished_at,
        error_message=job.error_message,
        weights=snapshot.weights,
        configuration_source=snapshot.configuration_source,
        organization_revision=snapshot.organization_revision,
        schema_version=snapshot.schema_version,
        generation_mode=snapshot.generation_mode,
        runtime=snapshot.runtime,
        replay_of_run_id=snapshot.replay_of_run_id,
        input_fingerprint=snapshot.input_fingerprint,
        can_replay=can_replay,
        solver_status=result.solver_status if result is not None else None,
        is_feasible=result.is_feasible if result is not None else None,
        solver_score=result.solver_score if result is not None else None,
        outcomes=snapshot.outcomes,
        duration_ms=snapshot.duration_ms,
        violation_messages=violation_messages,
    )
    return response
