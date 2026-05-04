from datetime import UTC
from datetime import date
from datetime import datetime
from uuid import uuid4

from app.db.models import Assignment
from app.db.models import FairnessConfigVersion
from app.db.models import Provider
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import ScheduleVersion
from app.services.scheduling.fairness import ProviderFairnessInputs
from app.services.scheduling.fairness import ProviderFairnessLedgerState
from app.services.scheduling.fairness import fairness_events_for_provider
from app.services.scheduling.fairness import fairness_metrics
from app.services.scheduling.fairness import fairness_snapshot_for_provider
from app.services.scheduling.fairness import ledger_states_from_snapshots


def create_provider(display_name: str) -> Provider:
    provider = Provider(
        id=uuid4(),
        organization_id=uuid4(),
        first_name=display_name,
        last_name="Provider",
        display_name=display_name,
        email=None,
        phone=None,
        provider_type="doctor",
        employment_type="employee",
        is_active=True,
        notes=None,
    )
    return provider


def create_assignment(provider: Provider) -> Assignment:
    assignment = Assignment(
        id=uuid4(),
        room_slot_id=uuid4(),
        organization_id=provider.organization_id,
        schedule_version_id=uuid4(),
        schedule_period_id=uuid4(),
        provider_id=provider.id,
        center_id=uuid4(),
        room_id=uuid4(),
        shift_requirement_id=uuid4(),
        required_provider_type="doctor",
        shift_type="full_shift",
        schedule_date=date(2026, 5, 4),
        start_time=datetime(2026, 5, 4, 7, 0, tzinfo=UTC),
        end_time=datetime(2026, 5, 4, 15, 0, tzinfo=UTC),
        assignment_status="draft",
        source="solver",
        notes=None,
    )
    return assignment


def create_schedule_version(organization_id) -> ScheduleVersion:
    schedule_version = ScheduleVersion(
        id=uuid4(),
        organization_id=organization_id,
        schedule_period_id=uuid4(),
        schedule_job_id=None,
        version_number=1,
        status="draft",
        source="solver",
        parent_schedule_version_id=None,
        published_at=None,
        published_by_user_id=None,
        created_by_user_id=None,
        solver_score=None,
        notes=None,
    )
    return schedule_version


def create_config(organization_id) -> FairnessConfigVersion:
    config = FairnessConfigVersion(
        id=uuid4(),
        organization_id=organization_id,
        version_number=1,
        status="active",
        decay_factor=0.95,
        debt_weight=1.0,
        favor_weight=1.0,
        standard_priority_multiplier=1.0,
        elevated_priority_multiplier=1.25,
        critical_priority_multiplier=1.5,
    )
    return config


def create_weekly_availability(provider: Provider) -> ProviderScheduleWeekAvailability:
    weekly_availability = ProviderScheduleWeekAvailability(
        id=uuid4(),
        organization_id=provider.organization_id,
        schedule_week_id=uuid4(),
        provider_id=provider.id,
        weekday="monday",
        availability_options=["full_shift"],
        min_shifts_requested=2,
        max_shifts_requested=1,
    )
    return weekly_availability


def test_requested_assignment_does_not_create_fairness_debt_event() -> None:
    provider = create_provider("Avery")
    assignment = create_assignment(provider)
    schedule_version = create_schedule_version(provider.organization_id)
    weekly_availability = create_weekly_availability(provider)
    weekly_availability.min_shifts_requested = 0
    weekly_availability.max_shifts_requested = 2
    provider_inputs = ProviderFairnessInputs(
        provider=provider,
        state=None,
        weekly_availability=weekly_availability,
        assignment_count=1,
        average_assignment_count=1.0,
    )

    events = fairness_events_for_provider(
        provider_inputs,
        [assignment],
        schedule_version,
        provider.organization_id,
    )

    assert events == []


def test_fairness_events_use_shift_request_debt_events() -> None:
    provider = create_provider("Avery")
    assignment = create_assignment(provider)
    schedule_version = create_schedule_version(provider.organization_id)
    weekly_availability = create_weekly_availability(provider)
    weekly_availability.min_shifts_requested = 0
    weekly_availability.max_shifts_requested = 1
    provider_inputs = ProviderFairnessInputs(
        provider=provider,
        state=None,
        weekly_availability=weekly_availability,
        assignment_count=2,
        average_assignment_count=2.0,
    )

    events = fairness_events_for_provider(
        provider_inputs,
        [assignment, assignment],
        schedule_version,
        provider.organization_id,
    )

    event_types = [
        event.event_type
        for event in events
    ]

    assert event_types == [
        "above_maximum_shift_request",
    ]


def test_fairness_events_credit_full_shift_availability_accommodation() -> None:
    provider = create_provider("Arden")
    assignment = create_assignment(provider)
    assignment.shift_type = "first_half"
    schedule_version = create_schedule_version(provider.organization_id)
    weekly_availability = create_weekly_availability(provider)
    provider_inputs = ProviderFairnessInputs(
        provider=provider,
        state=None,
        weekly_availability=weekly_availability,
        assignment_count=1,
        average_assignment_count=1.0,
        weekly_availability_rows=[weekly_availability],
    )

    events = fairness_events_for_provider(
        provider_inputs,
        [assignment],
        schedule_version,
        provider.organization_id,
    )

    accommodation_events = [
        event
        for event in events
        if event.event_type == "full_shift_availability_accommodation"
    ]

    assert len(accommodation_events) == 1
    assert accommodation_events[0].debt_delta == 1.0
    assert accommodation_events[0].assignment_id == assignment.id


