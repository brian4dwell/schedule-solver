from dataclasses import replace
from datetime import date
from datetime import time
from uuid import uuid4

from fastapi import HTTPException
import pytest
from sqlalchemy import select

from app.db.models import Assignment
from app.db.models import Organization
from app.db.models import Provider
from app.db.models import ProviderFairnessState
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import Room
from app.db.models import SchedulePeriod
from app.db.models import ShiftRequirement
from app.routers.reports import build_monthly_availability_report
from app.routers.rooms import delete_room
from app.routers.schedules import apply_schedule_structure_template
from app.routers.schedules import create_schedule_structure_template
from app.routers.schedules import delete_schedule_period
from app.routers.schedules import save_schedule_version
from app.schemas.schedule import ScheduleDraftSaveRequest
from app.schemas.schedule import ScheduleStructureTemplateApplyRequest
from app.schemas.schedule import ScheduleStructureTemplateSlotWrite
from app.schemas.schedule import ScheduleStructureTemplateWrite
from app.services.scheduling.provider_eligibility import check_provider_slot_eligibility
from app.services.scheduling.provider_eligibility_contracts import ProviderSlotEligibilityInput
from app.services.scheduling.solver_input_builder import build_solver_input
from conftest import SchedulingDatabase
from test_publish_integrity import assignment_request
from test_publish_integrity import publish
from test_publish_integrity import save_draft


def additional_week(database: SchedulingDatabase, start: date, end: date) -> SchedulingDatabase:
    period = SchedulePeriod(
        organization_id=database.organization.id,
        name="Another week",
        start_date=start,
        end_date=end,
        status="draft",
    )
    database.session.add(period)
    database.session.flush()
    availability = ProviderScheduleWeekAvailability(
        organization_id=database.organization.id,
        provider_id=database.provider.id,
        schedule_week_id=period.id,
        weekday="monday",
        availability_options=["full_shift"],
        min_shifts_requested_units=0,
        max_shifts_requested_units=1,
    )
    database.session.add(availability)
    database.session.commit()
    return replace(database, period=period)


@pytest.mark.parametrize("active_provider", [True, False])
def test_deleting_only_published_period_clears_fairness(
    scheduling_database: SchedulingDatabase,
    active_provider: bool,
) -> None:
    database = scheduling_database
    draft = save_draft(database)
    publish(database, draft.version.id)
    state = database.session.scalar(select(ProviderFairnessState))
    assert float(state.fairness_debt) == 1.5
    database.provider.is_active = active_provider
    database.session.commit()

    delete_schedule_period(database.period.id, database.session, database.organization.id)

    assert database.session.scalar(select(ProviderFairnessState)) is None
    next_week = additional_week(database, date(2026, 9, 21), date(2026, 9, 27))
    database.provider.is_active = True
    database.session.commit()
    solver_input = build_solver_input(next_week.period, database.organization.id, database.session)
    assert solver_input.providers[0].fairness_debt == 0


