from datetime import UTC
from datetime import date
from datetime import datetime
from datetime import time
from datetime import timedelta
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
import pytest

from app.db.models import ProviderCenterCredential
from app.db.models import Center
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import SchedulePeriod
from app.db.models import ScheduleVersion
from app.routers.schedules import apply_schedule_structure_template
from app.routers.schedules import create_schedule_structure_template
from app.routers.schedules import generate_schedule_period
from app.routers.schedules import publish_schedule_version
from app.routers.schedules import read_provider_eligibility
from app.routers.schedules import read_schedule_version
from app.routers.schedules import save_schedule_version
from app.schemas.schedule import ProviderEligibilityRequest
from app.schemas.schedule import ScheduleAssignmentCreate
from app.schemas.schedule import ScheduleDraftSaveRequest
from app.schemas.schedule import ScheduleGenerateRequest
from app.schemas.schedule import ScheduleStructureTemplateApplyRequest
from app.schemas.schedule import ScheduleStructureTemplateSlotWrite
from app.schemas.schedule import ScheduleStructureTemplateWrite
from app.schemas.schedule_time import ScheduleTimeRange
from app.services.scheduling.draft_cleanup import DraftCleanupSelection
from app.services.scheduling.draft_cleanup import apply_draft_cleanup
from app.services.scheduling.draft_cleanup import preview_draft_cleanup
from app.services.scheduling.time_ranges import ScheduleTimeError
from app.services.scheduling.time_ranges import slot_instants
from conftest import SchedulingDatabase


@pytest.mark.parametrize("clock", ["7:00", "07:00:00", "07:00Z", "07:00-06:00", "2026-11-05T07:00:00", "24:00", "07:60", 420, None])
def test_clock_contract_rejects_noncanonical_values(clock: object) -> None:
    with pytest.raises(ValidationError):
        ScheduleTimeRange(schedule_date="2026-11-05", start_time=clock, end_time="15:00")


@pytest.mark.parametrize("schedule_date", ["2026-02-30", "2026-11-05T00:00:00Z", 1, datetime(2026, 11, 5)])
def test_schedule_date_rejects_instants_and_invalid_dates(schedule_date: object) -> None:
    with pytest.raises(ValidationError):
        ScheduleTimeRange(schedule_date=schedule_date, start_time="07:00", end_time="15:00")


@pytest.mark.parametrize("end", ["07:00", "06:59"])
def test_clock_contract_rejects_nonpositive_ranges(end: str) -> None:
    with pytest.raises(ValidationError, match="after start"):
        ScheduleTimeRange(schedule_date="2026-11-05", start_time="07:00", end_time=end)


@pytest.mark.parametrize("day,expected_hour", [(date(2026, 3, 7), 14), (date(2026, 3, 9), 13), (date(2026, 10, 31), 13), (date(2026, 11, 2), 14)])
def test_center_instants_change_with_dst_but_clocks_do_not(day: date, expected_hour: int) -> None:
    clocks = ScheduleTimeRange(schedule_date=day, start_time="07:00", end_time="15:00")
    instants = slot_instants(day, clocks.start_time, clocks.end_time, "America/Denver")
    assert instants.start.astimezone(UTC).hour == expected_hour
    assert clocks.model_dump(mode="json")["start_time"] == "07:00"
    assert clocks.model_dump(mode="json")["end_time"] == "15:00"


@pytest.mark.parametrize("day,start,end", [(date(2026, 3, 8), time(2, 30), time(4)), (date(2026, 11, 1), time(1, 30), time(4))])
def test_dst_gap_and_fold_require_explicit_resolution(day: date, start: time, end: time) -> None:
    with pytest.raises(ScheduleTimeError, match="ambiguous or nonexistent"):
        slot_instants(day, start, end, "America/Denver")


def slot(database: SchedulingDatabase, start: str = "07:00", end: str = "15:00", shift_type: str = "full_shift") -> ScheduleAssignmentCreate:
    return ScheduleAssignmentCreate(
        room_slot_id=uuid4(),
        provider_id=database.provider.id,
        center_id=database.center.id,
        room_id=database.room.id,
        schedule_date=database.period.start_date,
        start_time=start,
        end_time=end,
        shift_type=shift_type,
    )


def save(database: SchedulingDatabase, assignments: list[ScheduleAssignmentCreate], parent=None):
    request = ScheduleDraftSaveRequest(schedule_period_id=database.period.id, parent_schedule_version_id=parent, assignments=assignments)
    return save_schedule_version(request, "manual", database.session, database.organization.id)


