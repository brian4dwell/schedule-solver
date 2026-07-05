from datetime import UTC
from datetime import date
from datetime import datetime
from datetime import time
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.db.models import Assignment
from app.db.models import Provider
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import Room
from app.db.models import SchedulePeriod
from app.db.models import ScheduleStructureTemplate
from app.db.models import ScheduleStructureTemplateSlot
from app.db.models import ScheduleVersion
from app.routers.schedules import applied_template_slot
from app.routers.schedules import clone_schedule_period_name
from app.routers.schedules import create_assignment_from_request
from app.routers.schedules import create_template_slot
from app.routers.schedules import duplicate_assignment_request
from app.routers.schedules import duplicate_assignment_requests
from app.routers.schedules import normalized_template_name
from app.routers.schedules import require_open_schedule_period
from app.routers.schedules import require_unique_template_name
from app.routers.schedules import router
from app.routers.schedules import schedule_date_for_template_weekday
from app.routers.schedules import skipped_template_slot
from app.routers.schedules import stable_assignment_request
from app.routers.schedules import unassigned_provider_violation
from app.routers.schedules import validate_schedule_period_dates
from app.schemas.schedule import ScheduleStructureTemplateSlotWrite
from app.schemas.schedule import ScheduleAssignmentCreate
from app.schemas.schedule import SchedulePeriodCreate
from app.services.scheduling.availability_service import create_cloned_weekly_availability_row
from app.services.scheduling.shift_request_warning_service import shift_request_constraint_violations_for_provider


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


def test_schedule_period_route_accepts_clone() -> None:
    period_routes = [
        route
        for route in router.routes
        if route.path == "/schedule-periods/{period_id}/clone"
    ]
    clone_routes = [
        route
        for route in period_routes
        if "POST" in route.methods
    ]

    assert len(clone_routes) == 1


def test_schedule_structure_template_routes_are_registered() -> None:
    template_routes = [
        route
        for route in router.routes
        if route.path == "/schedule-structure-templates"
    ]
    list_routes = [
        route
        for route in template_routes
        if "GET" in route.methods
    ]
    create_routes = [
        route
        for route in template_routes
        if "POST" in route.methods
    ]

    assert len(list_routes) == 1
    assert len(create_routes) == 1


def test_schedule_structure_template_member_routes_are_registered() -> None:
    template_routes = [
        route
        for route in router.routes
        if route.path == "/schedule-structure-templates/{template_id}"
    ]
    update_routes = [
        route
        for route in template_routes
        if "PUT" in route.methods
    ]
    delete_routes = [
        route
        for route in template_routes
        if "DELETE" in route.methods
    ]
    apply_routes = [
        route
        for route in router.routes
        if route.path == "/schedule-structure-templates/{template_id}/apply"
    ]

    assert len(update_routes) == 1
    assert len(delete_routes) == 1
    assert len(apply_routes) == 1


class TemplateNameSession:
    def __init__(self, template: ScheduleStructureTemplate | None) -> None:
        self.template = template

    def scalar(self, _statement) -> ScheduleStructureTemplate | None:
        return self.template


def test_template_name_is_required() -> None:
    with pytest.raises(HTTPException) as error:
        normalized_template_name("   ")

    assert error.value.status_code == 400


def test_duplicate_template_name_is_rejected() -> None:
    organization_id = uuid4()
    template = ScheduleStructureTemplate(
        id=uuid4(),
        organization_id=organization_id,
        name="Standard Week",
    )
    session = TemplateNameSession(template)

    with pytest.raises(HTTPException) as error:
        require_unique_template_name("Standard Week", organization_id, session)

    assert error.value.status_code == 409


def test_current_template_name_is_allowed_on_update() -> None:
    organization_id = uuid4()
    template = ScheduleStructureTemplate(
        id=uuid4(),
        organization_id=organization_id,
        name="Standard Week",
    )
    session = TemplateNameSession(template)

    require_unique_template_name(
        "Standard Week",
        organization_id,
        session,
        template.id,
    )


