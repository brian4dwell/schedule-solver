from dataclasses import dataclass
from datetime import UTC
from datetime import date
from datetime import datetime
from datetime import time
from uuid import UUID
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import delete
from sqlalchemy import event
from sqlalchemy import select

from app.db.models import Assignment
from app.db.models import Center
from app.db.models import Organization
from app.db.models import Provider
from app.db.models import ProviderCenterCredential
from app.db.models import ProviderRoomTypeSkill
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import RoomRoomType
from app.db.models import RoomType
from app.db.models import SchedulePeriod
from app.db.models import ScheduleVersion
from app.db.models import ShiftRequirement
from app.dependencies import require_admin_user
from app.routers.reports import router
from app.schemas.reports import BackupReportDateRange
from app.schemas.reports import BackupReportRequest
from app.services.shift_backup_report import backup_report_options
from app.services.shift_backup_report import build_shift_backup_report
from conftest import SchedulingDatabase


@dataclass
class BackupDatabase:
    database: SchedulingDatabase
    version: ScheduleVersion
    target: Assignment


def add_version(database: SchedulingDatabase, period: SchedulePeriod, number: int = 1, status: str = "draft"):
    version = ScheduleVersion(
        organization_id=database.organization.id,
        schedule_period_id=period.id,
        version_number=number,
        status=status,
        source="manual",
    )
    database.session.add(version)
    database.session.flush()
    return version


def add_assignment(database: SchedulingDatabase, version: ScheduleVersion, provider_id: UUID | None):
    assignment = Assignment(
        organization_id=database.organization.id,
        schedule_period_id=version.schedule_period_id,
        schedule_version_id=version.id,
        room_slot_id=uuid4(),
        provider_id=provider_id,
        center_id=database.center.id,
        room_id=database.room.id,
        shift_type="full_shift",
        schedule_date=date(2026, 9, 14),
        start_time=time(7),
        end_time=time(15),
        assignment_status="draft",
        source="manual",
    )
    database.session.add(assignment)
    database.session.flush()
    return assignment


@pytest.fixture
def backup_database(scheduling_database):
    database = scheduling_database
    version = add_version(database, database.period)
    target = add_assignment(database, version, None)
    database.session.commit()
    return BackupDatabase(database, version, target)


def request_for(fixture: BackupDatabase) -> BackupReportRequest:
    return BackupReportRequest(
        start_date=date(2026, 9, 14),
        end_date=date(2026, 9, 14),
        center_id=None,
        selected_version_ids=[fixture.version.id],
        excluded_period_ids=[],
    )


def generate(fixture: BackupDatabase, request: BackupReportRequest | None = None):
    if request is None:
        request = request_for(fixture)
    fixture.database.session.commit()
    return build_shift_backup_report(request, fixture.database.organization.id, fixture.database.session)


def test_unassigned_shift_has_available_candidate_with_request_warning(backup_database):
    fixture = backup_database
    report = generate(fixture)
    shift = report.shifts[0]
    assert len(report.shifts) == 1
    assert shift.assigned_provider_id is None
    assert shift.start_time == time(7)
    assert shift.timezone == "UTC"
    assert shift.available_replacements[0].provider_id == fixture.database.provider.id
    assert shift.available_replacements[0].warnings[0].constraint_type == "provider_max_shifts_exceeded"
    assert shift.available_replacements[0].warnings[0].severity == "warning"
    assert report.generated_at.tzinfo == UTC
    assert report.selected_versions[0].id == fixture.version.id


def test_assigned_provider_is_excluded_and_versions_never_mix(backup_database):
    fixture = backup_database
    fixture.target.provider_id = fixture.database.provider.id
    published = add_version(fixture.database, fixture.database.period, 2, "published")
    add_assignment(fixture.database, published, None)
    report = generate(fixture)
    assert len(report.shifts) == 1
    assert report.shifts[0].assignment_id == fixture.target.id
    assert report.shifts[0].assigned_provider_name == "Test Provider"
    assert report.shifts[0].available_replacements == []
    request = request_for(fixture)
    request.selected_version_ids = [published.id]
    published_report = generate(fixture, request)
    assert published_report.selected_versions[0].status == "published"
    assert len(published_report.shifts[0].available_replacements) == 1


