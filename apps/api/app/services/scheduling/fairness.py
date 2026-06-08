from dataclasses import dataclass
from dataclasses import field
from uuid import UUID

from sqlalchemy import delete as sqlalchemy_delete
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Assignment
from app.db.models import FairnessConfigVersion
from app.db.models import Provider
from app.db.models import ProviderFairnessEvent
from app.db.models import ProviderFairnessSnapshot
from app.db.models import ProviderFairnessState
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import SchedulePeriod
from app.db.models import ScheduleVersion
from app.db.models.scheduling import current_utc_time
from app.schemas.fairness import FairnessMetricRead
from app.schemas.fairness import FairnessConfigVersionRead
from app.schemas.fairness import FairnessReportRead
from app.schemas.fairness import ProviderFairnessEventRead
from app.schemas.fairness import ProviderFairnessSnapshotRead
from app.schemas.schedule import SchedulePeriodRead
from app.schemas.schedule import ScheduleVersionRead
from app.services.scheduling.provider_eligibility import full_shift_availability_accommodates_shift_type
from app.services.scheduling.shift_request_units import shift_request_units_for_shift_type

DEFAULT_DECAY_FACTOR = 0.95
DEFAULT_DEBT_WEIGHT = 1.0
DEFAULT_FAVOR_WEIGHT = 1.0
DEFAULT_STANDARD_PRIORITY_MULTIPLIER = 1.0
DEFAULT_ELEVATED_PRIORITY_MULTIPLIER = 1.25
DEFAULT_CRITICAL_PRIORITY_MULTIPLIER = 1.5
BELOW_MINIMUM_SHIFT_DEBT = 2.0
ABOVE_MAXIMUM_SHIFT_DEBT = 3.0
FULL_SHIFT_ACCOMMODATION_DEBT = 1.0
UNDER_AVERAGE_FAVOR_CREDIT = 1.0
WEEKDAY_VALUES = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]


@dataclass
class ProviderFairnessLedgerState:
    provider_id: UUID
    config_version_id: UUID | None
    fairness_debt: float
    favor_credit: float
    priority_tier: str
    priority_multiplier: float
    last_applied_schedule_period_id: UUID | None = None
    last_applied_schedule_version_id: UUID | None = None


FairnessStateSource = ProviderFairnessState | ProviderFairnessLedgerState


@dataclass
class ProviderFairnessInputs:
    provider: Provider
    state: FairnessStateSource | None
    weekly_availability: ProviderScheduleWeekAvailability | None
    assignment_count: int
    average_assignment_count: float
    weekly_availability_rows: list[ProviderScheduleWeekAvailability] = field(default_factory=list)


@dataclass
class FairnessTotals:
    debt_delta: float
    favor_delta: float
    negative_event_count: int
    positive_event_count: int


def numeric_value(value: object) -> float:
    number = float(value)
    return number


def active_fairness_config(
    organization_id: UUID,
    session: Session,
) -> FairnessConfigVersion:
    statement = select(FairnessConfigVersion)
    statement = statement.where(FairnessConfigVersion.organization_id == organization_id)
    statement = statement.where(FairnessConfigVersion.status == "active")
    statement = statement.order_by(FairnessConfigVersion.version_number.desc())
    config = session.scalar(statement)

    if config is not None:
        return config

    new_config = FairnessConfigVersion(
        organization_id=organization_id,
        version_number=1,
        status="active",
        decay_factor=DEFAULT_DECAY_FACTOR,
        debt_weight=DEFAULT_DEBT_WEIGHT,
        favor_weight=DEFAULT_FAVOR_WEIGHT,
        standard_priority_multiplier=DEFAULT_STANDARD_PRIORITY_MULTIPLIER,
        elevated_priority_multiplier=DEFAULT_ELEVATED_PRIORITY_MULTIPLIER,
        critical_priority_multiplier=DEFAULT_CRITICAL_PRIORITY_MULTIPLIER,
    )
    session.add(new_config)
    session.flush()
    return new_config


