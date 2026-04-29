from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Center
from app.db.models import Room
from app.db.session import get_db
from app.dependencies import get_current_organization_id
from app.schemas.room import RoomCreate
from app.schemas.room import RoomRead
from app.schemas.room import RoomUpdate

router = APIRouter(tags=["rooms"])


def find_room(
    room_id: UUID,
    organization_id: UUID,
    session: Session,
) -> Room:
    statement = select(Room).where(Room.id == room_id)
    statement = statement.where(Room.organization_id == organization_id)
    room = session.scalar(statement)

    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    return room


def require_center(
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


@router.get("/centers/{center_id}/rooms", response_model=list[RoomRead])
def list_rooms_for_center(
    center_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> list[Room]:
    require_center(center_id, organization_id, session)
    statement = select(Room).where(Room.organization_id == organization_id)
    statement = statement.where(Room.center_id == center_id)
    statement = statement.order_by(Room.display_order, Room.name)
    rooms = list(session.scalars(statement))
    return rooms


@router.post("/centers/{center_id}/rooms", response_model=RoomRead, status_code=201)
def create_room_for_center(
    center_id: UUID,
    request: RoomCreate,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> Room:
    require_center(center_id, organization_id, session)
    room = Room(
        organization_id=organization_id,
        center_id=center_id,
        name=request.name,
        display_order=request.display_order,
    )
    session.add(room)
    session.commit()
    session.refresh(room)
    return room


@router.get("/rooms/{room_id}", response_model=RoomRead)
def read_room(
    room_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> Room:
    room = find_room(room_id, organization_id, session)
    return room


@router.patch("/rooms/{room_id}", response_model=RoomRead)
def update_room(
    room_id: UUID,
    request: RoomUpdate,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> Room:
    room = find_room(room_id, organization_id, session)

    if request.name is not None:
        room.name = request.name

    if request.display_order is not None:
        room.display_order = request.display_order

    session.commit()
    session.refresh(room)
    return room


@router.delete("/rooms/{room_id}", response_model=RoomRead)
def deactivate_room(
    room_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> Room:
    room = find_room(room_id, organization_id, session)
    room.is_active = False
    session.commit()
    session.refresh(room)
    return room