def test_deleting_one_published_period_rebuilds_remaining_history(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    first = save_draft(database)
    publish(database, first.version.id)
    next_week = additional_week(database, date(2026, 9, 21), date(2026, 9, 27))
    second = save_draft(next_week, "first_half")
    publish(next_week, second.version.id)

    delete_schedule_period(database.period.id, database.session, database.organization.id)

    database.session.expire_all()
    state = database.session.scalar(select(ProviderFairnessState))
    assert float(state.fairness_debt) == 1.0
    assert state.last_applied_schedule_period_id == next_week.period.id
    assert state.last_applied_schedule_version_id == second.version.id


def test_deletion_rolls_back_when_fairness_rebuild_fails(scheduling_database: SchedulingDatabase, monkeypatch) -> None:
    database = scheduling_database
    draft = save_draft(database)
    publish(database, draft.version.id)
    period_id = database.period.id

    def fail_rebuild(_organization_id, _session):
        raise RuntimeError("Rebuild failed")

    monkeypatch.setattr("app.routers.schedules.rebuild_published_fairness_state", fail_rebuild)
    with pytest.raises(RuntimeError, match="Rebuild failed"):
        delete_schedule_period(period_id, database.session, database.organization.id)
    database.session.rollback()
    assert database.session.get(SchedulePeriod, period_id) is not None
    state = database.session.scalar(select(ProviderFairnessState))
    assert float(state.fairness_debt) == 1.5


def test_deleting_period_preserves_other_organization_fairness(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    draft = save_draft(database)
    publish(database, draft.version.id)
    organization = Organization(name="Other organization")
    database.session.add(organization)
    database.session.flush()
    provider = Provider(
        organization_id=organization.id,
        first_name="Other",
        last_name="Provider",
        display_name="Other Provider",
        provider_type="doctor",
        employment_type="employee",
    )
    database.session.add(provider)
    database.session.flush()
    other_state = ProviderFairnessState(organization_id=organization.id, provider_id=provider.id, fairness_debt=99)
    database.session.add(other_state)
    database.session.commit()

    delete_schedule_period(database.period.id, database.session, database.organization.id)

    database.session.expire_all()
    remaining_states = list(database.session.scalars(select(ProviderFairnessState)))
    assert [state.id for state in remaining_states] == [other_state.id]
    assert float(remaining_states[0].fairness_debt) == 99


def test_monthly_report_keeps_unversioned_weeks_and_selects_duplicate_ranges(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    next_week = additional_week(database, date(2026, 9, 21), date(2026, 9, 27))
    duplicate = additional_week(database, database.period.start_date, database.period.end_date)
    save_draft(database)
    save_draft(duplicate)

    report = build_monthly_availability_report(database.organization.id, 2026, 9, [database.period.id], database.session)

    first_day = next(day for day in report.days if day.date == database.period.start_date)
    next_day = next(day for day in report.days if day.date == next_week.period.start_date)
    assert [provider.schedule_period_id for provider in first_day.providers] == [database.period.id]
    assert len(first_day.providers[0].scheduled_assignments) == 1
    assert [provider.schedule_period_id for provider in next_day.providers] == [next_week.period.id]
    assert next_day.providers[0].scheduled_assignments == []


def test_report_keeps_overlapping_distinct_date_ranges(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    overlapping = additional_week(database, database.period.start_date, date(2026, 9, 21))
    save_draft(database)
    save_draft(overlapping)
    report = build_monthly_availability_report(database.organization.id, 2026, 9, [], database.session)
    first_day = next(day for day in report.days if day.date == database.period.start_date)
    assert {provider.schedule_period_id for provider in first_day.providers} == {database.period.id, overlapping.period.id}


def test_template_only_room_is_deactivated_and_skipped_on_apply(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    slot = ScheduleStructureTemplateSlotWrite(
        weekday="monday",
        room_id=database.room.id,
        shift_type="full_shift",
        start_time="07:00",
        end_time="15:00",
        display_order=0,
    )
    request = ScheduleStructureTemplateWrite(name="Template", slots=[slot])
    template = create_schedule_structure_template(request, database.session, database.organization.id)

    result = delete_room(database.room.id, database.session, database.organization.id)

    assert result.is_active is False
    assert database.session.get(Room, database.room.id) is not None
    apply_request = ScheduleStructureTemplateApplyRequest(schedule_period_id=database.period.id)
    applied = apply_schedule_structure_template(template.id, apply_request, database.session, database.organization.id)
    assert applied.applied_slots == []
    assert len(applied.skipped_slots) == 1


def test_unused_room_still_deletes(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    room_id = database.room.id
    delete_room(room_id, database.session, database.organization.id)
    assert database.session.get(Room, room_id) is None


@pytest.mark.parametrize("supplied_type", [None, "crna"])
def test_linked_requirement_type_cannot_be_weakened(scheduling_database: SchedulingDatabase, supplied_type: str | None) -> None:
    database = scheduling_database
    database.provider.provider_type = "crna"
    requirement = ShiftRequirement(
        organization_id=database.organization.id,
        center_id=database.center.id,
        room_id=None,
        schedule_date=database.period.start_date,
        start_time=time(7),
        end_time=time(11),
        required_provider_count=1,
        required_provider_type="doctor",
    )
    database.session.add(requirement)
    database.session.commit()
    assignment = assignment_request(database)
    assignment.shift_requirement_id = requirement.id
    assignment.required_provider_type = supplied_type
    assignment.room_id = None
    eligibility_request = ProviderSlotEligibilityInput(
        organization_id=database.organization.id,
        schedule_period_id=database.period.id,
        **assignment.model_dump(exclude={"room_slot_id", "allow_slot_date_change", "notes", "source"}),
    )
    eligibility = check_provider_slot_eligibility(eligibility_request, database.session)
    assert not eligibility.is_eligible
    assert "provider_type_mismatch" in [violation.constraint_type for violation in eligibility.violations]
    solver_input = build_solver_input(database.period, database.organization.id, database.session, [assignment])
    assert solver_input.shift_requirements[0].required_provider_type == "doctor"

    request = ScheduleDraftSaveRequest(schedule_period_id=database.period.id, assignments=[assignment])
    draft = save_schedule_version(request, "manual", database.session, database.organization.id)
    assert draft.assignments[0].required_provider_type == "doctor"
    assert draft.assignments[0].room_id is None
    assert "provider_type_mismatch" in [violation.constraint_type for violation in draft.violations]

    # Publication also rechecks the requirement for legacy records with missing metadata.
    persisted = database.session.get(Assignment, draft.assignments[0].id)
    persisted.required_provider_type = None
    database.session.commit()
    with pytest.raises(HTTPException) as error:
        publish(database, draft.version.id)
    assert error.value.status_code == 409


@pytest.mark.parametrize("foreign_requirement", [True, False])
def test_save_rejects_unknown_or_foreign_requirement(scheduling_database: SchedulingDatabase, foreign_requirement: bool) -> None:
    database = scheduling_database
    requirement_id = uuid4()
    if foreign_requirement:
        organization = Organization(name="Other organization")
        database.session.add(organization)
        database.session.flush()
        requirement = ShiftRequirement(
            id=requirement_id,
            organization_id=organization.id,
            center_id=database.center.id,
            schedule_date=database.period.start_date,
            start_time=time(7),
            end_time=time(11),
            required_provider_count=1,
            required_provider_type="doctor",
        )
        database.session.add(requirement)
        database.session.commit()

    assignment = assignment_request(database)
    assignment.shift_requirement_id = requirement_id
    request = ScheduleDraftSaveRequest(schedule_period_id=database.period.id, assignments=[assignment])
    with pytest.raises(HTTPException) as error:
        save_schedule_version(request, "manual", database.session, database.organization.id)
    assert error.value.status_code == 404
    assert error.value.detail == "Shift requirement not found"