def provider_fairness_state(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> ProviderFairnessState | None:
    statement = select(ProviderFairnessState)
    statement = statement.where(ProviderFairnessState.organization_id == organization_id)
    statement = statement.where(ProviderFairnessState.provider_id == provider_id)
    state = session.scalar(statement)
    return state


def priority_multiplier_for_tier(
    priority_tier: str,
    config: FairnessConfigVersion,
) -> float:
    if priority_tier == "critical":
        multiplier = numeric_value(config.critical_priority_multiplier)
        return multiplier

    if priority_tier == "elevated":
        multiplier = numeric_value(config.elevated_priority_multiplier)
        return multiplier

    multiplier = numeric_value(config.standard_priority_multiplier)
    return multiplier


def provider_priority_tier(state: FairnessStateSource | None) -> str:
    if state is None:
        return "standard"

    priority_tier = state.priority_tier
    return priority_tier


def provider_starting_debt(state: FairnessStateSource | None) -> float:
    if state is None:
        return 0.0

    starting_debt = numeric_value(state.fairness_debt)
    return starting_debt


def provider_starting_favor_credit(state: FairnessStateSource | None) -> float:
    if state is None:
        return 0.0

    starting_favor_credit = numeric_value(state.favor_credit)
    return starting_favor_credit


def ledger_state_for_provider(
    provider_id: UUID,
    ledger_states: list[ProviderFairnessLedgerState],
) -> ProviderFairnessLedgerState | None:
    for ledger_state in ledger_states:
        provider_matches = ledger_state.provider_id == provider_id

        if provider_matches:
            return ledger_state

    return None


def providers_for_fairness(
    organization_id: UUID,
    session: Session,
) -> list[Provider]:
    statement = select(Provider)
    statement = statement.where(Provider.organization_id == organization_id)
    statement = statement.where(Provider.is_active.is_(True))
    statement = statement.order_by(Provider.display_name, Provider.id)
    providers = list(session.scalars(statement))
    return providers


def all_providers_for_organization(
    organization_id: UUID,
    session: Session,
) -> list[Provider]:
    statement = select(Provider)
    statement = statement.where(Provider.organization_id == organization_id)
    statement = statement.order_by(Provider.display_name, Provider.id)
    providers = list(session.scalars(statement))
    return providers


def weekly_availability_for_provider(
    provider_id: UUID,
    schedule_period_id: UUID,
    organization_id: UUID,
    session: Session,
) -> ProviderScheduleWeekAvailability | None:
    statement = select(ProviderScheduleWeekAvailability)
    statement = statement.where(ProviderScheduleWeekAvailability.organization_id == organization_id)
    statement = statement.where(ProviderScheduleWeekAvailability.schedule_week_id == schedule_period_id)
    statement = statement.where(ProviderScheduleWeekAvailability.provider_id == provider_id)
    statement = statement.order_by(ProviderScheduleWeekAvailability.weekday)
    weekly_availability = session.scalar(statement)
    return weekly_availability


def weekly_availability_rows_for_provider(
    provider_id: UUID,
    schedule_period_id: UUID,
    organization_id: UUID,
    session: Session,
) -> list[ProviderScheduleWeekAvailability]:
    statement = select(ProviderScheduleWeekAvailability)
    statement = statement.where(ProviderScheduleWeekAvailability.organization_id == organization_id)
    statement = statement.where(ProviderScheduleWeekAvailability.schedule_week_id == schedule_period_id)
    statement = statement.where(ProviderScheduleWeekAvailability.provider_id == provider_id)
    statement = statement.order_by(ProviderScheduleWeekAvailability.weekday)
    weekly_availability_rows = list(session.scalars(statement))
    return weekly_availability_rows


def weekday_for_assignment(assignment: Assignment) -> str:
    weekday_index = assignment.start_time.weekday()
    weekday = WEEKDAY_VALUES[weekday_index]
    return weekday


def availability_for_assignment(
    provider_inputs: ProviderFairnessInputs,
    assignment: Assignment,
) -> ProviderScheduleWeekAvailability | None:
    assignment_weekday = weekday_for_assignment(assignment)

    for availability in provider_inputs.weekly_availability_rows:
        weekday_matches = availability.weekday == assignment_weekday

        if weekday_matches:
            return availability

    weekly_availability = provider_inputs.weekly_availability

    if weekly_availability is None:
        return None

    weekday_matches = weekly_availability.weekday == assignment_weekday

    if weekday_matches:
        return weekly_availability

    return None


def assignment_count_for_provider(
    provider_id: UUID,
    assignments: list[Assignment],
) -> int:
    assignment_count = 0

    for assignment in assignments:
        provider_matches = assignment.provider_id == provider_id

        if not provider_matches:
            continue

        assignment_count = assignment_count + 1

    return assignment_count


def assignment_units_for_provider(
    provider_id: UUID,
    assignments: list[Assignment],
) -> int:
    assignment_units = 0

    for assignment in assignments:
        provider_matches = assignment.provider_id == provider_id

        if not provider_matches:
            continue

        shift_units = shift_request_units_for_shift_type(assignment.shift_type)
        assignment_units = assignment_units + shift_units

    return assignment_units


def average_assignment_count(
    assignments: list[Assignment],
    providers: list[Provider],
) -> float:
    provider_count = len(providers)

    if provider_count == 0:
        return 0.0

    assigned_count = 0

    for assignment in assignments:
        has_provider = assignment.provider_id is not None

        if not has_provider:
            continue

        assigned_count = assigned_count + 1

    average_count = assigned_count / provider_count
    return average_count


def create_fairness_event(
    provider_inputs: ProviderFairnessInputs,
    schedule_version: ScheduleVersion,
    organization_id: UUID,
    event_type: str,
    category: str,
    debt_delta: float,
    favor_delta: float,
    reason: str,
    assignment_id: UUID | None = None,
) -> ProviderFairnessEvent:
    event = ProviderFairnessEvent(
        organization_id=organization_id,
        provider_id=provider_inputs.provider.id,
        schedule_period_id=schedule_version.schedule_period_id,
        schedule_version_id=schedule_version.id,
        assignment_id=assignment_id,
        event_type=event_type,
        category=category,
        debt_delta=debt_delta,
        favor_delta=favor_delta,
        occurred_at=current_utc_time(),
        reason=reason,
    )
    return event


def full_shift_accommodation_events(
    provider_inputs: ProviderFairnessInputs,
    assignments: list[Assignment],
    schedule_version: ScheduleVersion,
    organization_id: UUID,
) -> list[ProviderFairnessEvent]:
    events: list[ProviderFairnessEvent] = []

    for assignment in assignments:
        provider_matches = assignment.provider_id == provider_inputs.provider.id

        if not provider_matches:
            continue

        availability = availability_for_assignment(provider_inputs, assignment)

        if availability is None:
            continue

        uses_full_shift_accommodation = full_shift_availability_accommodates_shift_type(
            assignment.shift_type,
            availability.availability_options,
        )

        if not uses_full_shift_accommodation:
            continue

        event = create_fairness_event(
            provider_inputs,
            schedule_version,
            organization_id,
            "full_shift_availability_accommodation",
            "workload",
            FULL_SHIFT_ACCOMMODATION_DEBT,
            0.0,
            "Provider accommodated a shorter shift after offering full-day availability.",
            assignment.id,
        )
        events.append(event)

    return events


def below_minimum_event(
    provider_inputs: ProviderFairnessInputs,
    schedule_version: ScheduleVersion,
    organization_id: UUID,
    assignment_units: int,
) -> ProviderFairnessEvent | None:
    weekly_availability = provider_inputs.weekly_availability

    if weekly_availability is None:
        return None

    minimum_requested_units = weekly_availability.min_shifts_requested_units
    shortfall_units = minimum_requested_units - assignment_units

    if shortfall_units <= 0:
        return None

    shortfall_shifts = shortfall_units / 2
    debt_delta = shortfall_shifts * BELOW_MINIMUM_SHIFT_DEBT
    reason = "Provider was assigned fewer shifts than their weekly minimum request."
    event = create_fairness_event(
        provider_inputs,
        schedule_version,
        organization_id,
        "below_minimum_shift_request",
        "preference",
        debt_delta,
        0.0,
        reason,
    )
    return event


def above_maximum_event(
    provider_inputs: ProviderFairnessInputs,
    schedule_version: ScheduleVersion,
    organization_id: UUID,
    assignment_units: int,
) -> ProviderFairnessEvent | None:
    weekly_availability = provider_inputs.weekly_availability

    if weekly_availability is None:
        return None

    maximum_requested_units = weekly_availability.max_shifts_requested_units

    if maximum_requested_units <= 0:
        return None

    excess_units = assignment_units - maximum_requested_units

    if excess_units <= 0:
        return None

    excess_shifts = excess_units / 2
    debt_delta = excess_shifts * ABOVE_MAXIMUM_SHIFT_DEBT
    reason = "Provider was assigned more shifts than their weekly maximum request."
    event = create_fairness_event(
        provider_inputs,
        schedule_version,
        organization_id,
        "above_maximum_shift_request",
        "workload",
        debt_delta,
        0.0,
        reason,
    )
    return event


def under_average_event(
    provider_inputs: ProviderFairnessInputs,
    schedule_version: ScheduleVersion,
    organization_id: UUID,
) -> ProviderFairnessEvent | None:
    average_count = provider_inputs.average_assignment_count
    assignment_count = provider_inputs.assignment_count
    under_average_amount = average_count - assignment_count

    if under_average_amount < 1:
        return None

    favor_delta = under_average_amount * UNDER_AVERAGE_FAVOR_CREDIT
    reason = "Provider received lighter workload than the active-provider average."
    event = create_fairness_event(
        provider_inputs,
        schedule_version,
        organization_id,
        "under_average_workload",
        "workload",
        0.0,
        favor_delta,
        reason,
    )
    return event


def fairness_events_for_provider(
    provider_inputs: ProviderFairnessInputs,
    assignments: list[Assignment],
    schedule_version: ScheduleVersion,
    organization_id: UUID,
) -> list[ProviderFairnessEvent]:
    events: list[ProviderFairnessEvent] = []
    accommodation_events = full_shift_accommodation_events(
        provider_inputs,
        assignments,
        schedule_version,
        organization_id,
    )
    events.extend(accommodation_events)
    assignment_units = assignment_units_for_provider(
        provider_inputs.provider.id,
        assignments,
    )
    below_minimum = below_minimum_event(
        provider_inputs,
        schedule_version,
        organization_id,
        assignment_units,
    )

    if below_minimum is not None:
        events.append(below_minimum)

    above_maximum = above_maximum_event(
        provider_inputs,
        schedule_version,
        organization_id,
        assignment_units,
    )

    if above_maximum is not None:
        events.append(above_maximum)

    under_average = under_average_event(
        provider_inputs,
        schedule_version,
        organization_id,
    )

    if under_average is not None:
        events.append(under_average)

    return events


def fairness_totals(events: list[ProviderFairnessEvent]) -> FairnessTotals:
    debt_delta = 0.0
    favor_delta = 0.0
    negative_event_count = 0
    positive_event_count = 0

    for event in events:
        event_debt_delta = numeric_value(event.debt_delta)
        event_favor_delta = numeric_value(event.favor_delta)
        debt_delta = debt_delta + event_debt_delta
        favor_delta = favor_delta + event_favor_delta

        if event_debt_delta > 0:
            negative_event_count = negative_event_count + 1

        if event_favor_delta > 0:
            positive_event_count = positive_event_count + 1

    totals = FairnessTotals(
        debt_delta=debt_delta,
        favor_delta=favor_delta,
        negative_event_count=negative_event_count,
        positive_event_count=positive_event_count,
    )
    return totals


def fairness_pressure(
    ending_debt: float,
    ending_favor_credit: float,
    priority_multiplier: float,
    config: FairnessConfigVersion,
) -> float:
    weighted_debt = ending_debt * numeric_value(config.debt_weight)
    weighted_favor = ending_favor_credit * numeric_value(config.favor_weight)
    pressure_without_tier = weighted_debt - weighted_favor
    pressure = pressure_without_tier * priority_multiplier
    return pressure


def fairness_snapshot_for_provider(
    provider_inputs: ProviderFairnessInputs,
    events: list[ProviderFairnessEvent],
    schedule_version: ScheduleVersion,
    organization_id: UUID,
    config: FairnessConfigVersion,
) -> ProviderFairnessSnapshot:
    state = provider_inputs.state
    starting_debt = provider_starting_debt(state)
    starting_favor_credit = provider_starting_favor_credit(state)
    totals = fairness_totals(events)
    decay_factor = numeric_value(config.decay_factor)
    ending_debt = starting_debt * decay_factor + totals.debt_delta
    ending_favor_credit = starting_favor_credit * decay_factor + totals.favor_delta
    priority_tier = provider_priority_tier(state)
    priority_multiplier = priority_multiplier_for_tier(priority_tier, config)
    pressure = fairness_pressure(
        ending_debt,
        ending_favor_credit,
        priority_multiplier,
        config,
    )
    snapshot = ProviderFairnessSnapshot(
        organization_id=organization_id,
        provider_id=provider_inputs.provider.id,
        schedule_period_id=schedule_version.schedule_period_id,
        schedule_version_id=schedule_version.id,
        config_version_id=config.id,
        starting_debt=starting_debt,
        starting_favor_credit=starting_favor_credit,
        weekly_debt_delta=totals.debt_delta,
        weekly_favor_delta=totals.favor_delta,
        ending_debt=ending_debt,
        ending_favor_credit=ending_favor_credit,
        fairness_pressure=pressure,
        priority_tier=priority_tier,
        priority_multiplier=priority_multiplier,
        assignment_count=provider_inputs.assignment_count,
        negative_event_count=totals.negative_event_count,
        positive_event_count=totals.positive_event_count,
    )
    return snapshot


def delete_existing_fairness_records(
    schedule_version_id: UUID,
    organization_id: UUID,
    session: Session,
) -> None:
    event_statement = sqlalchemy_delete(ProviderFairnessEvent)
    event_statement = event_statement.where(ProviderFairnessEvent.organization_id == organization_id)
    event_statement = event_statement.where(ProviderFairnessEvent.schedule_version_id == schedule_version_id)
    session.execute(event_statement)
    snapshot_statement = sqlalchemy_delete(ProviderFairnessSnapshot)
    snapshot_statement = snapshot_statement.where(ProviderFairnessSnapshot.organization_id == organization_id)
    snapshot_statement = snapshot_statement.where(ProviderFairnessSnapshot.schedule_version_id == schedule_version_id)
    session.execute(snapshot_statement)


def starting_state_for_provider(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
    ledger_states: list[ProviderFairnessLedgerState] | None,
) -> FairnessStateSource | None:
    has_ledger_states = ledger_states is not None

    if has_ledger_states:
        ledger_state = ledger_state_for_provider(provider_id, ledger_states)
        return ledger_state

    persisted_state = provider_fairness_state(provider_id, organization_id, session)
    return persisted_state


def record_fairness_for_schedule_version(
    schedule_version: ScheduleVersion,
    assignments: list[Assignment],
    organization_id: UUID,
    session: Session,
    ledger_states: list[ProviderFairnessLedgerState] | None = None,
) -> list[ProviderFairnessSnapshot]:
    config = active_fairness_config(organization_id, session)
    providers = providers_for_fairness(organization_id, session)
    average_count = average_assignment_count(assignments, providers)
    snapshots: list[ProviderFairnessSnapshot] = []
    delete_existing_fairness_records(
        schedule_version.id,
        organization_id,
        session,
    )

    for provider in providers:
        state = starting_state_for_provider(
            provider.id,
            organization_id,
            session,
            ledger_states,
        )
        weekly_availability = weekly_availability_for_provider(
            provider.id,
            schedule_version.schedule_period_id,
            organization_id,
            session,
        )
        weekly_availability_rows = weekly_availability_rows_for_provider(
            provider.id,
            schedule_version.schedule_period_id,
            organization_id,
            session,
        )
        assignment_count = assignment_count_for_provider(provider.id, assignments)
        provider_inputs = ProviderFairnessInputs(
            provider=provider,
            state=state,
            weekly_availability=weekly_availability,
            assignment_count=assignment_count,
            average_assignment_count=average_count,
            weekly_availability_rows=weekly_availability_rows,
        )
        events = fairness_events_for_provider(
            provider_inputs,
            assignments,
            schedule_version,
            organization_id,
        )

        for event in events:
            session.add(event)

        snapshot = fairness_snapshot_for_provider(
            provider_inputs,
            events,
            schedule_version,
            organization_id,
            config,
        )
        session.add(snapshot)
        snapshots.append(snapshot)

    session.flush()
    return snapshots


def ledger_state_from_snapshot(
    snapshot: ProviderFairnessSnapshot,
    schedule_version: ScheduleVersion,
) -> ProviderFairnessLedgerState:
    ledger_state = ProviderFairnessLedgerState(
        provider_id=snapshot.provider_id,
        config_version_id=snapshot.config_version_id,
        fairness_debt=numeric_value(snapshot.ending_debt),
        favor_credit=numeric_value(snapshot.ending_favor_credit),
        priority_tier=snapshot.priority_tier,
        priority_multiplier=numeric_value(snapshot.priority_multiplier),
        last_applied_schedule_period_id=schedule_version.schedule_period_id,
        last_applied_schedule_version_id=schedule_version.id,
    )
    return ledger_state


def ledger_states_from_snapshots(
    snapshots: list[ProviderFairnessSnapshot],
    schedule_version: ScheduleVersion,
) -> list[ProviderFairnessLedgerState]:
    ledger_states = [
        ledger_state_from_snapshot(snapshot, schedule_version)
        for snapshot in snapshots
    ]
    return ledger_states


def write_provider_fairness_ledger_states(
    ledger_states: list[ProviderFairnessLedgerState],
    organization_id: UUID,
    session: Session,
) -> None:
    for ledger_state in ledger_states:
        state = provider_fairness_state(
            ledger_state.provider_id,
            organization_id,
            session,
        )

        if state is None:
            state = ProviderFairnessState(
                organization_id=organization_id,
                provider_id=ledger_state.provider_id,
                config_version_id=ledger_state.config_version_id,
                fairness_debt=ledger_state.fairness_debt,
                favor_credit=ledger_state.favor_credit,
                priority_tier=ledger_state.priority_tier,
                priority_multiplier=ledger_state.priority_multiplier,
                last_applied_schedule_period_id=ledger_state.last_applied_schedule_period_id,
                last_applied_schedule_version_id=ledger_state.last_applied_schedule_version_id,
            )
            session.add(state)
            continue

        state.config_version_id = ledger_state.config_version_id
        state.fairness_debt = ledger_state.fairness_debt
        state.favor_credit = ledger_state.favor_credit
        state.priority_tier = ledger_state.priority_tier
        state.priority_multiplier = ledger_state.priority_multiplier
        state.last_applied_schedule_period_id = ledger_state.last_applied_schedule_period_id
        state.last_applied_schedule_version_id = ledger_state.last_applied_schedule_version_id

    session.flush()


def apply_fairness_state_for_schedule_version(
    schedule_version: ScheduleVersion,
    organization_id: UUID,
    session: Session,
) -> None:
    statement = select(ProviderFairnessSnapshot)
    statement = statement.where(ProviderFairnessSnapshot.organization_id == organization_id)
    statement = statement.where(ProviderFairnessSnapshot.schedule_version_id == schedule_version.id)
    snapshots = list(session.scalars(statement))

    for snapshot in snapshots:
        state = provider_fairness_state(snapshot.provider_id, organization_id, session)

        if state is None:
            state = ProviderFairnessState(
                organization_id=organization_id,
                provider_id=snapshot.provider_id,
                config_version_id=snapshot.config_version_id,
                fairness_debt=snapshot.ending_debt,
                favor_credit=snapshot.ending_favor_credit,
                priority_tier=snapshot.priority_tier,
                priority_multiplier=snapshot.priority_multiplier,
                last_applied_schedule_period_id=schedule_version.schedule_period_id,
                last_applied_schedule_version_id=schedule_version.id,
            )
            session.add(state)
            continue

        state.config_version_id = snapshot.config_version_id
        state.fairness_debt = snapshot.ending_debt
        state.favor_credit = snapshot.ending_favor_credit
        state.priority_multiplier = snapshot.priority_multiplier
        state.last_applied_schedule_period_id = schedule_version.schedule_period_id
        state.last_applied_schedule_version_id = schedule_version.id

    session.flush()


def assignments_for_fairness_version(
    schedule_version: ScheduleVersion,
    organization_id: UUID,
    session: Session,
) -> list[Assignment]:
    statement = select(Assignment)
    statement = statement.where(Assignment.organization_id == organization_id)
    statement = statement.where(Assignment.schedule_version_id == schedule_version.id)
    assignments = list(session.scalars(statement))
    return assignments


def published_schedule_versions_for_fairness(
    organization_id: UUID,
    session: Session,
) -> list[ScheduleVersion]:
    statement = select(ScheduleVersion)
    statement = statement.join(SchedulePeriod, SchedulePeriod.id == ScheduleVersion.schedule_period_id)
    statement = statement.where(ScheduleVersion.organization_id == organization_id)
    statement = statement.where(ScheduleVersion.status == "published")
    statement = statement.order_by(
        SchedulePeriod.start_date,
        SchedulePeriod.end_date,
        ScheduleVersion.created_at,
        ScheduleVersion.id,
    )
    schedule_versions = list(session.scalars(statement))
    return schedule_versions


def rebuild_published_fairness_state(
    organization_id: UUID,
    session: Session,
) -> None:
    schedule_versions = published_schedule_versions_for_fairness(
        organization_id,
        session,
    )
    ledger_states: list[ProviderFairnessLedgerState] = []

    for schedule_version in schedule_versions:
        assignments = assignments_for_fairness_version(
            schedule_version,
            organization_id,
            session,
        )
        snapshots = record_fairness_for_schedule_version(
            schedule_version,
            assignments,
            organization_id,
            session,
            ledger_states,
        )
        ledger_states = ledger_states_from_snapshots(
            snapshots,
            schedule_version,
        )

    write_provider_fairness_ledger_states(
        ledger_states,
        organization_id,
        session,
    )


def latest_schedule_version_with_fairness(
    organization_id: UUID,
    session: Session,
) -> ScheduleVersion | None:
    statement = select(ScheduleVersion)
    statement = statement.join(
        ProviderFairnessSnapshot,
        ProviderFairnessSnapshot.schedule_version_id == ScheduleVersion.id,
    )
    statement = statement.where(ScheduleVersion.organization_id == organization_id)
    statement = statement.order_by(ScheduleVersion.created_at.desc(), ScheduleVersion.id.desc())
    version = session.scalar(statement)
    return version


def schedule_period_for_version(
    schedule_version: ScheduleVersion,
    organization_id: UUID,
    session: Session,
) -> SchedulePeriod:
    statement = select(SchedulePeriod)
    statement = statement.where(SchedulePeriod.organization_id == organization_id)
    statement = statement.where(SchedulePeriod.id == schedule_version.schedule_period_id)
    schedule_period = session.scalar(statement)

    if schedule_period is None:
        raise ValueError("Schedule period not found for fairness report")

    return schedule_period


def provider_display_name(
    provider_id: UUID,
    providers: list[Provider],
) -> str:
    for provider in providers:
        provider_matches = provider.id == provider_id

        if provider_matches:
            return provider.display_name

    raise ValueError("Provider not found for fairness report")


def snapshots_for_report(
    schedule_version: ScheduleVersion,
    organization_id: UUID,
    session: Session,
) -> list[ProviderFairnessSnapshot]:
    statement = select(ProviderFairnessSnapshot)
    statement = statement.where(ProviderFairnessSnapshot.organization_id == organization_id)
    statement = statement.where(ProviderFairnessSnapshot.schedule_version_id == schedule_version.id)
    statement = statement.order_by(ProviderFairnessSnapshot.fairness_pressure.desc())
    snapshots = list(session.scalars(statement))
    return snapshots


def events_for_report(
    schedule_version: ScheduleVersion,
    organization_id: UUID,
    session: Session,
) -> list[ProviderFairnessEvent]:
    statement = select(ProviderFairnessEvent)
    statement = statement.where(ProviderFairnessEvent.organization_id == organization_id)
    statement = statement.where(ProviderFairnessEvent.schedule_version_id == schedule_version.id)
    statement = statement.order_by(ProviderFairnessEvent.occurred_at.desc(), ProviderFairnessEvent.id)
    events = list(session.scalars(statement))
    return events


def fairness_config_for_report(
    snapshots: list[ProviderFairnessSnapshot],
    organization_id: UUID,
    session: Session,
) -> FairnessConfigVersion | None:
    has_snapshots = len(snapshots) > 0

    if not has_snapshots:
        return None

    first_snapshot = snapshots[0]
    statement = select(FairnessConfigVersion)
    statement = statement.where(FairnessConfigVersion.organization_id == organization_id)
    statement = statement.where(FairnessConfigVersion.id == first_snapshot.config_version_id)
    config = session.scalar(statement)
    return config


def max_fairness_pressure(snapshots: list[ProviderFairnessSnapshot]) -> float:
    max_pressure = 0.0

    for snapshot in snapshots:
        pressure = numeric_value(snapshot.fairness_pressure)

        if pressure > max_pressure:
            max_pressure = pressure

    return max_pressure


def pressure_status(max_pressure: float) -> str:
    if max_pressure >= 8:
        return "Action Required"

    if max_pressure >= 4:
        return "Watch"

    return "Healthy"


def repeat_hit_count(snapshots: list[ProviderFairnessSnapshot]) -> int:
    count = 0

    for snapshot in snapshots:
        repeated_hits = snapshot.negative_event_count >= 2

        if repeated_hits:
            count = count + 1

    return count


def total_negative_events(snapshots: list[ProviderFairnessSnapshot]) -> int:
    count = 0

    for snapshot in snapshots:
        count = count + snapshot.negative_event_count

    return count


def total_positive_events(snapshots: list[ProviderFairnessSnapshot]) -> int:
    count = 0

    for snapshot in snapshots:
        count = count + snapshot.positive_event_count

    return count


def fairness_metrics(snapshots: list[ProviderFairnessSnapshot]) -> list[FairnessMetricRead]:
    max_pressure = max_fairness_pressure(snapshots)
    pressure_metric = FairnessMetricRead(
        id="max-pressure",
        label="Max Pressure",
        value=f"{max_pressure:.1f}",
        status=pressure_status(max_pressure),
        detail="Highest provider fairness pressure after decay and current schedule events.",
    )
    repeat_hits = repeat_hit_count(snapshots)
    repeat_status = "Healthy"

    if repeat_hits > 0:
        repeat_status = "Watch"

    repeat_metric = FairnessMetricRead(
        id="repeat-hits",
        label="Repeat Hits",
        value=str(repeat_hits),
        status=repeat_status,
        detail="Providers with two or more negative fairness events in this schedule version.",
    )
    negative_events = total_negative_events(snapshots)
    positive_events = total_positive_events(snapshots)
    event_value = f"{negative_events} / {positive_events}"
    event_metric = FairnessMetricRead(
        id="event-balance",
        label="Debt / Credit Events",
        value=event_value,
        status="Healthy",
        detail="Count of debt-generating events compared with favor-credit events.",
    )
    metrics = [
        pressure_metric,
        repeat_metric,
        event_metric,
    ]
    return metrics


def snapshot_read(
    snapshot: ProviderFairnessSnapshot,
    providers: list[Provider],
) -> ProviderFairnessSnapshotRead:
    display_name = provider_display_name(snapshot.provider_id, providers)
    snapshot_data = ProviderFairnessSnapshotRead(
        id=snapshot.id,
        created_at=snapshot.created_at,
        updated_at=snapshot.updated_at,
        provider_id=snapshot.provider_id,
        provider_display_name=display_name,
        schedule_period_id=snapshot.schedule_period_id,
        schedule_version_id=snapshot.schedule_version_id,
        starting_debt=numeric_value(snapshot.starting_debt),
        starting_favor_credit=numeric_value(snapshot.starting_favor_credit),
        weekly_debt_delta=numeric_value(snapshot.weekly_debt_delta),
        weekly_favor_delta=numeric_value(snapshot.weekly_favor_delta),
        ending_debt=numeric_value(snapshot.ending_debt),
        ending_favor_credit=numeric_value(snapshot.ending_favor_credit),
        fairness_pressure=numeric_value(snapshot.fairness_pressure),
        priority_tier=snapshot.priority_tier,
        priority_multiplier=numeric_value(snapshot.priority_multiplier),
        assignment_count=snapshot.assignment_count,
        negative_event_count=snapshot.negative_event_count,
        positive_event_count=snapshot.positive_event_count,
    )
    return snapshot_data


def event_read(
    event: ProviderFairnessEvent,
    providers: list[Provider],
) -> ProviderFairnessEventRead:
    display_name = provider_display_name(event.provider_id, providers)
    event_data = ProviderFairnessEventRead(
        id=event.id,
        created_at=event.created_at,
        updated_at=event.updated_at,
        provider_id=event.provider_id,
        provider_display_name=display_name,
        schedule_period_id=event.schedule_period_id,
        schedule_version_id=event.schedule_version_id,
        assignment_id=event.assignment_id,
        event_type=event.event_type,
        category=event.category,
        debt_delta=numeric_value(event.debt_delta),
        favor_delta=numeric_value(event.favor_delta),
        occurred_at=event.occurred_at,
        reason=event.reason,
    )
    return event_data


def fairness_report(
    organization_id: UUID,
    session: Session,
) -> FairnessReportRead:
    schedule_version = latest_schedule_version_with_fairness(organization_id, session)

    if schedule_version is None:
        response = FairnessReportRead(
            has_data=False,
            schedule_period=None,
            schedule_version=None,
            config=None,
            metrics=[],
            snapshots=[],
            events=[],
        )
        return response

    schedule_period = schedule_period_for_version(schedule_version, organization_id, session)
    snapshots = snapshots_for_report(schedule_version, organization_id, session)
    events = events_for_report(schedule_version, organization_id, session)
    config = fairness_config_for_report(snapshots, organization_id, session)
    providers = all_providers_for_organization(organization_id, session)
    config_read = None

    if config is not None:
        config_read = FairnessConfigVersionRead.model_validate(config)

    schedule_period_read = SchedulePeriodRead.model_validate(schedule_period)
    schedule_version_read = ScheduleVersionRead.model_validate(schedule_version)
    snapshot_reads = [
        snapshot_read(snapshot, providers)
        for snapshot in snapshots
    ]
    event_reads = [
        event_read(event, providers)
        for event in events
    ]
    metrics = fairness_metrics(snapshots)
    response = FairnessReportRead(
        has_data=True,
        schedule_period=schedule_period_read,
        schedule_version=schedule_version_read,
        config=config_read,
        metrics=metrics,
        snapshots=snapshot_reads,
        events=event_reads,
    )
    return response
