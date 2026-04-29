from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Center
from app.db.session import get_db
from app.dependencies import get_current_organization_id
from app.schemas.center import CenterCreate
from app.schemas.center import CenterRead
from app.schemas.center import CenterUpdate

router = APIRouter(prefix="/centers", tags=["centers"])


def find_center(
    center_id: UUID,
    organization_id: UUID,
    session: Session,
) -> Center:
    statement = select(Center).where(Center.id == center_id)
    statement = statement.where(Center.organization_id == organization_id)
    center = session.scalar(statement)

    if center is None:
        raise HTTPException(status_code=404, detail="Center not found")

    return center


@router.get("", response_model=list[CenterRead])
def list_centers(
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> list[Center]:
    statement = select(Center).where(Center.organization_id == organization_id)
    statement = statement.order_by(Center.name)
    centers = list(session.scalars(statement))
    return centers


@router.post("", response_model=CenterRead, status_code=201)
def create_center(
    request: CenterCreate,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> Center:
    center = Center(
        organization_id=organization_id,
        name=request.name,
        address_line_1=request.address_line_1,
        address_line_2=request.address_line_2,
        city=request.city,
        state=request.state,
        postal_code=request.postal_code,
        timezone=request.timezone,
    )
    session.add(center)
    session.commit()
    session.refresh(center)
    return center


@router.get("/{center_id}", response_model=CenterRead)
def read_center(
    center_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> Center:
    center = find_center(center_id, organization_id, session)
    return center


@router.patch("/{center_id}", response_model=CenterRead)
def update_center(
    center_id: UUID,
    request: CenterUpdate,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> Center:
    center = find_center(center_id, organization_id, session)

    if request.name is not None:
        center.name = request.name

    if request.address_line_1 is not None:
        center.address_line_1 = request.address_line_1

    if request.address_line_2 is not None:
        center.address_line_2 = request.address_line_2

    if request.city is not None:
        center.city = request.city

    if request.state is not None:
        center.state = request.state

    if request.postal_code is not None:
        center.postal_code = request.postal_code

    if request.timezone is not None:
        center.timezone = request.timezone

    session.commit()
    session.refresh(center)
    return center


@router.delete("/{center_id}", response_model=CenterRead)
def deactivate_center(
    center_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> Center:
    center = find_center(center_id, organization_id, session)
    center.is_active = False
    session.commit()
    session.refresh(center)
    return center