@pytest.mark.parametrize("failure", ["missing_credential", "inactive_credential", "expired", "starts_late", "inactive_provider", "missing_availability", "none", "unset", "incompatible", "type", "md_only", "missing_skill", "insufficient_skill"])
def test_hard_qualification_failures_exclude_candidate(backup_database, failure):
    fixture = backup_database
    database = fixture.database
    credential = database.session.scalar(select(ProviderCenterCredential))
    availability = database.session.scalar(select(ProviderScheduleWeekAvailability))
    if failure == "missing_credential":
        database.session.delete(credential)
    if failure == "inactive_credential":
        credential.is_active = False
    if failure == "expired":
        credential.expires_at = datetime(2026, 9, 14, 14, 59, tzinfo=UTC)
    if failure == "starts_late":
        credential.starts_at = datetime(2026, 9, 14, 7, 1, tzinfo=UTC)
    if failure == "inactive_provider":
        database.provider.is_active = False
    if failure == "missing_availability":
        database.session.delete(availability)
    if failure in {"none", "unset"}:
        availability.availability_options = [failure]
    if failure == "incompatible":
        availability.availability_options = ["first_half"]
    if failure == "type":
        fixture.target.required_provider_type = "crna"
    if failure == "md_only":
        database.room.md_only = True
        database.provider.provider_type = "crna"
    if failure in {"missing_skill", "insufficient_skill"}:
        room_type = RoomType(organization_id=database.organization.id, name="Specialty")
        database.session.add(room_type)
        database.session.flush()
        requirement = RoomRoomType(organization_id=database.organization.id, room_id=database.room.id, room_type_id=room_type.id, required_proficiency_level=2)
        database.session.add(requirement)
        if failure == "insufficient_skill":
            skill = ProviderRoomTypeSkill(organization_id=database.organization.id, provider_id=database.provider.id, room_type_id=room_type.id, proficiency_level=1)
            database.session.add(skill)
    report = generate(fixture)
    assert report.shifts[0].available_replacements == []
    assert report.shifts[0].qualified_but_scheduled == []


def test_credential_boundaries_cover_full_interval_and_regeneration_is_current(backup_database):
    fixture = backup_database
    credential = fixture.database.session.scalar(select(ProviderCenterCredential))
    credential.starts_at = datetime(2026, 9, 14, 7, tzinfo=UTC)
    credential.expires_at = datetime(2026, 9, 14, 15, tzinfo=UTC)
    assert len(generate(fixture).shifts[0].available_replacements) == 1
    credential.is_active = False
    assert generate(fixture).shifts[0].available_replacements == []
    credential.is_active = True
    availability = fixture.database.session.scalar(select(ProviderScheduleWeekAvailability))
    availability.availability_options = ["none"]
    assert generate(fixture).shifts[0].available_replacements == []


@pytest.mark.parametrize("other_type, start, end, separate_center, available", [
    ("second_half", 12, 17, False, True),
    ("second_half", 11, 17, False, False),
    ("first_half", 12, 17, False, False),
    ("second_half", 12, 17, True, False),
    ("full_shift", 13, 17, False, False),
])
def test_half_shift_pair_conflicts_use_shared_rules(backup_database, other_type, start, end, separate_center, available):
    fixture = backup_database
    database = fixture.database
    fixture.target.shift_type = "first_half"
    fixture.target.end_time = time(12)
    other = add_assignment(database, fixture.version, database.provider.id)
    other.shift_type = other_type
    other.start_time = time(start)
    other.end_time = time(end)
    if separate_center:
        center = Center(organization_id=database.organization.id, name="Other Center", timezone="UTC")
        database.session.add(center)
        database.session.flush()
        other.center_id = center.id
        other.room_id = None
    request = request_for(fixture)
    request.center_id = database.center.id
    report = generate(fixture, request)
    target = next(shift for shift in report.shifts if shift.assignment_id == fixture.target.id)
    assert bool(target.available_replacements) == available
    assert bool(target.qualified_but_scheduled) != available
    if not available:
        candidate = target.qualified_but_scheduled[0]
        assert candidate.conflicts[0].shift.assignment_id == other.id
        codes = [violation.constraint_type for violation in candidate.conflicts[0].violations]
        assert "provider_same_day_conflict" in codes


