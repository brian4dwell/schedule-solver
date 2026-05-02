from datetime import UTC
from datetime import datetime
from uuid import UUID
from uuid import uuid4

from app.services.scheduling.solver import solve_schedule
from app.services.scheduling.solver_contracts import SolverInput
from app.services.scheduling.solver_contracts import SolverProvider
from app.services.scheduling.solver_contracts import SolverRoom
from app.services.scheduling.solver_contracts import SolverShiftRequirement
from app.services.scheduling.solver_contracts import SolverTimeBlock


def create_shift(
    center_id: UUID,
    room_id: UUID,
    start_hour: int,
    end_hour: int,
) -> SolverShiftRequirement:
    shift_id = uuid4()
    start_time = datetime(2026, 5, 4, start_hour, 0, tzinfo=UTC)
    end_time = datetime(2026, 5, 4, end_hour, 0, tzinfo=UTC)
    shift = SolverShiftRequirement(
        id=shift_id,
        source_shift_requirement_id=shift_id,
        center_id=center_id,
        room_id=room_id,
        start_time=start_time,
        end_time=end_time,
        required_provider_count=1,
        required_provider_type="doctor",
    )
    return shift


def create_provider(
    center_id: UUID,
    room_type_id: UUID,
) -> SolverProvider:
    provider = SolverProvider(
        id=uuid4(),
        provider_type="doctor",
        credentialed_center_ids=[center_id],
        skill_room_type_ids=[room_type_id],
        unavailable_blocks=[],
        preferred_blocks=[],
        avoid_blocks=[],
    )
    return provider


def create_room(
    center_id: UUID,
    room_type_id: UUID,
) -> SolverRoom:
    room = SolverRoom(
        id=uuid4(),
        center_id=center_id,
        md_only=True,
        room_type_ids=[room_type_id],
    )
    return room


def test_solver_assigns_valid_provider_to_shift() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    provider = create_provider(center_id, room_type_id)
    shift = create_shift(center_id, room.id, 7, 15)
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[provider],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is True
    assert len(result.assignments) == 1
    assert result.assignments[0].provider_id == provider.id
    assert result.assignments[0].shift_requirement_id == shift.id
    assert result.violations == []


def test_solver_reports_unfillable_shift_without_fake_assignment() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    provider = create_provider(center_id, room_type_id)
    unavailable_block = SolverTimeBlock(
        start_time=datetime(2026, 5, 4, 7, 0, tzinfo=UTC),
        end_time=datetime(2026, 5, 4, 15, 0, tzinfo=UTC),
        availability_type="unavailable",
    )
    provider.unavailable_blocks = [unavailable_block]
    shift = create_shift(center_id, room.id, 7, 15)
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[provider],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is False
    assert result.assignments == []
    assert result.violations[0].constraint_type == "unfillable_shift_requirement"


def test_solver_rejects_overlapping_shifts_for_same_provider() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    provider = create_provider(center_id, room_type_id)
    first_shift = create_shift(center_id, room.id, 7, 15)
    second_shift = create_shift(center_id, room.id, 12, 18)
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[provider],
        shift_requirements=[first_shift, second_shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is False
    assert result.assignments == []
    assert result.violations[0].constraint_type == "infeasible_solver_model"


def test_solver_rejects_empty_shift_requirements() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[],
        providers=[],
        shift_requirements=[],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is False
    assert result.assignments == []
    assert result.violations[0].constraint_type == "missing_shift_requirements"


def test_solver_assigns_provider_to_board_slot_without_stored_shift() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    provider = create_provider(center_id, room_type_id)
    shift_id = uuid4()
    shift = SolverShiftRequirement(
        id=shift_id,
        source_shift_requirement_id=None,
        center_id=center_id,
        room_id=room.id,
        start_time=datetime(2026, 5, 4, 7, 0, tzinfo=UTC),
        end_time=datetime(2026, 5, 4, 15, 0, tzinfo=UTC),
        required_provider_count=1,
        required_provider_type="doctor",
    )
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[provider],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is True
    assert len(result.assignments) == 1
    assert result.assignments[0].provider_id == provider.id
    assert result.assignments[0].shift_requirement_id is None