def test_fairness_snapshot_applies_decay_and_pressure() -> None:
    provider = create_provider("Blake")
    assignment = create_assignment(provider)
    schedule_version = create_schedule_version(provider.organization_id)
    weekly_availability = create_weekly_availability(provider)
    config = create_config(provider.organization_id)
    provider_inputs = ProviderFairnessInputs(
        provider=provider,
        state=None,
        weekly_availability=weekly_availability,
        assignment_count=1,
        average_assignment_count=1.0,
    )
    events = fairness_events_for_provider(
        provider_inputs,
        [assignment],
        schedule_version,
        provider.organization_id,
    )

    snapshot = fairness_snapshot_for_provider(
        provider_inputs,
        events,
        schedule_version,
        provider.organization_id,
        config,
    )

    assert snapshot.ending_debt == 2.0
    assert snapshot.ending_favor_credit == 0.0
    assert snapshot.fairness_pressure == 2.0
    assert snapshot.negative_event_count == 1


def test_fairness_snapshot_can_start_from_ledger_state() -> None:
    provider = create_provider("Briar")
    assignment = create_assignment(provider)
    schedule_version = create_schedule_version(provider.organization_id)
    weekly_availability = create_weekly_availability(provider)
    config = create_config(provider.organization_id)
    ledger_state = ProviderFairnessLedgerState(
        provider_id=provider.id,
        config_version_id=config.id,
        fairness_debt=4.0,
        favor_credit=1.0,
        priority_tier="standard",
        priority_multiplier=1.0,
    )
    provider_inputs = ProviderFairnessInputs(
        provider=provider,
        state=ledger_state,
        weekly_availability=weekly_availability,
        assignment_count=1,
        average_assignment_count=1.0,
    )
    events = fairness_events_for_provider(
        provider_inputs,
        [assignment],
        schedule_version,
        provider.organization_id,
    )

    snapshot = fairness_snapshot_for_provider(
        provider_inputs,
        events,
        schedule_version,
        provider.organization_id,
        config,
    )

    assert snapshot.starting_debt == 4.0
    assert snapshot.starting_favor_credit == 1.0
    assert snapshot.ending_debt == 5.8
    assert snapshot.ending_favor_credit == 0.95


def test_replacement_period_fairness_uses_rebuilt_ledger_state() -> None:
    provider = create_provider("Brooke")
    assignment = create_assignment(provider)
    assignment.shift_type = "first_half"
    schedule_period_id = uuid4()
    first_version = create_schedule_version(provider.organization_id)
    first_version.schedule_period_id = schedule_period_id
    second_version = create_schedule_version(provider.organization_id)
    second_version.schedule_period_id = schedule_period_id
    config = create_config(provider.organization_id)
    weekly_availability = create_weekly_availability(provider)
    weekly_availability.min_shifts_requested = 0
    weekly_availability.max_shifts_requested = 2
    first_inputs = ProviderFairnessInputs(
        provider=provider,
        state=None,
        weekly_availability=weekly_availability,
        assignment_count=1,
        average_assignment_count=1.0,
    )
    first_events = fairness_events_for_provider(
        first_inputs,
        [assignment],
        first_version,
        provider.organization_id,
    )
    first_snapshot = fairness_snapshot_for_provider(
        first_inputs,
        first_events,
        first_version,
        provider.organization_id,
        config,
    )
    inflated_ledger_states = ledger_states_from_snapshots(
        [first_snapshot],
        first_version,
    )
    inflated_state = inflated_ledger_states[0]
    inflated_inputs = ProviderFairnessInputs(
        provider=provider,
        state=inflated_state,
        weekly_availability=weekly_availability,
        assignment_count=1,
        average_assignment_count=1.0,
    )
    rebuilt_inputs = ProviderFairnessInputs(
        provider=provider,
        state=None,
        weekly_availability=weekly_availability,
        assignment_count=1,
        average_assignment_count=1.0,
    )
    inflated_events = fairness_events_for_provider(
        inflated_inputs,
        [assignment],
        second_version,
        provider.organization_id,
    )
    rebuilt_events = fairness_events_for_provider(
        rebuilt_inputs,
        [assignment],
        second_version,
        provider.organization_id,
    )

    inflated_snapshot = fairness_snapshot_for_provider(
        inflated_inputs,
        inflated_events,
        second_version,
        provider.organization_id,
        config,
    )
    rebuilt_snapshot = fairness_snapshot_for_provider(
        rebuilt_inputs,
        rebuilt_events,
        second_version,
        provider.organization_id,
        config,
    )

    assert inflated_snapshot.ending_debt == 1.95
    assert rebuilt_snapshot.ending_debt == 1.0


def test_fairness_metrics_flag_repeat_hits() -> None:
    provider = create_provider("Casey")
    assignment = create_assignment(provider)
    assignment.shift_type = "first_half"
    schedule_version = create_schedule_version(provider.organization_id)
    weekly_availability = create_weekly_availability(provider)
    config = create_config(provider.organization_id)
    provider_inputs = ProviderFairnessInputs(
        provider=provider,
        state=None,
        weekly_availability=weekly_availability,
        assignment_count=1,
        average_assignment_count=1.0,
    )
    events = fairness_events_for_provider(
        provider_inputs,
        [assignment],
        schedule_version,
        provider.organization_id,
    )
    snapshot = fairness_snapshot_for_provider(
        provider_inputs,
        events,
        schedule_version,
        provider.organization_id,
        config,
    )

    metrics = fairness_metrics([snapshot])

    repeat_metric = metrics[1]
    assert repeat_metric.id == "repeat-hits"
    assert repeat_metric.value == "1"
    assert repeat_metric.status == "Watch"
