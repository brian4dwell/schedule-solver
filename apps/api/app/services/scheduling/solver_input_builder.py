from datetime import UTC
from datetime import datetime
from datetime import time
from datetime import timedelta
from uuid import UUID
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm import selectinload

from app.db.models import Provider
from app.db.models import ProviderAvailability
from app.db.models import Room
from app.db.models import RoomRoomType
from app.db.models import SchedulePeriod
from app.db.models import ShiftRequirement
from app.schemas.schedule import ScheduleAssignmentCreate
from app.services.scheduling.solver_contracts import SolverInput
from app.services.scheduling.solver_contracts import SolverProvider
from app.services.scheduling.solver_contracts import SolverRoom
from app.services.scheduling.solver_contracts import SolverShiftRequirement
from app.services.scheduling.solver_contracts import SolverTimeBlock


def period_start_datetime(schedule_period: SchedulePeriod) -> datetime:
    start_datetime = datetime.combine(schedule_period.start_date, time.min)
    aware_start_datetime = start_datetime.replace(tzinfo=UTC)
    return aware_start_datetime


def period_end_datetime(schedule_period: SchedulePeriod) -> datetime:
    next_date = schedule_period.end_date + timedelta(days=1)
    end_datetime = datetime.combine(next_date, time.min)
    aware_end_datetime = end_datetime.replace(tzinfo=UTC)
    return aware_end_datetime


def room_type_ids_for_room(
    room: Room,
    room_type_assignments: list[RoomRoomType],
) -> list[UUID]:
    room_type_ids: list[UUID] = []

    for room_type_assignment in room_type_assignments:
        assignment_matches_room = room_type_assignment.room_id == room.id

        if not assignment_matches_room:
            continue

        room_type_ids.append(room_type_assignment.room_type_id)

    return room_type_ids


def time_blocks_for_provider(
    provider: Provider,
    provider_availability_blocks: list[ProviderAvailability],
    availability_type: str,
) -> list[SolverTimeBlock]:
    time_blocks: list[SolverTimeBlock] = []

    for availability_block in provider_availability_blocks:
        block_matches_provider = availability_block.provider_id == provider.id

        if not block_matches_provider:
            continue

        block_matches_type = availability_block.availability_type == availability_type

        if not block_matches_type:
            continue

        time_block = SolverTimeBlock(
            start_time=availability_block.start_time,
            end_time=availability_block.end_time,
            availability_type=availability_block.availability_type,
        )
        time_blocks.append(time_block)

    return time_blocks


def solver_room_from_model(
    room: Room,
    room_type_assignments: list[RoomRoomType],
) -> SolverRoom:
    room_type_ids = room_type_ids_for_room(room, room_type_assignments)
    solver_room = SolverRoom(
        id=room.id,
        center_id=room.center_id,
        md_only=room.md_only,
        room_type_ids=room_type_ids,
    )
    return solver_room


def active_credentialed_center_ids(provider: Provider) -> list[UUID]:
    center_ids: list[UUID] = []

    for credential in provider.center_credentials:
        credential_is_active = credential.is_active

        if not credential_is_active:
            continue

        center_ids.append(credential.center_id)

    return center_ids


def solver_provider_from_model(
    provider: Provider,
    provider_availability_blocks: list[ProviderAvailability],
) -> SolverProvider:
    unavailable_blocks = time_blocks_for_provider(
        provider,
        provider_availability_blocks,
        "unavailable",
    )
    preferred_blocks = time_blocks_for_provider(
        provider,
        provider_availability_blocks,
        "preferred",
    )
    avoid_blocks = time_blocks_for_provider(
        provider,
        provider_availability_blocks,
        "avoid_if_possible",
    )
    credentialed_center_ids = active_credentialed_center_ids(provider)
    solver_provider = SolverProvider(
        id=provider.id,
        provider_type=provider.provider_type,
        credentialed_center_ids=credentialed_center_ids,
        skill_room_type_ids=provider.skill_room_type_ids,
        unavailable_blocks=unavailable_blocks,
        preferred_blocks=preferred_blocks,
        avoid_blocks=avoid_blocks,
    )
    return solver_provider


def solver_shift_from_model(shift_requirement: ShiftRequirement) -> SolverShiftRequirement:
    solver_shift = SolverShiftRequirement(
        id=shift_requirement.id,
        assignment_id=None,
        source_shift_requirement_id=shift_requirement.id,
        center_id=shift_requirement.center_id,
        room_id=shift_requirement.room_id,
        start_time=shift_requirement.start_time,
        end_time=shift_requirement.end_time,
        required_provider_count=shift_requirement.required_provider_count,
        required_provider_type=shift_requirement.required_provider_type,
    )
    return solver_shift


