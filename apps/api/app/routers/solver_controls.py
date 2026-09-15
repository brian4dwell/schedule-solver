from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from sqlalchemy import select
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db.models import Organization
from app.db.models import ScheduleJob
from app.db.models import SchedulePeriod
from app.db.session import get_db
from app.dependencies import get_current_organization_id
from app.dependencies import require_admin_user
from app.schemas.solver_settings import SolverSettingsRead
from app.schemas.solver_settings import SolverSettingsWrite
from app.services.scheduling.solver_run_contracts import SolverRunRead
from app.services.scheduling.solver_runs import organization_solver_settings
from app.services.scheduling.solver_runs import require_solver_organization
from app.services.scheduling.solver_runs import solver_run_read

router = APIRouter(tags=["solver-controls"], dependencies=[Depends(require_admin_user)])


@router.get("/solver-settings", response_model=SolverSettingsRead)
def read_solver_settings(
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> SolverSettingsRead:
    organization = require_solver_organization(organization_id, session)
    return organization_solver_settings(organization)


@router.put("/solver-settings", response_model=SolverSettingsRead)
def save_solver_settings(
    request: SolverSettingsWrite,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> SolverSettingsRead:
    serialized_weights = request.weights.model_dump(mode="json")
    next_revision = request.expected_revision + 1
    statement = update(Organization)
    statement = statement.where(Organization.id == organization_id)
    statement = statement.where(
        Organization.solver_weights_revision == request.expected_revision
    )
    statement = statement.values(
        solver_weights=serialized_weights, solver_weights_revision=next_revision
    )
    result = session.execute(statement)
    if result.rowcount != 1:
        raise HTTPException(
            status_code=409,
            detail="Organization defaults changed. Reload defaults before saving.",
        )
    session.commit()
    organization = require_solver_organization(organization_id, session)
    session.refresh(organization)
    return organization_solver_settings(organization)


@router.get(
    "/schedule-periods/{period_id}/solver-runs", response_model=list[SolverRunRead]
)
def list_solver_runs(
    period_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
) -> list[SolverRunRead]:
    period_statement = select(SchedulePeriod.id)
    period_statement = period_statement.where(SchedulePeriod.id == period_id)
    period_statement = period_statement.where(
        SchedulePeriod.organization_id == organization_id
    )
    if session.scalar(period_statement) is None:
        raise HTTPException(status_code=404, detail="Schedule Period not found")
    statement = select(ScheduleJob)
    statement = statement.where(ScheduleJob.organization_id == organization_id)
    statement = statement.where(ScheduleJob.schedule_period_id == period_id)
    statement = statement.where(ScheduleJob.solver_snapshot.is_not(None))
    statement = statement.order_by(ScheduleJob.created_at.desc(), ScheduleJob.id.desc())
    statement = statement.offset(offset)
    statement = statement.limit(limit)
    jobs = list(session.scalars(statement))
    runs = [solver_run_read(job, session) for job in jobs]
    return runs
