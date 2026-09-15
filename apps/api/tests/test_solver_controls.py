from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from ortools.sat.python import cp_model
from sqlalchemy import select
import pytest

from app.db.models import Organization
from app.db.models import ScheduleJob
from app.db.models import ScheduleVersion
from app.routers.schedules import generate_schedule_period
from app.routers.schedules import publish_schedule_version
from app.routers.schedules import save_schedule_version
from app.routers.solver_controls import list_solver_runs
from app.routers.solver_controls import save_solver_settings
from app.schemas.schedule import ScheduleDraftSaveRequest
from app.schemas.schedule import ScheduleGenerateRequest
from app.schemas.solver_settings import SolverSettingsWrite
from app.schemas.solver_settings import SolverWeights
from app.services.scheduling.draft_cleanup import apply_draft_cleanup
from app.services.scheduling.draft_cleanup import DraftCleanupSelection
from app.services.scheduling.solver import solve_schedule
from app.services.scheduling.solver_contracts import SolverInput
from app.services.scheduling.solver_contracts import SolverManagerCenterPreference
from app.services.scheduling.solver_contracts import SolverProviderCenterPreference
from app.services.scheduling.solver_contracts import SolverProviderShiftTypePreference
from app.services.scheduling.solver_contracts import SolverWeeklyAvailabilityDay
from app.services.scheduling.solver_outcomes import measure_solver_outcomes
from app.services.scheduling.solver_run_contracts import SolverRunSnapshot
from app.services.scheduling.solver_runs import require_replay_snapshot
from app.services.scheduling.solver_runs import solver_run_read
from conftest import SchedulingDatabase
from test_publish_integrity import assignment_request
from test_solver import create_credential
from test_solver import create_provider
from test_solver import create_room
from test_solver import create_shift


def zero_weights(**changes: int) -> SolverWeights:
    weights = SolverWeights(
        center_weight=0,
        shift_type_weight=0,
        manager_hidden_weight=0,
        below_minimum_weight=0,
        above_maximum_weight=0,
        balance_weight=0,
        fairness_weight=0,
    )
    values = weights.model_dump()
    values.update(changes)
    return SolverWeights.model_validate(values)


def two_provider_input() -> SolverInput:
    center_id = uuid4()
    room_type_id = uuid4()
    room = create_room(center_id, room_type_id)
    first = create_provider(center_id, room_type_id)
    second = create_provider(center_id, room_type_id)
    shift = create_shift(center_id, room.id, 7, 15)
    return SolverInput(
        organization_id=uuid4(),
        schedule_period_id=uuid4(),
        rooms=[room],
        providers=[first, second],
        center_credentials=[
            create_credential(first.id, center_id),
            create_credential(second.id, center_id),
        ],
        shift_requirements=[shift],
    )


@pytest.mark.parametrize(
    "factor", ["center_weight", "shift_type_weight", "manager_hidden_weight"]
)
def test_preference_control_changes_placement_tradeoff(factor: str) -> None:
    data = two_provider_input()
    first, second = data.providers
    center_id = data.rooms[0].center_id
    if factor == "center_weight":
        first.center_preferences = [
            SolverProviderCenterPreference(center_id=center_id, preference_level=1)
        ]
        second.shift_type_preferences = [
            SolverProviderShiftTypePreference(
                shift_type="full_shift", preference_level=1
            )
        ]
        competitor = "shift_type_weight"
    elif factor == "shift_type_weight":
        first.shift_type_preferences = [
            SolverProviderShiftTypePreference(
                shift_type="full_shift", preference_level=1
            )
        ]
        second.center_preferences = [
            SolverProviderCenterPreference(center_id=center_id, preference_level=1)
        ]
        competitor = "center_weight"
    else:
        first.manager_center_preferences = [
            SolverManagerCenterPreference(center_id=center_id, preference_level=1)
        ]
        second.center_preferences = [
            SolverProviderCenterPreference(center_id=center_id, preference_level=1)
        ]
        competitor = "center_weight"
    data.preference_weights = zero_weights(**{factor: 1, competitor: 2})
    initial = solve_schedule(data)
    data.preference_weights = zero_weights(**{factor: 3, competitor: 2})
    adjusted = solve_schedule(data)
    assert initial.assignments[0].provider_id == second.id
    assert adjusted.assignments[0].provider_id == first.id


