from datetime import UTC
from datetime import date
from datetime import datetime
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.routers.schedules import create_assignment_from_request
from app.routers.schedules import unassigned_provider_violation
from app.routers.schedules import validate_schedule_period_dates
from app.schemas.schedule import ScheduleAssignmentCreate
from app.schemas.schedule import SchedulePeriodCreate


def test_schedule_period_end_date_must_not_precede_start_date() -> None:
    request = SchedulePeriodCreate(
        name="Week of May 4",
        start_date=date(2026, 5, 4),
        end_date=date(2026, 5, 3),
    )

    with pytest.raises(HTTPException) as error:
        validate_schedule_period_dates(request)

    assert error.value.status_code == 400


def test_create_assignment_from_request_maps_provider_slot_fields() -> None:
    schedule_period_id = uuid4()
    schedule_version_id = uuid4()
    organization_id = uuid4()
    provider_id = uuid4()
    center_id = uuid4()
    room_id = uuid4()
    start_time = datetime(2026, 5, 4, 7, 0, tzinfo=UTC)
    end_time = datetime(2026, 5, 4, 15, 0, tzinfo=UTC)
    request = ScheduleAssignmentCreate(
        provider_id=provider_id,
        center_id=center_id,
        room_id=room_id,
        shift_requirement_id=None,
        required_provider_type="doctor",
        start_time=start_time,
        end_time=end_time,
        source="manual",
        notes="Keep this provider assigned.",
    )

    assignment = create_assignment_from_request(
        request,
        schedule_period_id,
        schedule_version_id,
        organization_id,
    )

    assert assignment.organization_id == organization_id
    assert assignment.schedule_period_id == schedule_period_id
    assert assignment.schedule_version_id == schedule_version_id
    assert assignment.provider_id == provider_id
    assert assignment.center_id == center_id
    assert assignment.room_id == room_id
    assert assignment.required_provider_type == "doctor"
    assert assignment.assignment_status == "draft"
    assert assignment.source == "manual"


def test_create_assignment_from_request_allows_unassigned_provider() -> None:
    schedule_period_id = uuid4()
    schedule_version_id = uuid4()
    organization_id = uuid4()
    center_id = uuid4()
    room_id = uuid4()
    start_time = datetime(2026, 5, 4, 7, 0, tzinfo=UTC)
    end_time = datetime(2026, 5, 4, 15, 0, tzinfo=UTC)
    request = ScheduleAssignmentCreate(
        provider_id=None,
        center_id=center_id,
        room_id=room_id,
        shift_requirement_id=None,
        required_provider_type="doctor",
        start_time=start_time,
        end_time=end_time,
        source="manual",
        notes="Provider still needs to be assigned.",
    )

    assignment = create_assignment_from_request(
        request,
        schedule_period_id,
        schedule_version_id,
        organization_id,
    )

    assert assignment.provider_id is None
    assert assignment.center_id == center_id
    assert assignment.room_id == room_id
    assert assignment.assignment_status == "draft"


def test_unassigned_provider_violation_blocks_publish() -> None:
    violation = unassigned_provider_violation()

    assert violation.severity == "hard_violation"
    assert violation.constraint_type == "provider_assignment_required"