def test_repeated_save_read_cycles_preserve_clocks_and_assignment_metadata(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    database.center.timezone = "America/Denver"
    assignment = slot(database)
    assignment.room_id = None
    assignment.notes = "Keep these notes"
    assignment.required_provider_type = "doctor"
    parent = None

    for _ in range(10):
        result = save(database, [assignment], parent)
        detail = read_schedule_version(result.version.id, database.session, database.organization.id)
        payload = detail.model_dump(mode="json")["assignments"][0]
        assert payload["schedule_date"] == "2026-09-14"
        assert payload["start_time"] == "07:00"
        assert payload["end_time"] == "15:00"
        assert payload["room_id"] is None
        assert payload["notes"] == "Keep these notes"
        assert payload["required_provider_type"] == "doctor"
        assignment = ScheduleAssignmentCreate.model_validate(payload)
        parent = result.version.id


@pytest.mark.parametrize("operation", ["save", "generate", "eligibility"])
def test_period_bounds_rejected_at_every_write_boundary(scheduling_database: SchedulingDatabase, operation: str) -> None:
    database = scheduling_database
    assignment = slot(database)
    assignment.schedule_date = database.period.end_date + timedelta(days=1)

    with pytest.raises(HTTPException) as error:
        if operation == "save":
            save(database, [assignment])
        elif operation == "generate":
            request = ScheduleGenerateRequest(assignments=[assignment])
            generate_schedule_period(database.period.id, request, database.session, database.organization.id)
        else:
            payload = assignment.model_dump()
            request = ProviderEligibilityRequest(schedule_period_id=database.period.id, **payload)
            read_provider_eligibility(request, database.session, database.organization.id)

    assert error.value.status_code == 400


@pytest.mark.parametrize("first_type,second_type,second_start,expected", [("full_shift", "full_shift", "11:00", False), ("first_half", "second_half", "11:00", True), ("first_half", "second_half", "10:00", False)])
def test_manual_and_solver_agree_on_same_day_pairs(scheduling_database: SchedulingDatabase, first_type: str, second_type: str, second_start: str, expected: bool) -> None:
    database = scheduling_database
    first = slot(database, "07:00", "11:00", first_type)
    second = slot(database, second_start, "15:00", second_type)
    draft = save(database, [first, second])
    hard_violations = [violation for violation in draft.violations if violation.severity == "hard_violation"]
    assert (len(hard_violations) == 0) == expected
    request = ScheduleGenerateRequest(assignments=[first, second])

    if expected:
        publish_schedule_version(draft.version.id, database.session, database.organization.id)
        generated = generate_schedule_period(database.period.id, request, database.session, database.organization.id)
        assert generated.is_feasible
    else:
        with pytest.raises(HTTPException) as publish_error:
            publish_schedule_version(draft.version.id, database.session, database.organization.id)
        assert publish_error.value.status_code == 409
        with pytest.raises(HTTPException) as solve_error:
            generate_schedule_period(database.period.id, request, database.session, database.organization.id)
        assert solve_error.value.status_code == 409


def test_credential_bounds_compare_center_instants(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    database.center.timezone = "America/Denver"
    credential = database.session.scalar(select(ProviderCenterCredential))
    credential.starts_at = datetime(2026, 9, 14, 13, tzinfo=UTC)
    credential.expires_at = datetime(2026, 9, 14, 21, tzinfo=UTC)
    draft = save(database, [slot(database)])
    assert not any(violation.constraint_type == "inactive_center_credential" for violation in draft.violations)
    credential.starts_at = datetime(2026, 9, 14, 14, tzinfo=UTC)
    draft = save(database, [slot(database)])
    assert any(violation.constraint_type == "inactive_center_credential" for violation in draft.violations)


def test_cleanup_preserves_period_availability_and_newer_drafts(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    old = save(database, [slot(database)])
    retained = save(database, [slot(database)])
    selection = DraftCleanupSelection(organization_id=database.organization.id, version_ids=[old.version.id])
    preview = preview_draft_cleanup(selection, database.session)
    assert preview.assignment_count == 1
    assert database.session.get(ScheduleVersion, old.version.id) is not None
    apply_draft_cleanup(selection, database.session)
    database.session.commit()
    assert database.session.get(ScheduleVersion, old.version.id) is None
    assert database.session.get(ScheduleVersion, retained.version.id) is not None
    assert database.session.get(SchedulePeriod, database.period.id) is not None
    assert database.session.scalar(select(ProviderScheduleWeekAvailability)) is not None


def test_cleanup_refuses_published_or_parent_referenced_drafts(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    old = save(database, [slot(database)])
    save(database, [slot(database)], old.version.id)
    selection = DraftCleanupSelection(organization_id=database.organization.id, version_ids=[old.version.id])
    with pytest.raises(ValueError, match="unselected version"):
        apply_draft_cleanup(selection, database.session)
    version = database.session.get(ScheduleVersion, old.version.id)
    version.status = "published"
    with pytest.raises(ValueError, match="unpublished draft"):
        apply_draft_cleanup(selection, database.session)


def test_template_apply_skips_dates_outside_short_period(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    database.period.end_date = database.period.start_date
    monday = ScheduleStructureTemplateSlotWrite(weekday="monday", room_id=database.room.id, shift_type="full_shift", start_time="07:00", end_time="15:00", display_order=0)
    tuesday = ScheduleStructureTemplateSlotWrite(weekday="tuesday", room_id=database.room.id, shift_type="full_shift", start_time="07:00", end_time="15:00", display_order=1)
    request = ScheduleStructureTemplateWrite(name="Two days", slots=[monday, tuesday])
    template = create_schedule_structure_template(request, database.session, database.organization.id)
    apply_request = ScheduleStructureTemplateApplyRequest(schedule_period_id=database.period.id)
    result = apply_schedule_structure_template(template.id, apply_request, database.session, database.organization.id)
    assert len(result.applied_slots) == 1
    assert result.applied_slots[0].model_dump(mode="json")["start_time"] == "07:00"
    assert result.skipped_slots[0].reason == "outside_schedule_period"


def test_three_same_day_slots_cannot_publish(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    assignments = [slot(database, "07:00", "09:00", "first_half"), slot(database, "09:00", "11:00", "second_half"), slot(database, "11:00", "15:00", "second_half")]
    draft = save(database, assignments)
    assert any(violation.constraint_type == "provider_same_day_conflict" for violation in draft.violations)
    with pytest.raises(HTTPException) as error:
        publish_schedule_version(draft.version.id, database.session, database.organization.id)
    assert error.value.status_code == 409


def test_publish_rechecks_period_bounds(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    draft = save(database, [slot(database)])
    database.period.start_date = database.period.start_date + timedelta(days=1)
    with pytest.raises(HTTPException) as error:
        publish_schedule_version(draft.version.id, database.session, database.organization.id)
    assert error.value.status_code == 409
    codes = [violation["constraint_type"] for violation in error.value.detail["violations"]]
    assert "outside_schedule_period" in codes


def test_cleanup_rollback_restores_selected_drafts(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    draft = save(database, [slot(database)])
    version_id = draft.version.id
    selection = DraftCleanupSelection(organization_id=database.organization.id, version_ids=[version_id])
    apply_draft_cleanup(selection, database.session)
    database.session.rollback()
    database.session.expire_all()
    assert database.session.get(ScheduleVersion, version_id) is not None


def test_cleanup_rejects_wrong_organization(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    draft = save(database, [slot(database)])
    selection = DraftCleanupSelection(organization_id=uuid4(), version_ids=[draft.version.id])
    with pytest.raises(ValueError, match="another organization"):
        apply_draft_cleanup(selection, database.session)


def test_cross_center_overlap_uses_instants_across_local_dates(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    database.center.timezone = "America/Los_Angeles"
    other_center = Center(organization_id=database.organization.id, name="Eastern", timezone="America/New_York")
    database.session.add(other_center)
    database.session.flush()
    credential = ProviderCenterCredential(organization_id=database.organization.id, provider_id=database.provider.id, center_id=other_center.id)
    availability = ProviderScheduleWeekAvailability(organization_id=database.organization.id, provider_id=database.provider.id, schedule_week_id=database.period.id, weekday="tuesday", availability_options=["full_shift"], min_shifts_requested=0, max_shifts_requested=5, min_shifts_requested_units=0, max_shifts_requested_units=10)
    database.session.add_all([credential, availability])
    first = slot(database, "22:00", "23:00")
    second = slot(database, "01:00", "02:00")
    second.schedule_date = second.schedule_date + timedelta(days=1)
    second.center_id = other_center.id
    second.room_id = None
    draft = save(database, [first, second])
    assert any(violation.constraint_type == "provider_double_booked" for violation in draft.violations)
    request = ScheduleGenerateRequest(assignments=[first, second])
    with pytest.raises(HTTPException) as error:
        generate_schedule_period(database.period.id, request, database.session, database.organization.id)
    assert error.value.status_code == 409