@pytest.mark.parametrize(
    "factor", ["below_minimum_weight", "above_maximum_weight", "fairness_weight"]
)
def test_workload_control_changes_allocation(factor: str) -> None:
    data = two_provider_input()
    first, second = data.providers
    center_id = data.rooms[0].center_id
    first.center_preferences = [
        SolverProviderCenterPreference(center_id=center_id, preference_level=1)
    ]
    if factor == "below_minimum_weight":
        second.week_availability.min_shifts_requested_units = 2
    elif factor == "above_maximum_weight":
        first.week_availability.max_shifts_requested_units = 0
    else:
        first.fairness_debt = 1
    data.preference_weights = zero_weights(center_weight=1)
    initial = solve_schedule(data)
    data.preference_weights = zero_weights(center_weight=1, **{factor: 2})
    adjusted = solve_schedule(data)
    assert initial.assignments[0].provider_id == first.id
    assert adjusted.assignments[0].provider_id == second.id


def test_balance_control_spreads_work_across_providers() -> None:
    data = two_provider_input()
    first = data.providers[0]
    center_id = data.rooms[0].center_id
    first.center_preferences = [
        SolverProviderCenterPreference(center_id=center_id, preference_level=1)
    ]
    second_shift = create_shift(center_id, data.rooms[0].id, 7, 15)
    second_shift.start_time += timedelta(days=1)
    second_shift.end_time += timedelta(days=1)
    data.shift_requirements.append(second_shift)
    for provider in data.providers:
        provider.week_availability.days.append(
            SolverWeeklyAvailabilityDay(weekday="tuesday", options=["full_shift"])
        )
    data.preference_weights = zero_weights(center_weight=1)
    initial = solve_schedule(data)
    data.preference_weights = zero_weights(center_weight=1, balance_weight=2)
    adjusted = solve_schedule(data)
    assert all(assignment.provider_id == first.id for assignment in initial.assignments)
    assert len({assignment.provider_id for assignment in adjusted.assignments}) == 2


@pytest.mark.parametrize(
    "weights",
    [
        SolverWeights(),
        zero_weights(),
        SolverWeights(center_weight=8, fairness_weight=20),
    ],
)
def test_outcomes_reconcile_score_and_measure_disabled_factors(
    weights: SolverWeights,
) -> None:
    data = two_provider_input()
    first, second = data.providers
    first.fairness_debt = 0.123
    first.week_availability.min_shifts_requested_units = 4
    second.week_availability.max_shifts_requested_units = 0
    first.center_preferences = [
        SolverProviderCenterPreference(
            center_id=data.rooms[0].center_id, preference_level=2
        )
    ]
    second.is_active = False
    data.preference_weights = weights
    result = solve_schedule(data)
    outcomes = measure_solver_outcomes(data, result)
    assert result.assignments[0].provider_id == first.id
    assert (
        sum(factor.contribution for factor in outcomes.factors) == result.solver_score
    )
    assert outcomes.center_preferences.positive == 1
    assert outcomes.shift_preferences.missing == 1
    shortfall = next(
        factor for factor in outcomes.factors if factor.factor == "below_minimum_weight"
    )
    assert shortfall.raw_value == 2
    imbalance = next(
        factor for factor in outcomes.factors if factor.factor == "balance_weight"
    )
    assert imbalance.raw_value == 2


def test_best_effort_outcomes_count_unfilled_slots() -> None:
    data = two_provider_input()
    for provider in data.providers:
        provider.is_active = False
    result = solve_schedule(data, "best_effort")
    outcomes = measure_solver_outcomes(data, result)
    assert outcomes.unfilled_count == 1
    assert outcomes.assigned_count == 0
    assert (
        sum(factor.contribution for factor in outcomes.factors) == result.solver_score
    )


@pytest.mark.parametrize("value", [-1, 9, 1.5, "4", True])
def test_invalid_weights_are_rejected(value: object) -> None:
    with pytest.raises(ValidationError):
        SolverWeights(center_weight=value)


def test_coverage_and_unknown_weights_cannot_be_changed() -> None:
    with pytest.raises(ValidationError):
        SolverWeights(unfilled_weight=0)
    with pytest.raises(ValidationError):
        SolverWeights(unknown_weight=3)


