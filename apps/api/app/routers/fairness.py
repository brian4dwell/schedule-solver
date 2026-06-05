from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies import get_current_organization_id
from app.dependencies import require_admin_user
from app.schemas.fairness import FairnessReportRead
from app.services.scheduling.fairness import fairness_report

router = APIRouter(tags=["fairness"], dependencies=[Depends(require_admin_user)])


@router.get("/fairness/report", response_model=FairnessReportRead)
def read_fairness_report(
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> FairnessReportRead:
    report = fairness_report(organization_id, session)
    return report
