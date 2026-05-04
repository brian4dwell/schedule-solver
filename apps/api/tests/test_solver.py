from datetime import UTC
from datetime import date
from datetime import datetime
from uuid import UUID
from uuid import uuid4

from app.schemas.schedule import ScheduleAssignmentCreate
from app.services.scheduling.solver import solve_schedule
from app.services.scheduling.solver_contracts import SolverCenterCredential
from app.services.scheduling.solver_contracts import SolverInput
from app.services.scheduling.solver_contracts import SolverManagerCenterPreference
from app.services.scheduling.solver_contracts import SolverProvider
from app.services.scheduling.solver_contracts import SolverProviderCenterPreference
from app.services.scheduling.solver_contracts import SolverProviderRoomTypeSkill
from app.services.scheduling.solver_contracts import SolverProviderShiftTypePreference
from app.services.scheduling.solver_contracts import SolverProviderWeekAvailability
from app.services.scheduling.solver_contracts import SolverRequiredRoomTypeSkill
from app.services.scheduling.solver_contracts import SolverRoom
from app.services.scheduling.solver_contracts import SolverShiftRequirement
from app.services.scheduling.solver_contracts import SolverWeeklyAvailabilityDay
from app.services.scheduling.solver_input_builder import solver_shift_from_assignment


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
        room_slot_id=shift_id,
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
    assert result.assignments[0].room_slot_id == shift.id
    assert result.assignments[0].shift_requirement_id == shift.id
    assert result.assignments[0].shift_type == "full_shift"
    assert result.violations == []


def test_solver_creates_distinct_room_slot_ids_for_multi_provider_shift() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    first_provider = create_provider(center_id, room_type_id)
    second_provider = create_provider(center_id, room_type_id)
    first_credential = create_credential(first_provider.id, center_id)
    second_credential = create_credential(second_provider.id, center_id)
    shift = create_shift(center_id, room.id, 7, 15)
    shift.required_provider_count = 2
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[first_provider, second_provider],
        center_credentials=[first_credential, second_credential],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    room_slot_ids = [
        assignment.room_slot_id
        for assignment in result.assignments
    ]
    unique_room_slot_ids = set(room_slot_ids)

    assert result.is_feasible is True
    assert len(result.assignments) == 2
    assert len(unique_room_slot_ids) == 2


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


