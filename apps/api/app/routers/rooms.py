from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Assignment
from app.db.models import Center
from app.db.models import Room
from app.db.models import RoomRoomType
from app.db.models import RoomType
from app.db.models import ShiftRequirement
from app.db.session import get_db
from app.dependencies import get_current_organization_id
from app.schemas.room import RoomCreate
from app.schemas.room import RoomRead
from app.schemas.room import RoomTypeCreate
from app.schemas.room import RoomTypeRead
from app.schemas.room import RoomTypeUpdate
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


def find_room_type(
    room_type_id: UUID,
    organization_id: UUID,
    session: Session,
) -> RoomType:
    statement = select(RoomType).where(RoomType.id == room_type_id)
    statement = statement.where(RoomType.organization_id == organization_id)
    room_type = session.scalar(statement)

    if room_type is None:
        raise HTTPException(status_code=404, detail="Room type not found")

    return room_type


def room_types_for_organization(
    organization_id: UUID,
    session: Session,
) -> list[RoomType]:
    statement = select(RoomType).where(RoomType.organization_id == organization_id)
    statement = statement.order_by(RoomType.display_order, RoomType.name)
    room_types = list(session.scalars(statement))
    return room_types


def room_types_for_room(
    room_id: UUID,
    organization_id: UUID,
    session: Session,
) -> list[RoomType]:
    statement = select(RoomType)
    statement = statement.join(RoomRoomType, RoomRoomType.room_type_id == RoomType.id)
    statement = statement.where(RoomRoomType.organization_id == organization_id)
    statement = statement.where(RoomRoomType.room_id == room_id)
    statement = statement.order_by(RoomType.display_order, RoomType.name)
    room_types = list(session.scalars(statement))
    return room_types


def read_model_for_room(
    room: Room,
    organization_id: UUID,
    session: Session,
) -> RoomRead:
    room_types = room_types_for_room(room.id, organization_id, session)
    room_type_reads = [
        RoomTypeRead.model_validate(room_type)
        for room_type in room_types
    ]
    room_read = RoomRead.model_validate(room)
    room_read.room_types = room_type_reads
    return room_read


def require_room_types_for_room(
    room_type_ids: list[UUID],
    organization_id: UUID,
    session: Session,
) -> list[RoomType]:
    room_types: list[RoomType] = []
    requested_room_type_ids: list[UUID] = []

    for room_type_id in room_type_ids:
        if room_type_id in requested_room_type_ids:
            continue

        requested_room_type_ids.append(room_type_id)

    for room_type_id in requested_room_type_ids:
        room_type = find_room_type(room_type_id, organization_id, session)

        if not room_type.is_active:
            raise HTTPException(status_code=400, detail="Room type is inactive")

        room_types.append(room_type)

    return room_types


def replace_room_type_assignments(
    room: Room,
    room_type_ids: list[UUID],
    organization_id: UUID,
    session: Session,
) -> None:
    room_types = require_room_types_for_room(room_type_ids, organization_id, session)
    delete_statement = select(RoomRoomType).where(RoomRoomType.organization_id == organization_id)
    delete_statement = delete_statement.where(RoomRoomType.room_id == room.id)
    current_assignments = list(session.scalars(delete_statement))
    current_room_type_ids = [
        current_assignment.room_type_id
        for current_assignment in current_assignments
    ]

    for current_assignment in current_assignments:
        should_delete_assignment = current_assignment.room_type_id not in room_type_ids

        if should_delete_assignment:
            session.delete(current_assignment)

    for room_type in room_types:
        should_add_assignment = room_type.id not in current_room_type_ids

        if not should_add_assignment:
            continue

        assignment = RoomRoomType(
            organization_id=organization_id,
            room_id=room.id,
            room_type_id=room_type.id,
        )
        session.add(assignment)


def room_has_schedule_records(
    room: Room,
    organization_id: UUID,
    session: Session,
) -> bool:
    shift_requirement_statement = select(ShiftRequirement.id)
    shift_requirement_statement = shift_requirement_statement.where(
        ShiftRequirement.organization_id == organization_id,
    )
    shift_requirement_statement = shift_requirement_statement.where(ShiftRequirement.room_id == room.id)
    shift_requirement_statement = shift_requirement_statement.limit(1)
    shift_requirement_id = session.scalar(shift_requirement_statement)
    has_shift_requirement = shift_requirement_id is not None

    if has_shift_requirement:
        return True

    assignment_statement = select(Assignment.id)
    assignment_statement = assignment_statement.where(
        Assignment.organization_id == organization_id,
    )
    assignment_statement = assignment_statement.where(Assignment.room_id == room.id)
    assignment_statement = assignment_statement.limit(1)
    assignment_id = session.scalar(assignment_statement)
    has_assignment = assignment_id is not None

    return has_assignment


