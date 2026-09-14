from datetime import date
from datetime import timedelta

from fastapi import HTTPException
from pydantic import ValidationError
import pytest

from app.db.models import Center
from app.db.models import ProviderCenterCredential
from app.db.models import ProviderScheduleWeekAvailability
from app.routers.schedules import apply_schedule_structure_template
from app.routers.schedules import create_schedule_structure_template
from app.routers.schedules import generate_schedule_period
from app.schemas.center import CenterCreate
from app.schemas.center import CenterUpdate
from app.schemas.schedule import ScheduleGenerateRequest
from app.schemas.schedule import SchedulePeriodCreate
from app.schemas.schedule import ScheduleStructureTemplateApplyRequest
from app.schemas.schedule import ScheduleStructureTemplateSlotWrite
from app.schemas.schedule import ScheduleStructureTemplateWrite
from conftest import SchedulingDatabase
from test_schedule_times import save
from test_schedule_times import slot


@pytest.mark.parametrize("timezone", ["Not/A_Zone", "", "../UTC", None])
def test_center_timezone_rejected_at_create_and_update(timezone: object) -> None:
    with pytest.raises(ValidationError):
        CenterCreate(name="Invalid timezone", timezone=timezone)

    with pytest.raises(ValidationError):
        CenterUpdate(timezone=timezone)

    assert "timezone" not in CenterUpdate().model_fields_set


def test_invalid_stored_timezone_returns_actionable_error(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    database.center.timezone = "Not/A_Zone"
    database.session.flush()
    assignment = slot(database)

    with pytest.raises(HTTPException) as error:
        save(database, [assignment])

    assert error.value.status_code == 400
    assert "timezone" in error.value.detail


@pytest.mark.parametrize("start", ["2026-09-14T00:00:00Z", 1789344000])
def test_period_dates_reject_instant_coercion(start: object) -> None:
    with pytest.raises(ValidationError):
        SchedulePeriodCreate(name="Week", start_date=start, end_date="2026-09-20")


def test_manual_and_solver_reject_overlap_two_local_dates_apart(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    database.center.timezone = "Etc/GMT+12"
    other_center = Center(organization_id=database.organization.id, name="Date line east", timezone="Pacific/Kiritimati")
    database.session.add(other_center)
    database.session.flush()
    credential = ProviderCenterCredential(organization_id=database.organization.id, provider_id=database.provider.id, center_id=other_center.id)
    availability = ProviderScheduleWeekAvailability(
        organization_id=database.organization.id,
        provider_id=database.provider.id,
        schedule_week_id=database.period.id,
        weekday="wednesday",
        availability_options=["full_shift"],
        min_shifts_requested=0,
        max_shifts_requested=5,
        min_shifts_requested_units=0,
        max_shifts_requested_units=10,
    )
    database.session.add_all([credential, availability])
    first = slot(database, "23:00", "23:59")
    second = slot(database, "01:00", "01:59")
    second.schedule_date = first.schedule_date + timedelta(days=2)
    second.center_id = other_center.id
    second.room_id = None
    draft = save(database, [first, second])
    overlap_violations = [violation for violation in draft.violations if violation.constraint_type == "provider_double_booked"]
    assert len(overlap_violations) == 2

    request = ScheduleGenerateRequest(assignments=[first, second])
    with pytest.raises(HTTPException) as error:
        generate_schedule_period(database.period.id, request, database.session, database.organization.id)

    assert error.value.status_code == 409


@pytest.mark.parametrize("sunday", [date(2026, 3, 8), date(2026, 11, 1)])
def test_template_application_rejects_dst_gap_or_fold(scheduling_database: SchedulingDatabase, sunday: date) -> None:
    database = scheduling_database
    database.center.timezone = "America/Denver"
    database.period.start_date = sunday - timedelta(days=6)
    database.period.end_date = sunday
    start = "02:30" if sunday.month == 3 else "01:30"
    template_slot = ScheduleStructureTemplateSlotWrite(
        weekday="sunday",
        room_id=database.room.id,
        shift_type="full_shift",
        start_time=start,
        end_time="04:00",
        display_order=0,
    )
    request = ScheduleStructureTemplateWrite(name="DST boundary", slots=[template_slot])
    template = create_schedule_structure_template(request, database.session, database.organization.id)
    application = ScheduleStructureTemplateApplyRequest(schedule_period_id=database.period.id)

    with pytest.raises(HTTPException) as error:
        apply_schedule_structure_template(template.id, application, database.session, database.organization.id)

    assert error.value.status_code == 400
    assert "ambiguous or nonexistent" in error.value.detail
