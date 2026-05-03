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
from app.db.models import ProviderCenterCredential
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import Room
from app.db.models import RoomRoomType
from app.db.models import SchedulePeriod
from app.db.models import ShiftRequirement
from app.schemas.schedule import ScheduleAssignmentCreate
from app.services.scheduling.solver_contracts import SolverCenterCredential
from app.services.scheduling.solver_contracts import SolverInput
from app.services.scheduling.solver_contracts import SolverProvider
from app.services.scheduling.solver_contracts import SolverProviderRoomTypeSkill
from app.services.scheduling.solver_contracts import SolverProviderWeekAvailability
from app.services.scheduling.solver_contracts import SolverRequiredRoomTypeSkill
from app.services.scheduling.solver_contracts import SolverRoom
from app.services.scheduling.solver_contracts import SolverShiftRequirement
from app.services.scheduling.solver_contracts import SolverWeeklyAvailabilityDay


def period_start_datetime(schedule_period: SchedulePeriod) -> datetime:
    start_datetime = datetime.combine(schedule_period.start_date, time.min)
    aware_start_datetime = start_datetime.replace(tzinfo=UTC)
    return aware_start_datetime


def period_end_datetime(schedule_period: SchedulePeriod) -> datetime:
    next_date = schedule_period.end_date + timedelta(days=1)
    end_datetime = datetime.combine(next_date, time.min)
    aware_end_datetime = end_datetime.replace(tzinfo=UTC)
    return aware_end_datetime


def required_room_type_skills_for_room(
    room: Room,
    room_type_assignments: list[RoomRoomType],
) -> list[SolverRequiredRoomTypeSkill]:
    required_skills: list[SolverRequiredRoomTypeSkill] = []

    for room_type_assignment in room_type_assignments:
        assignment_matches_room = room_type_assignment.room_id == room.id

        if not assignment_matches_room:
            continue

        required_skill = SolverRequiredRoomTypeSkill(
            room_type_id=room_type_assignment.room_type_id,
            required_proficiency_level=room_type_assignment.required_proficiency_level,
        )
        required_skills.append(required_skill)

    return required_skills


def solver_room_from_model(
    room: Room,
    room_type_assignments: list[RoomRoomType],
) -> SolverRoom:
    required_room_type_skills = required_room_type_skills_for_room(
        room,
        room_type_assignments,
    )
    solver_room = SolverRoom(
        id=room.id,
        center_id=room.center_id,
        md_only=room.md_only,
        is_active=room.is_active,
        required_room_type_skills=required_room_type_skills,
    )
    return solver_room


def solver_provider_room_type_skills(
    provider: Provider,
) -> list[SolverProviderRoomTypeSkill]:
    skill_summaries: list[SolverProviderRoomTypeSkill] = []

    for room_type_skill in provider.room_type_skills:
        skill_summary = SolverProviderRoomTypeSkill(
            room_type_id=room_type_skill.room_type_id,
            proficiency_level=room_type_skill.proficiency_level,
        )
        skill_summaries.append(skill_summary)

    return skill_summaries


def solver_weekly_availability_days(
    provider: Provider,
    weekly_availability_rows: list[ProviderScheduleWeekAvailability],
) -> list[SolverWeeklyAvailabilityDay]:
    days: list[SolverWeeklyAvailabilityDay] = []

    for weekly_availability_row in weekly_availability_rows:
        row_matches_provider = weekly_availability_row.provider_id == provider.id

        if not row_matches_provider:
            continue

        day = SolverWeeklyAvailabilityDay(
            weekday=weekly_availability_row.weekday,
            options=weekly_availability_row.availability_options,
        )
        days.append(day)

    return days


def solver_provider_week_availability(
    provider: Provider,
    weekly_availability_rows: list[ProviderScheduleWeekAvailability],
) -> SolverProviderWeekAvailability:
    matching_rows = [
        weekly_availability_row
        for weekly_availability_row in weekly_availability_rows
        if weekly_availability_row.provider_id == provider.id
    ]
    has_matching_row = len(matching_rows) > 0
    min_shifts_requested = 0
    max_shifts_requested = 0

    if has_matching_row:
        first_row = matching_rows[0]
        min_shifts_requested = first_row.min_shifts_requested
        max_shifts_requested = first_row.max_shifts_requested

    days = solver_weekly_availability_days(
        provider,
        weekly_availability_rows,
    )
    week_availability = SolverProviderWeekAvailability(
        provider_id=provider.id,
        min_shifts_requested=min_shifts_requested,
        max_shifts_requested=max_shifts_requested,
        days=days,
    )
    return week_availability


def solver_provider_from_model(
    provider: Provider,
    weekly_availability_rows: list[ProviderScheduleWeekAvailability],
) -> SolverProvider:
    provider_room_type_skills = solver_provider_room_type_skills(provider)
    week_availability = solver_provider_week_availability(
        provider,
        weekly_availability_rows,
    )
    solver_provider = SolverProvider(
        id=provider.id,
        is_active=provider.is_active,
        provider_type=provider.provider_type,
        provider_room_type_skills=provider_room_type_skills,
        week_availability=week_availability,
    )
    return solver_provider


def solver_credential_from_model(
    credential: ProviderCenterCredential,
) -> SolverCenterCredential:
    solver_credential = SolverCenterCredential(
        provider_id=credential.provider_id,
        center_id=credential.center_id,
        starts_at=credential.starts_at,
        expires_at=credential.expires_at,
        is_active=credential.is_active,
    )
    return solver_credential


def solver_shift_from_model(shift_requirement: ShiftRequirement) -> SolverShiftRequirement:
    solver_shift = SolverShiftRequirement(
        id=shift_requirement.id,
        assignment_id=None,
        source_shift_requirement_id=shift_requirement.id,
        center_id=shift_requirement.center_id,
        room_id=shift_requirement.room_id,
        shift_type="full_shift",
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
        shift_type=assignment.shift_type,
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
    statement = statement.order_by(Provider.display_name, Provider.id)
    statement = statement.options(selectinload(Provider.center_credentials))
    statement = statement.options(selectinload(Provider.room_type_skills))
    providers = list(session.scalars(statement))
    return providers


def load_provider_weekly_availability(
    schedule_period: SchedulePeriod,
    organization_id: UUID,
    session: Session,
) -> list[ProviderScheduleWeekAvailability]:
    statement = select(ProviderScheduleWeekAvailability)
    statement = statement.where(ProviderScheduleWeekAvailability.organization_id == organization_id)
    statement = statement.where(ProviderScheduleWeekAvailability.schedule_week_id == schedule_period.id)
    weekly_availability_rows = list(session.scalars(statement))
    return weekly_availability_rows


def build_solver_input(
    schedule_period: SchedulePeriod,
    organization_id: UUID,
    session: Session,
    requested_assignments: list[ScheduleAssignmentCreate] | None = None,
) -> SolverInput:
    rooms = load_rooms(organization_id, session)
    room_type_assignments = load_room_type_assignments(organization_id, session)
    providers = load_providers(organization_id, session)
    weekly_availability_rows = load_provider_weekly_availability(
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
        solver_provider_from_model(provider, weekly_availability_rows)
        for provider in providers
    ]
    solver_credentials = [
        solver_credential_from_model(credential)
        for provider in providers
        for credential in provider.center_credentials
    ]
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period.id,
        rooms=solver_rooms,
        providers=solver_providers,
        center_credentials=solver_credentials,
        shift_requirements=solver_shift_requirements,
    )
    return solver_input