def create_provider_for_shift_requests(display_name: str) -> Provider:
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


def create_schedule_version_for_shift_requests(provider: Provider) -> ScheduleVersion:
    schedule_version = ScheduleVersion(
        id=uuid4(),
        organization_id=provider.organization_id,
        schedule_period_id=uuid4(),
        schedule_job_id=None,
        version_number=1,
        status="draft",
        source="manual",
        parent_schedule_version_id=None,
        published_at=None,
        published_by_user_id=None,
        created_by_user_id=None,
        solver_score=None,
        notes=None,
    )
    return schedule_version


def create_assignment_for_shift_requests(
    provider: Provider,
    schedule_version: ScheduleVersion,
) -> Assignment:
    assignment = Assignment(
        id=uuid4(),
        room_slot_id=uuid4(),
        organization_id=provider.organization_id,
        schedule_version_id=schedule_version.id,
        schedule_period_id=schedule_version.schedule_period_id,
        provider_id=provider.id,
        center_id=uuid4(),
        room_id=uuid4(),
        shift_requirement_id=None,
        required_provider_type=None,
        shift_type="full_shift",
        schedule_date=date(2026, 5, 4),
        start_time=datetime(2026, 5, 4, 7, 0, tzinfo=UTC),
        end_time=datetime(2026, 5, 4, 15, 0, tzinfo=UTC),
        assignment_status="draft",
        source="manual",
        notes=None,
    )
    return assignment


def create_availability_for_shift_requests(
    provider: Provider,
    schedule_version: ScheduleVersion,
    min_shifts_requested: int,
    max_shifts_requested: int,
) -> ProviderScheduleWeekAvailability:
    availability = ProviderScheduleWeekAvailability(
        id=uuid4(),
        organization_id=provider.organization_id,
        schedule_week_id=schedule_version.schedule_period_id,
        provider_id=provider.id,
        weekday="monday",
        availability_options=["full_shift"],
        min_shifts_requested=min_shifts_requested,
        max_shifts_requested=max_shifts_requested,
        min_shifts_requested_units=min_shifts_requested * 2,
        max_shifts_requested_units=max_shifts_requested * 2,
    )
    return availability


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
        schedule_date=date(2026, 5, 4),
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
    assert assignment.schedule_date == date(2026, 5, 4)
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
        schedule_date=date(2026, 5, 4),
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
        schedule_date=date(2026, 5, 4),
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
    assert request.schedule_date == date(2026, 5, 4)
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
        schedule_date=date(2026, 5, 6),
        start_time=start_time,
        end_time=end_time,
        assignment_status="draft",
        source="manual",
        notes=None,
    )

    request = duplicate_assignment_request(assignment)

    assert request.room_slot_id == room_slot_id


def test_duplicate_assignment_requests_copies_each_assignment() -> None:
    schedule_period_id = uuid4()
    schedule_version_id = uuid4()
    organization_id = uuid4()
    first_assignment = Assignment(
        room_slot_id=uuid4(),
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        schedule_version_id=schedule_version_id,
        provider_id=uuid4(),
        center_id=uuid4(),
        room_id=uuid4(),
        shift_requirement_id=None,
        required_provider_type=None,
        shift_type="full_shift",
        schedule_date=date(2026, 5, 4),
        start_time=datetime(2026, 5, 4, 7, 0, tzinfo=UTC),
        end_time=datetime(2026, 5, 4, 15, 0, tzinfo=UTC),
        assignment_status="draft",
        source="manual",
        notes=None,
    )
    second_assignment = Assignment(
        room_slot_id=uuid4(),
        organization_id=organization_id,
        schedule_period_id=schedule_period_id,
        schedule_version_id=schedule_version_id,
        provider_id=uuid4(),
        center_id=uuid4(),
        room_id=uuid4(),
        shift_requirement_id=None,
        required_provider_type=None,
        shift_type="first_half",
        schedule_date=date(2026, 5, 5),
        start_time=datetime(2026, 5, 5, 7, 0, tzinfo=UTC),
        end_time=datetime(2026, 5, 5, 11, 0, tzinfo=UTC),
        assignment_status="draft",
        source="manual",
        notes=None,
    )

    requests = duplicate_assignment_requests([first_assignment, second_assignment])

    assert len(requests) == 2
    assert requests[0].room_slot_id == first_assignment.room_slot_id
    assert requests[1].room_slot_id == second_assignment.room_slot_id