def test_multiple_existing_half_shifts_are_never_a_valid_pair(backup_database):
    fixture = backup_database
    fixture.target.shift_type = "first_half"
    fixture.target.end_time = time(10)
    for start, end in [(10, 12), (12, 14)]:
        other = add_assignment(fixture.database, fixture.version, fixture.database.provider.id)
        other.shift_type = "second_half"
        other.start_time = time(start)
        other.end_time = time(end)
    target = next(shift for shift in generate(fixture).shifts if shift.assignment_id == fixture.target.id)
    assert target.available_replacements == []
    assert len(target.qualified_but_scheduled[0].conflicts) == 2


def test_overlapping_periods_need_explicit_resolution_and_cross_period_conflicts(backup_database):
    fixture = backup_database
    database = fixture.database
    period = SchedulePeriod(organization_id=database.organization.id, name="Competing week", start_date=date(2026, 9, 14), end_date=date(2026, 9, 20), status="draft")
    database.session.add(period)
    database.session.flush()
    version = add_version(database, period)
    add_assignment(database, version, database.provider.id)
    with pytest.raises(HTTPException) as error:
        generate(fixture)
    assert error.value.status_code == 400
    request = request_for(fixture)
    request.selected_version_ids.append(version.id)
    report = generate(fixture, request)
    target = next(shift for shift in report.shifts if shift.assignment_id == fixture.target.id)
    assert target.available_replacements == []
    assert target.qualified_but_scheduled[0].conflicts[0].shift.schedule_version_id == version.id
    request.selected_version_ids = [fixture.version.id]
    request.excluded_period_ids = [period.id]
    report = generate(fixture, request)
    assert len(report.shifts[0].available_replacements) == 1
    assert report.excluded_periods[0].id == period.id


def test_neighboring_periods_and_different_local_dates_are_checked(backup_database):
    fixture = backup_database
    database = fixture.database
    database.center.timezone = "Pacific/Kiritimati"
    fixture.target.start_time = time(0)
    fixture.target.end_time = time(2)
    center = Center(organization_id=database.organization.id, name="Western Center", timezone="Etc/GMT+12")
    period = SchedulePeriod(organization_id=database.organization.id, name="Previous period", start_date=date(2026, 9, 6), end_date=date(2026, 9, 12), status="published")
    database.session.add_all([center, period])
    database.session.flush()
    version = add_version(database, period, status="published")
    other = add_assignment(database, version, database.provider.id)
    other.schedule_date = date(2026, 9, 12)
    other.start_time = time(22)
    other.end_time = time(23)
    other.center_id = center.id
    other.room_id = None
    request = request_for(fixture)
    request.selected_version_ids.append(version.id)
    report = generate(fixture, request)
    assert len(report.shifts) == 1
    assert report.shifts[0].available_replacements == []
    conflict = report.shifts[0].qualified_but_scheduled[0].conflicts[0]
    assert conflict.shift.schedule_date == date(2026, 9, 12)
    assert conflict.violations[0].constraint_type == "provider_double_booked"


@pytest.mark.parametrize("problem", ["inactive_center", "inactive_room", "room_center_mismatch", "assignment_outside_period", "invalid_shift_type", "invalid_shift_time"])
def test_invalid_draft_data_returns_blockers_without_candidates(backup_database, problem):
    fixture = backup_database
    database = fixture.database
    request = request_for(fixture)
    if problem == "inactive_center":
        database.center.is_active = False
    if problem == "inactive_room":
        database.room.is_active = False
    if problem == "room_center_mismatch":
        center = Center(organization_id=database.organization.id, name="Different Center", timezone="UTC")
        database.session.add(center)
        database.session.flush()
        database.room.center_id = center.id
    if problem == "assignment_outside_period":
        fixture.target.schedule_date = date(2026, 9, 13)
        request.start_date = date(2026, 9, 13)
    if problem == "invalid_shift_type":
        fixture.target.shift_type = "invalid"
    if problem == "invalid_shift_time":
        database.center.timezone = "Invalid/Zone"
    shift = generate(fixture, request).shifts[0]
    assert problem in [blocker.constraint_type for blocker in shift.blockers]
    assert shift.available_replacements == []
    assert shift.qualified_but_scheduled == []


