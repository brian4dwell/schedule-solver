from datetime import UTC
from datetime import datetime
from uuid import UUID
from uuid import uuid4

from app.services.scheduling.solver import solve_schedule
from app.services.scheduling.solver_contracts import SolverCenterCredential
from app.services.scheduling.solver_contracts import SolverInput
from app.services.scheduling.solver_contracts import SolverProvider
from app.services.scheduling.solver_contracts import SolverProviderRoomTypeSkill
from app.services.scheduling.solver_contracts import SolverProviderWeekAvailability
from app.services.scheduling.solver_contracts import SolverRequiredRoomTypeSkill
from app.services.scheduling.solver_contracts import SolverRoom
from app.services.scheduling.solver_contracts import SolverShiftRequirement
from app.services.scheduling.solver_contracts import SolverWeeklyAvailabilityDay


def create_shift(
    center_id: UUID,
    room_id: UUID,
    start_hour: int,
    end_hour: int,
    shift_type: str = "full_shift",
) -> SolverShiftRequirement:
    shift_id = uuid4()
    start_time = datetime(2026, 5, 4, start_hour, 0, tzinfo=UTC)
    end_time = datetime(2026, 5, 4, end_hour, 0, tzinfo=UTC)
    shift = SolverShiftRequirement(
        id=shift_id,
        source_shift_requirement_id=shift_id,
        center_id=center_id,
        room_id=room_id,
        shift_type=shift_type,
        start_time=start_time,
        end_time=end_time,
        required_provider_count=1,
        required_provider_type="doctor",
    )
    return shift


def create_provider(
    center_id: UUID,
    room_type_id: UUID,
    availability_options: list[str] | None = None,
    min_shifts_requested: int = 0,
    max_shifts_requested: int = 5,
) -> SolverProvider:
    options = availability_options or ["full_shift"]
    availability_day = SolverWeeklyAvailabilityDay(
        weekday="monday",
        options=options,
    )
    week_availability = SolverProviderWeekAvailability(
        provider_id=uuid4(),
        min_shifts_requested=min_shifts_requested,
        max_shifts_requested=max_shifts_requested,
        days=[availability_day],
    )
    room_type_skill = SolverProviderRoomTypeSkill(
        room_type_id=room_type_id,
        proficiency_level=1,
    )
    provider = SolverProvider(
        id=week_availability.provider_id,
        is_active=True,
        provider_type="doctor",
        provider_room_type_skills=[room_type_skill],
        week_availability=week_availability,
    )
    return provider


def create_credential(
    provider_id: UUID,
    center_id: UUID,
) -> SolverCenterCredential:
    credential = SolverCenterCredential(
        provider_id=provider_id,
        center_id=center_id,
        is_active=True,
    )
    return credential


def create_room(
    center_id: UUID,
    room_type_id: UUID,
) -> SolverRoom:
    required_skill = SolverRequiredRoomTypeSkill(
        room_type_id=room_type_id,
        required_proficiency_level=1,
    )
    room = SolverRoom(
        id=uuid4(),
        center_id=center_id,
        md_only=True,
        is_active=True,
        required_room_type_skills=[required_skill],
    )
    return room


def test_solver_assigns_valid_provider_to_shift() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    provider = create_provider(center_id, room_type_id)
    credential = create_credential(provider.id, center_id)
    shift = create_shift(center_id, room.id, 7, 15)
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[provider],
        center_credentials=[credential],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is True
    assert len(result.assignments) == 1
    assert result.assignments[0].provider_id == provider.id
    assert result.assignments[0].shift_requirement_id == shift.id
    assert result.assignments[0].shift_type == "full_shift"
    assert result.violations == []


def test_solver_reports_unfillable_shift_without_fake_assignment() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    provider = create_provider(
        center_id,
        room_type_id,
        availability_options=["none"],
    )
    credential = create_credential(provider.id, center_id)
    shift = create_shift(center_id, room.id, 7, 15)
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[provider],
        center_credentials=[credential],
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
    credential = create_credential(provider.id, center_id)
    first_shift = create_shift(center_id, room.id, 7, 15)
    second_shift = create_shift(center_id, room.id, 12, 18)
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[provider],
        center_credentials=[credential],
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
    credential = create_credential(provider.id, center_id)
    shift_id = uuid4()
    shift = SolverShiftRequirement(
        id=shift_id,
        source_shift_requirement_id=None,
        center_id=center_id,
        room_id=room.id,
        shift_type="first_half",
        start_time=datetime(2026, 5, 4, 7, 0, tzinfo=UTC),
        end_time=datetime(2026, 5, 4, 15, 0, tzinfo=UTC),
        required_provider_count=1,
        required_provider_type="doctor",
    )
    provider.week_availability.days[0].options = ["first_half"]
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[provider],
        center_credentials=[credential],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is True
    assert len(result.assignments) == 1
    assert result.assignments[0].provider_id == provider.id
    assert result.assignments[0].shift_requirement_id is None
    assert result.assignments[0].shift_type == "first_half"


def test_solver_rejects_provider_without_matching_shift_type_availability() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    provider = create_provider(
        center_id,
        room_type_id,
        availability_options=["first_half"],
    )
    credential = create_credential(provider.id, center_id)
    shift = create_shift(center_id, room.id, 7, 15)
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[provider],
        center_credentials=[credential],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is False
    assert result.assignments == []
    assert result.violations[0].constraint_type == "unfillable_shift_requirement"


def test_solver_rejects_provider_without_active_center_credential() -> None:
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
        center_credentials=[],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is False
    assert result.assignments == []
    assert result.violations[0].constraint_type == "unfillable_shift_requirement"


def test_solver_records_max_shift_request_warning_without_blocking_assignment() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    provider = create_provider(
        center_id,
        room_type_id,
        max_shifts_requested=0,
    )
    credential = create_credential(provider.id, center_id)
    shift = create_shift(center_id, room.id, 7, 15)
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[provider],
        center_credentials=[credential],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is True
    assert len(result.assignments) == 1
    assert result.violations[0].severity == "warning"
    assert result.violations[0].constraint_type == "provider_max_shifts_exceeded"


def test_solver_records_min_shift_request_warning_without_blocking_schedule() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    provider = create_provider(
        center_id,
        room_type_id,
        min_shifts_requested=2,
    )
    credential = create_credential(provider.id, center_id)
    shift = create_shift(center_id, room.id, 7, 15)
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[provider],
        center_credentials=[credential],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is True
    assert len(result.assignments) == 1
    assert result.violations[0].severity == "warning"
    assert result.violations[0].constraint_type == "provider_min_shifts_not_met"