def test_clone_schedule_period_name_marks_copy() -> None:
    schedule_period = SchedulePeriod(
        id=uuid4(),
        organization_id=uuid4(),
        name="Week of May 4",
        start_date=date(2026, 5, 4),
        end_date=date(2026, 5, 10),
        status="draft",
    )

    name = clone_schedule_period_name(schedule_period)

    assert name == "Copy of Week of May 4"


def test_create_cloned_weekly_availability_row_targets_new_period() -> None:
    source_period_id = uuid4()
    target_period_id = uuid4()
    organization_id = uuid4()
    provider_id = uuid4()
    source_availability = ProviderScheduleWeekAvailability(
        id=uuid4(),
        organization_id=organization_id,
        schedule_week_id=source_period_id,
        provider_id=provider_id,
        weekday="monday",
        availability_options=["full_shift"],
        min_shifts_requested=1,
        max_shifts_requested=3,
        min_shifts_requested_units=2,
        max_shifts_requested_units=6,
    )

    availability = create_cloned_weekly_availability_row(
        source_availability,
        target_period_id,
    )

    assert availability.organization_id == organization_id
    assert availability.schedule_week_id == target_period_id
    assert availability.provider_id == provider_id
    assert availability.weekday == "monday"
    assert availability.availability_options == ["full_shift"]
    assert availability.min_shifts_requested == 1
    assert availability.max_shifts_requested == 3
    assert availability.min_shifts_requested_units == 2
    assert availability.max_shifts_requested_units == 6


def test_create_template_slot_maps_write_contract() -> None:
    organization_id = uuid4()
    template_id = uuid4()
    room_id = uuid4()
    request = ScheduleStructureTemplateSlotWrite(
        weekday="monday",
        room_id=room_id,
        shift_type="first_half",
        start_time=time(7, 0),
        end_time=time(11, 0),
        display_order=2,
    )

    slot = create_template_slot(request, template_id, organization_id)

    assert slot.organization_id == organization_id
    assert slot.template_id == template_id
    assert slot.weekday == "monday"
    assert slot.room_id == room_id
    assert slot.shift_type == "first_half"
    assert slot.start_time == time(7, 0)
    assert slot.end_time == time(11, 0)
    assert slot.display_order == 2


def test_template_weekday_maps_to_target_schedule_period_date() -> None:
    schedule_period = SchedulePeriod(
        id=uuid4(),
        organization_id=uuid4(),
        name="Week of July 1",
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 7),
        status="draft",
    )

    schedule_date = schedule_date_for_template_weekday(schedule_period, "monday")

    assert schedule_date == date(2026, 7, 6)


def test_applied_template_slot_maps_room_and_clears_provider_shape() -> None:
    organization_id = uuid4()
    center_id = uuid4()
    room_id = uuid4()
    template_id = uuid4()
    schedule_period = SchedulePeriod(
        id=uuid4(),
        organization_id=organization_id,
        name="Week of May 4",
        start_date=date(2026, 5, 4),
        end_date=date(2026, 5, 10),
        status="draft",
    )
    room = Room(
        id=room_id,
        organization_id=organization_id,
        center_id=center_id,
        name="OR 1",
        display_order=1,
        md_only=False,
        is_active=True,
    )
    slot = ScheduleStructureTemplateSlot(
        id=uuid4(),
        organization_id=organization_id,
        template_id=template_id,
        weekday="monday",
        room_id=room_id,
        shift_type="full_shift",
        start_time=time(7, 0),
        end_time=time(15, 0),
        display_order=0,
    )

    applied_slot = applied_template_slot(slot, room, schedule_period)

    assert applied_slot.room_id == room_id
    assert applied_slot.center_id == center_id
    assert applied_slot.schedule_date == date(2026, 5, 4)
    assert applied_slot.start_time == datetime(2026, 5, 4, 7, 0, tzinfo=UTC)
    assert applied_slot.end_time == datetime(2026, 5, 4, 15, 0, tzinfo=UTC)
    assert not hasattr(applied_slot, "provider_id")