def test_defaults_and_run_snapshots_are_independent(
    scheduling_database: SchedulingDatabase,
) -> None:
    db = scheduling_database
    defaults = SolverWeights(center_weight=7)
    settings_request = SolverSettingsWrite(weights=defaults, expected_revision=1)
    settings = save_solver_settings(settings_request, db.session, db.organization.id)
    assert settings.revision == 2
    request = ScheduleGenerateRequest(
        assignments=[assignment_request(db)],
        solver_weights=SolverWeights(center_weight=2),
    )
    generated = generate_schedule_period(
        db.period.id, request, db.session, db.organization.id, "scheduler-subject"
    )
    job = db.session.get(ScheduleJob, generated.version.schedule_job_id)
    original = SolverRunSnapshot.model_validate(job.solver_snapshot)
    assert original.weights.center_weight == 2
    assert original.organization_revision == 2
    assert job.requested_by_subject == "scheduler-subject"
    assert db.organization.solver_weights["center_weight"] == 7
    save_solver_settings(
        SolverSettingsWrite(weights=SolverWeights(), expected_revision=2),
        db.session,
        db.organization.id,
    )
    db.session.refresh(job)
    assert SolverRunSnapshot.model_validate(job.solver_snapshot) == original
    with pytest.raises(HTTPException) as error:
        save_solver_settings(settings_request, db.session, db.organization.id)
    assert error.value.status_code == 409


def test_replay_preserves_inputs_and_publish_rechecks_current_eligibility(
    scheduling_database: SchedulingDatabase,
) -> None:
    db = scheduling_database
    request = ScheduleGenerateRequest(assignments=[assignment_request(db)])
    initial = generate_schedule_period(
        db.period.id, request, db.session, db.organization.id
    )
    original_job = db.session.get(ScheduleJob, initial.version.schedule_job_id)
    original_snapshot = SolverRunSnapshot.model_validate(original_job.solver_snapshot)
    assert original_snapshot.configuration_source == "organization"
    db.provider.is_active = False
    db.session.commit()
    replay_request = ScheduleGenerateRequest(
        replay_of_run_id=original_job.id, solver_weights=SolverWeights(center_weight=8)
    )
    replayed = generate_schedule_period(
        db.period.id, replay_request, db.session, db.organization.id
    )
    replay_job = db.session.get(ScheduleJob, replayed.version.schedule_job_id)
    replay_snapshot = SolverRunSnapshot.model_validate(replay_job.solver_snapshot)
    assert replay_snapshot.input_fingerprint == original_snapshot.input_fingerprint
    assert replay_snapshot.input_snapshot.providers[0].is_active
    assert replay_snapshot.weights.center_weight == 8
    assert replayed.version.id != initial.version.id
    assert db.session.get(ScheduleVersion, initial.version.id) is not None
    with pytest.raises(HTTPException) as error:
        publish_schedule_version(replayed.version.id, db.session, db.organization.id)
    assert error.value.status_code == 409


def test_replay_rejects_other_organizations_and_runtime_changes(
    scheduling_database: SchedulingDatabase,
) -> None:
    db = scheduling_database
    generated = generate_schedule_period(
        db.period.id,
        ScheduleGenerateRequest(assignments=[assignment_request(db)]),
        db.session,
        db.organization.id,
    )
    run_id = generated.version.schedule_job_id
    with pytest.raises(HTTPException) as error:
        require_replay_snapshot(run_id, db.period.id, uuid4(), db.session)
    assert error.value.status_code == 404
    with pytest.raises(HTTPException):
        require_replay_snapshot(run_id, uuid4(), db.organization.id, db.session)
    job = db.session.get(ScheduleJob, run_id)
    snapshot = SolverRunSnapshot.model_validate(job.solver_snapshot)
    snapshot.runtime.implementation_id = "old-implementation"
    job.solver_snapshot = snapshot.model_dump(mode="json")
    db.session.commit()
    with pytest.raises(HTTPException) as error:
        require_replay_snapshot(run_id, db.period.id, db.organization.id, db.session)
    assert error.value.status_code == 409
    assert not solver_run_read(job, db.session).can_replay


def test_infeasible_and_exception_runs_retain_configuration(
    scheduling_database: SchedulingDatabase,
) -> None:
    db = scheduling_database
    with pytest.raises(HTTPException):
        generate_schedule_period(
            db.period.id,
            ScheduleGenerateRequest(assignments=[]),
            db.session,
            db.organization.id,
        )
    request = ScheduleGenerateRequest(
        assignments=[assignment_request(db)],
        solver_weights=SolverWeights(balance_weight=6),
    )
    with patch(
        "app.services.scheduling.solver_service.solve_schedule",
        side_effect=RuntimeError("test error"),
    ):
        with pytest.raises(RuntimeError):
            generate_schedule_period(
                db.period.id, request, db.session, db.organization.id
            )
    jobs = list(
        db.session.scalars(select(ScheduleJob).order_by(ScheduleJob.created_at))
    )
    assert len(jobs) == 2
    infeasible = SolverRunSnapshot.model_validate(jobs[0].solver_snapshot)
    assert infeasible.result.solver_status == "infeasible"
    failed = SolverRunSnapshot.model_validate(jobs[1].solver_snapshot)
    assert jobs[1].status == "failed"
    assert failed.weights.balance_weight == 6
    assert failed.input_snapshot is not None
    assert solver_run_read(jobs[1], db.session).schedule_version_id is None