def test_linked_requirement_is_authoritative_for_provider_type(backup_database):
    fixture = backup_database
    database = fixture.database
    requirement = ShiftRequirement(
        organization_id=database.organization.id,
        center_id=database.center.id,
        room_id=database.room.id,
        schedule_date=date(2026, 9, 14),
        start_time=time(7),
        end_time=time(15),
        required_provider_count=1,
        required_provider_type="crna",
    )
    database.session.add(requirement)
    database.session.flush()
    fixture.target.shift_requirement_id = requirement.id
    fixture.target.required_provider_type = "doctor"
    assert generate(fixture).shifts[0].available_replacements == []
    requirement.required_provider_type = "doctor"
    assert len(generate(fixture).shifts[0].available_replacements) == 1


def test_foreign_ids_duplicate_versions_and_incomplete_choices_are_rejected(backup_database):
    fixture = backup_database
    other_version = add_version(fixture.database, fixture.database.period, 2)
    for versions, exclusions, expected_status in [
        ([uuid4()], [], 404),
        ([fixture.version.id], [uuid4()], 404),
        ([fixture.version.id, fixture.version.id], [], 400),
        ([fixture.version.id, other_version.id], [], 400),
        ([fixture.version.id], [fixture.database.period.id], 400),
        ([], [], 400),
    ]:
        request = request_for(fixture)
        request.selected_version_ids = versions
        request.excluded_period_ids = exclusions
        with pytest.raises(HTTPException) as error:
            generate(fixture, request)
        assert error.value.status_code == expected_status
    request = request_for(fixture)
    request.center_id = uuid4()
    with pytest.raises(HTTPException) as error:
        generate(fixture, request)
    assert error.value.status_code == 404
    with pytest.raises(ValidationError):
        BackupReportDateRange(start_date=date(2026, 9, 15), end_date=date(2026, 9, 14))


def test_every_data_source_is_scoped_and_other_org_choices_are_hidden(backup_database):
    fixture = backup_database
    database = fixture.database
    organization = Organization(name="Other organization")
    database.session.add(organization)
    database.session.flush()
    foreign_center = Center(organization_id=organization.id, name="Private Center", timezone="UTC")
    foreign_period = SchedulePeriod(organization_id=organization.id, name="Private Period", start_date=date(2026, 9, 14), end_date=date(2026, 9, 20), status="draft")
    database.session.add_all([foreign_center, foreign_period])
    database.session.flush()
    foreign_version = ScheduleVersion(organization_id=organization.id, schedule_period_id=foreign_period.id, version_number=1, status="draft", source="manual")
    database.session.add(foreign_version)
    database.session.execute(delete(ProviderCenterCredential))
    foreign_credential = ProviderCenterCredential(organization_id=organization.id, provider_id=database.provider.id, center_id=database.center.id)
    database.session.add(foreign_credential)
    report = generate(fixture)
    assert report.shifts[0].available_replacements == []
    options = backup_report_options(request_for(fixture), database.organization.id, database.session)
    assert [center.name for center in options.centers] == ["Center A"]
    assert [period.name for period in options.periods] == ["Test week"]
    request = request_for(fixture)
    request.selected_version_ids = [foreign_version.id]
    with pytest.raises(HTTPException) as error:
        generate(fixture, request)
    assert error.value.status_code == 404


def test_query_count_is_batched_and_empty_results_are_valid(backup_database):
    fixture = backup_database
    database = fixture.database
    for _index in range(20):
        add_assignment(database, fixture.version, None)
    database.session.commit()
    statements: list[str] = []

    def capture(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    engine = database.session.get_bind()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        report = generate(fixture)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert len(report.shifts) == 21
    assert len(statements) == 11
    request = request_for(fixture)
    request.selected_version_ids = []
    request.excluded_period_ids = [database.period.id]
    assert generate(fixture, request).shifts == []


def test_backup_routes_require_admin_authorization():
    routes = [route for route in router.routes if "shift-backup-providers" in route.path]
    assert len(routes) == 2
    for route in routes:
        dependencies = [dependency.call for dependency in route.dependant.dependencies]
        assert require_admin_user in dependencies