def test_skipped_template_slot_reports_unavailable_room() -> None:
    room_id = uuid4()
    slot = ScheduleStructureTemplateSlot(
        id=uuid4(),
        organization_id=uuid4(),
        template_id=uuid4(),
        weekday="friday",
        room_id=room_id,
        shift_type="full_shift",
        start_time=time(7, 0),
        end_time=time(15, 0),
        display_order=0,
    )

    skipped_slot = skipped_template_slot(slot)

    assert skipped_slot.room_id == room_id
    assert skipped_slot.weekday == "friday"
    assert skipped_slot.reason == "room_unavailable"


def test_stable_assignment_request_preserves_parent_slot_date() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    schedule_version_id = uuid4()
    provider_id = uuid4()
    center_id = uuid4()
    room_id = uuid4()
    room_slot_id = uuid4()
    parent_assignment = Assignment(
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
        schedule_date=date(2026, 5, 4),
        start_time=datetime(2026, 5, 4, 7, 0, tzinfo=UTC),
        end_time=datetime(2026, 5, 4, 15, 0, tzinfo=UTC),
        assignment_status="draft",
        source="manual",
        notes=None,
    )
    requested_assignment = ScheduleAssignmentCreate(
        room_slot_id=room_slot_id,
        provider_id=provider_id,
        center_id=center_id,
        room_id=room_id,
        shift_requirement_id=None,
        required_provider_type=None,
        shift_type="full_shift",
        schedule_date=date(2026, 5, 5),
        start_time=datetime(2026, 5, 5, 8, 30, tzinfo=UTC),
        end_time=datetime(2026, 5, 5, 16, 30, tzinfo=UTC),
        source="manual",
        notes=None,
    )

    stable_assignment = stable_assignment_request(
        requested_assignment,
        [parent_assignment],
    )

    assert stable_assignment.start_time == datetime(2026, 5, 4, 8, 30, tzinfo=UTC)
    assert stable_assignment.end_time == datetime(2026, 5, 4, 16, 30, tzinfo=UTC)
    assert stable_assignment.schedule_date == date(2026, 5, 4)


def test_stable_assignment_request_allows_explicit_slot_date_change() -> None:
    organization_id = uuid4()
    schedule_period_id = uuid4()
    schedule_version_id = uuid4()
    provider_id = uuid4()
    center_id = uuid4()
    room_id = uuid4()
    room_slot_id = uuid4()
    requested_start_time = datetime(2026, 5, 5, 8, 30, tzinfo=UTC)
    requested_end_time = datetime(2026, 5, 5, 16, 30, tzinfo=UTC)
    parent_assignment = Assignment(
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
        schedule_date=date(2026, 5, 4),
        start_time=datetime(2026, 5, 4, 7, 0, tzinfo=UTC),
        end_time=datetime(2026, 5, 4, 15, 0, tzinfo=UTC),
        assignment_status="draft",
        source="manual",
        notes=None,
    )
    requested_assignment = ScheduleAssignmentCreate(
        room_slot_id=room_slot_id,
        allow_slot_date_change=True,
        provider_id=provider_id,
        center_id=center_id,
        room_id=room_id,
        shift_requirement_id=None,
        required_provider_type=None,
        shift_type="full_shift",
        schedule_date=date(2026, 5, 5),
        start_time=requested_start_time,
        end_time=requested_end_time,
        source="manual",
        notes=None,
    )

    stable_assignment = stable_assignment_request(
        requested_assignment,
        [parent_assignment],
    )

    assert stable_assignment.start_time == requested_start_time
    assert stable_assignment.end_time == requested_end_time
    assert stable_assignment.schedule_date == date(2026, 5, 5)


