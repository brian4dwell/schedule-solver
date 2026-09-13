from datetime import datetime
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.db.models import Center
from app.db.models import ConstraintViolation
from app.db.models import ProviderFairnessState
from app.db.models import ScheduleVersion
from app.routers.schedules import generate_schedule_period
from app.routers.schedules import publish_schedule_version
from app.routers.schedules import save_schedule_version
from app.schemas.schedule import ScheduleAssignmentCreate
from app.schemas.schedule import ScheduleDraftSaveRequest
from app.schemas.schedule import ScheduleGenerateRequest
from app.services.scheduling.provider_eligibility import check_provider_slot_eligibility
from app.services.scheduling.provider_eligibility_contracts import ProviderSlotEligibilityInput
from conftest import SchedulingDatabase


def assignment_request(database: SchedulingDatabase, shift_type: str = "full_shift") -> ScheduleAssignmentCreate:
    return ScheduleAssignmentCreate(
        room_slot_id=uuid4(),
        provider_id=database.provider.id,
        center_id=database.center.id,
        room_id=database.room.id,
        shift_type=shift_type,
        schedule_date=database.period.start_date,
        start_time=datetime(2026, 9, 14, 7),
        end_time=datetime(2026, 9, 14, 11),
    )


def save_draft(database: SchedulingDatabase, shift_type: str = "full_shift"):
    assignment = assignment_request(database, shift_type)
    request = ScheduleDraftSaveRequest(schedule_period_id=database.period.id, assignments=[assignment])
    return save_schedule_version(request, "manual", database.session, database.organization.id)


def publish(database: SchedulingDatabase, version_id):
    return publish_schedule_version(version_id, database.session, database.organization.id)


@pytest.mark.parametrize("invalid_state", ["inactive_room", "inactive_center", "room_center_mismatch"])
def test_structural_violations_are_shared_by_eligibility_drafts_and_publish(
    scheduling_database: SchedulingDatabase,
    invalid_state: str,
) -> None:
    database = scheduling_database
    if invalid_state == "inactive_room":
        database.room.is_active = False
    elif invalid_state == "inactive_center":
        database.center.is_active = False
    else:
        other_center = Center(organization_id=database.organization.id, name="Center B", timezone="UTC")
        database.session.add(other_center)
        database.session.flush()
        database.room.center_id = other_center.id
    database.session.commit()
    request = assignment_request(database)
    eligibility = ProviderSlotEligibilityInput(
        organization_id=database.organization.id,
        schedule_period_id=database.period.id,
        provider_id=request.provider_id,
        center_id=request.center_id,
        room_id=request.room_id,
        start_time=request.start_time,
        end_time=request.end_time,
    )
    result = check_provider_slot_eligibility(eligibility, database.session)
    assert not result.is_eligible
    assert invalid_state in [violation.constraint_type for violation in result.violations]
    draft = save_draft(database)
    assert invalid_state in [violation.constraint_type for violation in draft.violations]
    with pytest.raises(HTTPException) as error:
        publish(database, draft.version.id)
    assert error.value.status_code == 409
    assert draft.version.status == "draft"


@pytest.mark.parametrize("invalid_state", ["inactive_room", "inactive_center", "room_center_mismatch"])
def test_solver_rejects_invalid_location(scheduling_database: SchedulingDatabase, invalid_state: str) -> None:
    database = scheduling_database
    if invalid_state == "inactive_room":
        database.room.is_active = False
    elif invalid_state == "inactive_center":
        database.center.is_active = False
    else:
        other_center = Center(organization_id=database.organization.id, name="Center B", timezone="UTC")
        database.session.add(other_center)
        database.session.flush()
        database.room.center_id = other_center.id
    database.session.commit()
    request = ScheduleGenerateRequest(assignments=[assignment_request(database)])
    with pytest.raises(HTTPException) as error:
        generate_schedule_period(database.period.id, request, database.session, database.organization.id)
    assert error.value.status_code == 409


def test_failed_solver_version_cannot_publish(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    request = ScheduleGenerateRequest(assignments=[])
    with pytest.raises(HTTPException) as generation_error:
        generate_schedule_period(database.period.id, request, database.session, database.organization.id)
    assert generation_error.value.status_code == 409
    version = database.session.scalar(select(ScheduleVersion))
    with pytest.raises(HTTPException) as publish_error:
        publish(database, version.id)
    assert publish_error.value.status_code == 409
    blockers = publish_error.value.detail["violations"]
    assert "empty_schedule" in [blocker["constraint_type"] for blocker in blockers]
    assert "missing_shift_requirements" in [blocker["constraint_type"] for blocker in blockers]
    assert version.status == "draft"


def test_nonempty_version_retains_schedule_level_coverage_blockers(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    draft = save_draft(database)
    violation = ConstraintViolation(
        organization_id=database.organization.id,
        schedule_version_id=draft.version.id,
        assignment_id=None,
        severity="hard_violation",
        constraint_type="infeasible_solver_model",
        message="Required coverage was not satisfied.",
    )
    database.session.add(violation)
    database.session.commit()
    with pytest.raises(HTTPException) as error:
        publish(database, draft.version.id)
    assert error.value.status_code == 409


def test_current_assignment_checks_replace_stale_assignment_violations(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    draft = save_draft(database, "first_half")
    violation = ConstraintViolation(
        organization_id=database.organization.id,
        schedule_version_id=draft.version.id,
        assignment_id=draft.assignments[0].id,
        severity="hard_violation",
        constraint_type="provider_unavailable",
        message="Historical availability failure.",
    )
    database.session.add(violation)
    database.session.commit()
    response = publish(database, draft.version.id)
    assert response.version.status == "published"


def test_deactivated_room_blocks_a_previously_valid_saved_draft(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    draft = save_draft(database)
    database.room.is_active = False
    database.session.commit()
    with pytest.raises(HTTPException) as error:
        publish(database, draft.version.id)
    assert error.value.status_code == 409
    blockers = error.value.detail["violations"]
    assert "inactive_room" in [blocker["constraint_type"] for blocker in blockers]


def test_fairness_failure_rolls_back_publication(scheduling_database: SchedulingDatabase, monkeypatch) -> None:
    database = scheduling_database
    draft = save_draft(database)

    def fail_fairness(_organization_id, _session):
        raise RuntimeError("Fairness rebuild failed")

    monkeypatch.setattr("app.routers.schedules.rebuild_published_fairness_state", fail_fairness)
    with pytest.raises(RuntimeError):
        publish(database, draft.version.id)
    database.session.rollback()
    database.session.expire_all()
    persisted_version = database.session.get(ScheduleVersion, draft.version.id)
    assert persisted_version.status == "draft"
    assert database.period.status == "draft"


def test_first_replacement_and_repeat_publish_use_current_fairness(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    first = save_draft(database)
    publish(database, first.version.id)
    state = database.session.scalar(select(ProviderFairnessState))
    assert state is not None
    assert float(state.fairness_debt) == 1.5
    replacement = save_draft(database, "first_half")
    publish(database, replacement.version.id)
    database.session.expire_all()
    state = database.session.scalar(select(ProviderFairnessState))
    assert float(state.fairness_debt) == 1.0
    assert state.last_applied_schedule_version_id == replacement.version.id
    previous = database.session.get(ScheduleVersion, first.version.id)
    assert previous.status == "superseded"
    publish(database, replacement.version.id)
    database.session.expire_all()
    state = database.session.scalar(select(ProviderFairnessState))
    assert float(state.fairness_debt) == 1.0