def solver_shift_from_assignment(
    assignment: ScheduleAssignmentCreate,
) -> SolverShiftRequirement:
    shift_id = uuid4()
    solver_shift = SolverShiftRequirement(
        id=shift_id,
        assignment_id=None,
        source_shift_requirement_id=assignment.shift_requirement_id,
        center_id=assignment.center_id,
        room_id=assignment.room_id,
        start_time=assignment.start_time,
        end_time=assignment.end_time,
        required_provider_count=1,
        required_provider_type=assignment.required_provider_type,
    )
    return solver_shift


def load_shift_requirements(
    schedule_period: SchedulePeriod,
    organization_id: UUID,
    session: Session,
) -> list[ShiftRequirement]:
    period_start = period_start_datetime(schedule_period)
    period_end = period_end_datetime(schedule_period)
    statement = select(ShiftRequirement)
    statement = statement.where(ShiftRequirement.organization_id == organization_id)
    statement = statement.where(ShiftRequirement.start_time < period_end)
    statement = statement.where(ShiftRequirement.end_time > period_start)
    statement = statement.order_by(ShiftRequirement.start_time, ShiftRequirement.id)
    shift_requirements = list(session.scalars(statement))
    return shift_requirements


def load_rooms(
    organization_id: UUID,
    session: Session,
) -> list[Room]:
    statement = select(Room).where(Room.organization_id == organization_id)
    statement = statement.where(Room.is_active.is_(True))
    statement = statement.order_by(Room.center_id, Room.display_order, Room.name)
    rooms = list(session.scalars(statement))
    return rooms


def load_room_type_assignments(
    organization_id: UUID,
    session: Session,
) -> list[RoomRoomType]:
    statement = select(RoomRoomType)
    statement = statement.where(RoomRoomType.organization_id == organization_id)
    room_type_assignments = list(session.scalars(statement))
    return room_type_assignments


def load_providers(
    organization_id: UUID,
    session: Session,
) -> list[Provider]:
    statement = select(Provider).where(Provider.organization_id == organization_id)
    statement = statement.where(Provider.is_active.is_(True))
    statement = statement.order_by(Provider.display_name, Provider.id)
    statement = statement.options(selectinload(Provider.center_credentials))
    statement = statement.options(selectinload(Provider.room_type_skills))
    providers = list(session.scalars(statement))
    return providers


def load_provider_availability(
    schedule_period: SchedulePeriod,
    organization_id: UUID,
    session: Session,
) -> list[ProviderAvailability]:
    period_start = period_start_datetime(schedule_period)
    period_end = period_end_datetime(schedule_period)
    statement = select(ProviderAvailability)
    statement = statement.where(ProviderAvailability.organization_id == organization_id)
    statement = statement.where(ProviderAvailability.start_time < period_end)
    statement = statement.where(ProviderAvailability.end_time > period_start)
    provider_availability_blocks = list(session.scalars(statement))
    return provider_availability_blocks


def build_solver_input(
    schedule_period: SchedulePeriod,
    organization_id: UUID,
    session: Session,
    requested_assignments: list[ScheduleAssignmentCreate] | None = None,
) -> SolverInput:
    rooms = load_rooms(organization_id, session)
    room_type_assignments = load_room_type_assignments(organization_id, session)
    providers = load_providers(organization_id, session)
    provider_availability_blocks = load_provider_availability(
        schedule_period,
        organization_id,
        session,
    )
    has_requested_assignments = requested_assignments is not None

    if has_requested_assignments:
        solver_shift_requirements = [
            solver_shift_from_assignment(requested_assignment)
            for requested_assignment in requested_assignments
        ]
    else:
        shift_requirements = load_shift_requirements(
            schedule_period,
            organization_id,
            session,
        )
        solver_shift_requirements = [
            solver_shift_from_model(shift_requirement)
            for shift_requirement in shift_requirements
        ]

    solver_rooms = [
        solver_room_from_model(room, room_type_assignments)
        for room in rooms
    ]
    solver_providers = [
        solver_provider_from_model(provider, provider_availability_blocks)
        for provider in providers
    ]
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period.id,
        rooms=solver_rooms,
        providers=solver_providers,
        shift_requirements=solver_shift_requirements,
    )
    return solver_input