def test_unassigned_provider_violation_blocks_publish() -> None:
    violation = unassigned_provider_violation()

    assert violation.severity == "hard_violation"
    assert violation.constraint_type == "provider_assignment_required"


def test_shift_request_warning_lists_provider_below_minimum() -> None:
    provider = create_provider_for_shift_requests("Avery")
    schedule_version = create_schedule_version_for_shift_requests(provider)
    assignment = create_assignment_for_shift_requests(provider, schedule_version)
    availability = create_availability_for_shift_requests(
        provider,
        schedule_version,
        min_shifts_requested=2,
        max_shifts_requested=3,
    )

    violations = shift_request_constraint_violations_for_provider(
        provider,
        [assignment],
        availability,
        schedule_version,
        provider.organization_id,
    )

    assert len(violations) == 1
    assert violations[0].severity == "warning"
    assert violations[0].assignment_id is None
    assert violations[0].constraint_type == "provider_min_shifts_not_met"
    assert violations[0].message == "Avery is scheduled for 1/2 requested minimum shifts."


def test_shift_request_warning_lists_provider_above_maximum() -> None:
    provider = create_provider_for_shift_requests("Blair")
    schedule_version = create_schedule_version_for_shift_requests(provider)
    first_assignment = create_assignment_for_shift_requests(provider, schedule_version)
    second_assignment = create_assignment_for_shift_requests(provider, schedule_version)
    availability = create_availability_for_shift_requests(
        provider,
        schedule_version,
        min_shifts_requested=0,
        max_shifts_requested=1,
    )

    violations = shift_request_constraint_violations_for_provider(
        provider,
        [first_assignment, second_assignment],
        availability,
        schedule_version,
        provider.organization_id,
    )

    assert len(violations) == 1
    assert violations[0].severity == "warning"
    assert violations[0].assignment_id is None
    assert violations[0].constraint_type == "provider_max_shifts_exceeded"
    assert violations[0].message == "Blair is scheduled for 2/1 requested maximum shifts."


def test_shift_request_warning_uses_half_shift_units() -> None:
    provider = create_provider_for_shift_requests("Casey")
    schedule_version = create_schedule_version_for_shift_requests(provider)
    first_assignment = create_assignment_for_shift_requests(provider, schedule_version)
    second_assignment = create_assignment_for_shift_requests(provider, schedule_version)
    second_assignment.shift_type = "first_half"
    availability = create_availability_for_shift_requests(
        provider,
        schedule_version,
        min_shifts_requested=0,
        max_shifts_requested=1,
    )
    availability.max_shifts_requested_units = 3

    violations = shift_request_constraint_violations_for_provider(
        provider,
        [first_assignment, second_assignment],
        availability,
        schedule_version,
        provider.organization_id,
    )

    assert violations == []


def test_schedule_period_route_accepts_availability_email() -> None:
    period_routes = [
        route
        for route in router.routes
        if route.path == "/schedule-periods/{period_id}/availability-email"
    ]
    email_routes = [
        route
        for route in period_routes
        if "POST" in route.methods
    ]

    assert len(email_routes) == 1


def test_open_schedule_period_rejects_published_week() -> None:
    schedule_period = SchedulePeriod(
        id=uuid4(),
        organization_id=uuid4(),
        name="Week of May 4, 2026",
        start_date=date(2026, 5, 4),
        end_date=date(2026, 5, 10),
        status="published",
    )

    with pytest.raises(HTTPException) as error:
        require_open_schedule_period(schedule_period)

    assert error.value.status_code == 409
