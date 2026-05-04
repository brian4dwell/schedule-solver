from datetime import UTC
from datetime import date
from datetime import datetime
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.db.models import Assignment
from app.routers.schedules import create_assignment_from_request
from app.routers.schedules import duplicate_assignment_request
from app.routers.schedules import router
from app.routers.schedules import unassigned_provider_violation
from app.routers.schedules import validate_schedule_period_dates
from app.schemas.schedule import ScheduleAssignmentCreate
from app.schemas.schedule import SchedulePeriodCreate


def test_schedule_period_route_accepts_delete() -> None:
    period_routes = [
        route
        for route in router.routes
        if route.path == "/schedule-periods/{period_id}"
    ]
    delete_routes = [
        route
        for route in period_routes
        if "DELETE" in route.methods
    ]

    assert len(delete_routes) == 1


def test_schedule_period_route_accepts_patch() -> None:
    period_routes = [
        route
        for route in router.routes
        if route.path == "/schedule-periods/{period_id}"
    ]
    patch_routes = [
        route
        for route in period_routes
        if "PATCH" in route.methods
    ]

    assert len(patch_routes) == 1


def test_schedule_version_route_accepts_duplicate() -> None:
    version_routes = [
        route
        for route in router.routes
        if route.path == "/schedule-versions/{schedule_version_id}/duplicate"
    ]
    duplicate_routes = [
        route
        for route in version_routes
        if "POST" in route.methods
    ]

    assert len(duplicate_routes) == 1


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
    room_slot_id = uuid4()
    start_time = datetime(2026, 5, 4, 7, 0, tzinfo=UTC)
    end_time = datetime(2026, 5, 4, 15, 0, tzinfo=UTC)
    request = ScheduleAssignmentCreate(
        room_slot_id=room_slot_id,
        provider_id=provider_id,
        center_id=center_id,
        room_id=room_id,
        shift_requirement_id=None,
        required_provider_type="doctor",
        shift_type="first_half",
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
    assert assignment.room_slot_id == room_slot_id
    assert assignment.schedule_period_id == schedule_period_id
    assert assignment.schedule_version_id == schedule_version_id
    assert assignment.provider_id == provider_id
    assert assignment.center_id == center_id
    assert assignment.room_id == room_id
    assert assignment.required_provider_type == "doctor"
    assert assignment.shift_type == "first_half"
    assert assignment.assignment_status == "draft"
    assert assignment.source == "manual"


def test_create_assignment_from_request_allows_unassigned_provider() -> None:
    schedule_period_id = uuid4()
    schedule_version_id = uuid4()
    organization_id = uuid4()
    center_id = uuid4()
    room_id = uuid4()
    room_slot_id = uuid4()
    start_time = datetime(2026, 5, 4, 7, 0, tzinfo=UTC)
    end_time = datetime(2026, 5, 4, 15, 0, tzinfo=UTC)
    request = ScheduleAssignmentCreate(
        room_slot_id=room_slot_id,
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
    assert assignment.room_slot_id == room_slot_id
    assert assignment.center_id == center_id
    assert assignment.room_id == room_id
    assert assignment.assignment_status == "draft"


def test_duplicate_assignment_request_copies_assignment_fields() -> None:
    schedule_period_id = uuid4()
    schedule_version_id = uuid4()
    organization_id = uuid4()
    provider_id = uuid4()
    center_id = uuid4()
    room_id = uuid4()
    room_slot_id = uuid4()
    shift_requirement_id = uuid4()
    start_time = datetime(2026, 5, 4, 7, 0, tzinfo=UTC)
    end_time = datetime(2026, 5, 4, 15, 0, tzinfo=UTC)
    assignment = Assignment(
        room_slot_id=room_slot_id,
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        schedule_version_id=schedule_version_id,
        provider_id=provider_id,
        center_id=center_id,
        room_id=room_id,
        shift_requirement_id=shift_requirement_id,
        required_provider_type="doctor",
        shift_type="first_half",
        start_time=start_time,
        end_time=end_time,
        assignment_status="draft",
        source="manual",
        notes="Preserve this note.",
    )

    request = duplicate_assignment_request(assignment)

    assert request.provider_id == provider_id
    assert request.room_slot_id == room_slot_id
    assert request.center_id == center_id
    assert request.room_id == room_id
    assert request.shift_requirement_id == shift_requirement_id
    assert request.required_provider_type == "doctor"
    assert request.shift_type == "first_half"
    assert request.start_time == start_time
    assert request.end_time == end_time
    assert request.source == "duplicate"
    assert request.notes == "Preserve this note."


def test_duplicate_assignment_request_preserves_stable_room_slot_key() -> None:
    schedule_period_id = uuid4()
    schedule_version_id = uuid4()
    organization_id = uuid4()
    provider_id = uuid4()
    center_id = uuid4()
    room_id = uuid4()
    room_slot_id = uuid4()
    start_time = datetime(2026, 5, 6, 7, 0, tzinfo=UTC)
    end_time = datetime(2026, 5, 6, 15, 0, tzinfo=UTC)
    assignment = Assignment(
        room_slot_id=room_slot_id,
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        schedule_version_id=schedule_version_id,
        provider_id=provider_id,
        center_id=center_id,
        room_id=room_id,
        shift_requirement_id=None,
        required_provider_type=None,
        shift_type="full_shift",
        start_time=start_time,
        end_time=end_time,
        assignment_status="draft",
        source="manual",
        notes=None,
    )

    request = duplicate_assignment_request(assignment)

    assert request.room_slot_id == room_slot_id


def test_unassigned_provider_violation_blocks_publish() -> None:
    violation = unassigned_provider_violation()

    assert violation.severity == "hard_violation"
    assert violation.constraint_type == "provider_assignment_required"