def test_solver_allows_split_day_overlap_for_same_center() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    provider = create_provider(center_id, room_type_id)
    credential = create_credential(provider.id, center_id)
    first_shift = create_shift(center_id, room.id, 7, 15, shift_type="first_half")
    second_shift = create_shift(center_id, room.id, 12, 18, shift_type="second_half")
    provider.week_availability.days[0].options = ["first_half", "second_half"]
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[provider],
        center_credentials=[credential],
        shift_requirements=[first_shift, second_shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is True
    assert len(result.assignments) == 2


def test_solver_rejects_split_day_overlap_for_different_centers() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    first_center_id = uuid4()
    second_center_id = uuid4()
    room_type_id = uuid4()
    first_room = create_room(first_center_id, room_type_id)
    second_room = create_room(second_center_id, room_type_id)
    provider = create_provider(first_center_id, room_type_id)
    second_credential = create_credential(provider.id, second_center_id)
    first_credential = create_credential(provider.id, first_center_id)
    first_shift = create_shift(first_center_id, first_room.id, 7, 15, shift_type="first_half")
    second_shift = create_shift(second_center_id, second_room.id, 12, 18, shift_type="second_half")
    provider.week_availability.days[0].options = ["first_half", "second_half"]
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[first_room, second_room],
        providers=[provider],
        center_credentials=[first_credential, second_credential],
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
        room_slot_id=shift_id,
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
    assert result.assignments[0].room_slot_id == shift_id
    assert result.assignments[0].shift_requirement_id is None
    assert result.assignments[0].shift_type == "first_half"


def test_solver_shift_from_assignment_preserves_room_slot_id() -> None:
    room_slot_id = uuid4()
    center_id = uuid4()
    room_id = uuid4()
    requested_assignment = ScheduleAssignmentCreate(
        room_slot_id=room_slot_id,
        provider_id=None,
        center_id=center_id,
        room_id=room_id,
        shift_requirement_id=None,
        required_provider_type=None,
        shift_type="full_shift",
        schedule_date=date(2026, 5, 6),
        start_time=datetime(2026, 5, 6, 7, 0, tzinfo=UTC),
        end_time=datetime(2026, 5, 6, 15, 0, tzinfo=UTC),
        source="manual",
        notes=None,
    )

    shift = solver_shift_from_assignment(requested_assignment)

    assert shift.room_slot_id == room_slot_id


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


def test_solver_allows_full_shift_availability_for_shorter_shift_with_warning() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    provider = create_provider(
        center_id,
        room_type_id,
        availability_options=["full_shift"],
    )
    credential = create_credential(provider.id, center_id)
    shift = create_shift(center_id, room.id, 7, 11, shift_type="first_half")
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
    assert result.violations[0].severity == "warning"
    assert result.violations[0].constraint_type == "full_shift_availability_accommodation"


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


def test_solver_respects_locked_provider_assignment() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    locked_provider = create_provider(center_id, room_type_id)
    other_provider = create_provider(center_id, room_type_id)
    locked_credential = create_credential(locked_provider.id, center_id)
    other_credential = create_credential(other_provider.id, center_id)
    shift = create_shift(center_id, room.id, 7, 15)
    shift.locked_provider_id = locked_provider.id
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[locked_provider, other_provider],
        center_credentials=[locked_credential, other_credential],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is True
    assert len(result.assignments) == 1
    assert result.assignments[0].provider_id == locked_provider.id


def test_solver_uses_fairness_pressure_to_protect_higher_debt_provider() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    high_debt_provider = create_provider(center_id, room_type_id)
    low_debt_provider = create_provider(center_id, room_type_id)
    high_debt_provider.fairness_debt = 3.0
    high_debt_provider.favor_credit = 0.0
    low_debt_provider.fairness_debt = 0.0
    low_debt_provider.favor_credit = 0.0
    high_debt_credential = create_credential(high_debt_provider.id, center_id)
    low_debt_credential = create_credential(low_debt_provider.id, center_id)
    shift = create_shift(center_id, room.id, 7, 15)
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[high_debt_provider, low_debt_provider],
        center_credentials=[high_debt_credential, low_debt_credential],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is True
    assert len(result.assignments) == 1
    assert result.assignments[0].provider_id == low_debt_provider.id


def test_solver_prefers_provider_with_matching_center_preference() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    preferred_provider = create_provider(center_id, room_type_id)
    neutral_provider = create_provider(center_id, room_type_id)
    center_preference = SolverProviderCenterPreference(
        center_id=center_id,
        preference_level=3,
    )
    preferred_provider.center_preferences = [center_preference]
    preferred_credential = create_credential(preferred_provider.id, center_id)
    neutral_credential = create_credential(neutral_provider.id, center_id)
    shift = create_shift(center_id, room.id, 7, 15)
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[preferred_provider, neutral_provider],
        center_credentials=[preferred_credential, neutral_credential],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is True
    assert len(result.assignments) == 1
    assert result.assignments[0].provider_id == preferred_provider.id


def test_solver_prefers_provider_with_matching_shift_type_preference() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    preferred_provider = create_provider(center_id, room_type_id)
    neutral_provider = create_provider(center_id, room_type_id)
    shift_type_preference = SolverProviderShiftTypePreference(
        shift_type="first_half",
        preference_level=3,
    )
    preferred_provider.shift_type_preferences = [shift_type_preference]
    preferred_provider.week_availability.days[0].options = ["first_half"]
    neutral_provider.week_availability.days[0].options = ["first_half"]
    preferred_credential = create_credential(preferred_provider.id, center_id)
    neutral_credential = create_credential(neutral_provider.id, center_id)
    shift = create_shift(center_id, room.id, 7, 11, shift_type="first_half")
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[preferred_provider, neutral_provider],
        center_credentials=[preferred_credential, neutral_credential],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is True
    assert len(result.assignments) == 1
    assert result.assignments[0].provider_id == preferred_provider.id


def test_solver_allows_fairness_pressure_to_outweigh_preference() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    preferred_high_debt_provider = create_provider(center_id, room_type_id)
    neutral_low_debt_provider = create_provider(center_id, room_type_id)
    center_preference = SolverProviderCenterPreference(
        center_id=center_id,
        preference_level=3,
    )
    preferred_high_debt_provider.center_preferences = [center_preference]
    preferred_high_debt_provider.fairness_debt = 2.0
    preferred_high_debt_provider.favor_credit = 0.0
    neutral_low_debt_provider.fairness_debt = 0.0
    neutral_low_debt_provider.favor_credit = 0.0
    preferred_credential = create_credential(preferred_high_debt_provider.id, center_id)
    neutral_credential = create_credential(neutral_low_debt_provider.id, center_id)
    shift = create_shift(center_id, room.id, 7, 15)
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[preferred_high_debt_provider, neutral_low_debt_provider],
        center_credentials=[preferred_credential, neutral_credential],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is True
    assert len(result.assignments) == 1
    assert result.assignments[0].provider_id == neutral_low_debt_provider.id


def test_solver_uses_manager_hidden_center_preference() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    preferred_provider = create_provider(center_id, room_type_id)
    neutral_provider = create_provider(center_id, room_type_id)
    manager_preference = SolverManagerCenterPreference(
        center_id=center_id,
        preference_level=3,
    )
    preferred_provider.manager_center_preferences = [manager_preference]
    preferred_credential = create_credential(preferred_provider.id, center_id)
    neutral_credential = create_credential(neutral_provider.id, center_id)
    shift = create_shift(center_id, room.id, 7, 15)
    solver_input = SolverInput(
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        rooms=[room],
        providers=[preferred_provider, neutral_provider],
        center_credentials=[preferred_credential, neutral_credential],
        shift_requirements=[shift],
    )

    result = solve_schedule(solver_input)

    assert result.is_feasible is True
    assert len(result.assignments) == 1
    assert result.assignments[0].provider_id == preferred_provider.id