def test_input_builder_failure_retains_accepted_configuration(
    scheduling_database: SchedulingDatabase,
) -> None:
    db = scheduling_database
    with patch(
        "app.services.scheduling.solver_service.build_solver_input",
        side_effect=RuntimeError("input error"),
    ):
        with pytest.raises(RuntimeError):
            generate_schedule_period(
                db.period.id, ScheduleGenerateRequest(), db.session, db.organization.id
            )
    job = db.session.scalar(select(ScheduleJob))
    snapshot = SolverRunSnapshot.model_validate(job.solver_snapshot)
    assert job.status == "failed"
    assert snapshot.weights == SolverWeights()
    assert snapshot.input_snapshot is None


def test_run_history_is_scoped_and_does_not_expose_input_snapshots(
    scheduling_database: SchedulingDatabase,
) -> None:
    db = scheduling_database
    generate_schedule_period(
        db.period.id,
        ScheduleGenerateRequest(assignments=[assignment_request(db)]),
        db.session,
        db.organization.id,
    )
    runs = list_solver_runs(db.period.id, db.session, db.organization.id, 0, 50)
    assert len(runs) == 1
    assert "input_snapshot" not in runs[0].model_dump()
    with pytest.raises(HTTPException) as error:
        list_solver_runs(db.period.id, db.session, uuid4(), 0, 50)
    assert error.value.status_code == 404


def test_manual_drafts_keep_provenance_and_cleanup_keeps_run_history(
    scheduling_database: SchedulingDatabase,
) -> None:
    db = scheduling_database
    assignment = assignment_request(db)
    initial = generate_schedule_period(
        db.period.id,
        ScheduleGenerateRequest(assignments=[assignment]),
        db.session,
        db.organization.id,
    )
    request = ScheduleDraftSaveRequest(
        schedule_period_id=db.period.id,
        parent_schedule_version_id=initial.version.id,
        assignments=[assignment],
    )
    manual = save_schedule_version(request, "manual", db.session, db.organization.id)
    assert manual.version.schedule_job_id == initial.version.schedule_job_id
    job = db.session.get(ScheduleJob, initial.version.schedule_job_id)
    assert solver_run_read(job, db.session).schedule_version_id == initial.version.id
    selection = DraftCleanupSelection(
        organization_id=db.organization.id,
        version_ids=[manual.version.id, initial.version.id],
    )
    preview = apply_draft_cleanup(selection, db.session)
    db.session.commit()
    assert preview.job_count == 0
    assert db.session.get(ScheduleJob, job.id) is not None


def test_new_organizations_receive_explicit_baseline_settings(
    scheduling_database: SchedulingDatabase,
) -> None:
    db = scheduling_database
    organization = Organization(name="New organization")
    db.session.add(organization)
    db.session.flush()
    assert SolverWeights.model_validate(organization.solver_weights) == SolverWeights()
    assert organization.solver_weights_revision == 1


def test_time_limit_is_not_reported_as_proven_infeasibility() -> None:
    data = two_provider_input()
    with patch.object(cp_model.CpSolver, "Solve", return_value=cp_model.UNKNOWN):
        result = solve_schedule(data)
    assert result.solver_status == "unknown"
    assert result.solver_score is None
    assert result.violations[-1].constraint_type == "solver_time_limit"
    assert "infeasibility was not proven" in result.violations[-1].message


@pytest.mark.parametrize("conflict", ["current_assignments", "different_mode"])
def test_replay_rejects_changed_inputs_or_mode(
    scheduling_database: SchedulingDatabase, conflict: str
) -> None:
    db = scheduling_database
    initial = generate_schedule_period(
        db.period.id,
        ScheduleGenerateRequest(assignments=[assignment_request(db)]),
        db.session,
        db.organization.id,
    )
    request = ScheduleGenerateRequest(replay_of_run_id=initial.version.schedule_job_id)
    if conflict == "current_assignments":
        request.assignments = [assignment_request(db)]
        expected_status = 400
    else:
        request.generation_mode = "best_effort"
        expected_status = 409
    with pytest.raises(HTTPException) as error:
        generate_schedule_period(db.period.id, request, db.session, db.organization.id)
    assert error.value.status_code == expected_status
    jobs = list(db.session.scalars(select(ScheduleJob)))
    assert len(jobs) == 1