def delete_room_type_assignments(
    room: Room,
    organization_id: UUID,
    session: Session,
) -> None:
    statement = select(RoomRoomType)
    statement = statement.where(RoomRoomType.organization_id == organization_id)
    statement = statement.where(RoomRoomType.room_id == room.id)
    assignments = list(session.scalars(statement))

    for assignment in assignments:
        session.delete(assignment)


@router.get("/room-types", response_model=list[RoomTypeRead])
def list_room_types(
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> list[RoomType]:
    room_types = room_types_for_organization(organization_id, session)
    return room_types


@router.post("/room-types", response_model=RoomTypeRead, status_code=201)
def create_room_type(
    request: RoomTypeCreate,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> RoomType:
    room_type = RoomType(
        organization_id=organization_id,
        name=request.name,
        display_order=request.display_order,
    )
    session.add(room_type)
    session.commit()
    session.refresh(room_type)
    return room_type


@router.patch("/room-types/{room_type_id}", response_model=RoomTypeRead)
def update_room_type(
    room_type_id: UUID,
    request: RoomTypeUpdate,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> RoomType:
    room_type = find_room_type(room_type_id, organization_id, session)

    if request.name is not None:
        room_type.name = request.name

    if request.display_order is not None:
        room_type.display_order = request.display_order

    session.commit()
    session.refresh(room_type)
    return room_type


@router.delete("/room-types/{room_type_id}", response_model=RoomTypeRead)
def deactivate_room_type(
    room_type_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> RoomType:
    room_type = find_room_type(room_type_id, organization_id, session)
    room_type.is_active = False
    session.commit()
    session.refresh(room_type)
    return room_type


@router.get("/centers/{center_id}/rooms", response_model=list[RoomRead])
def list_rooms_for_center(
    center_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> list[RoomRead]:
    require_center(center_id, organization_id, session)
    statement = select(Room).where(Room.organization_id == organization_id)
    statement = statement.where(Room.center_id == center_id)
    statement = statement.order_by(Room.display_order, Room.name)
    rooms = list(session.scalars(statement))
    room_reads = [
        read_model_for_room(room, organization_id, session)
        for room in rooms
    ]
    return room_reads


@router.post("/centers/{center_id}/rooms", response_model=RoomRead, status_code=201)
def create_room_for_center(
    center_id: UUID,
    request: RoomCreate,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> RoomRead:
    require_center(center_id, organization_id, session)
    room = Room(
        organization_id=organization_id,
        center_id=center_id,
        name=request.name,
        display_order=request.display_order,
        md_only=request.md_only,
    )
    session.add(room)
    session.flush()
    replace_room_type_assignments(room, request.room_type_ids, organization_id, session)
    session.commit()
    session.refresh(room)
    room_read = read_model_for_room(room, organization_id, session)
    return room_read


@router.get("/rooms/{room_id}", response_model=RoomRead)
def read_room(
    room_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> RoomRead:
    room = find_room(room_id, organization_id, session)
    room_read = read_model_for_room(room, organization_id, session)
    return room_read


@router.patch("/rooms/{room_id}", response_model=RoomRead)
def update_room(
    room_id: UUID,
    request: RoomUpdate,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> RoomRead:
    room = find_room(room_id, organization_id, session)

    if request.name is not None:
        room.name = request.name

    if request.display_order is not None:
        room.display_order = request.display_order

    if request.md_only is not None:
        room.md_only = request.md_only

    if request.room_type_ids is not None:
        replace_room_type_assignments(room, request.room_type_ids, organization_id, session)

    session.commit()
    session.refresh(room)
    room_read = read_model_for_room(room, organization_id, session)
    return room_read


@router.delete("/rooms/{room_id}", response_model=RoomRead)
def delete_room(
    room_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> RoomRead:
    room = find_room(room_id, organization_id, session)
    has_schedule_records = room_has_schedule_records(room, organization_id, session)

    if not has_schedule_records:
        room_read = read_model_for_room(room, organization_id, session)
        delete_room_type_assignments(room, organization_id, session)
        session.delete(room)
        session.commit()
        return room_read

    room.is_active = False
    session.commit()
    session.refresh(room)
    room_read = read_model_for_room(room, organization_id, session)
    return room_read
