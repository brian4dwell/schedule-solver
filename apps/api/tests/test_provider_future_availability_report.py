from datetime import UTC
from datetime import date
from datetime import datetime
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import delete
from sqlalchemy import event

from app.core.config import Settings
from app.db.models import Organization
from app.db.models import Provider
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import ProviderScheduleWeekNote
from app.db.models import SchedulePeriod
from app.dependencies import require_admin_user
from app.routers import reports
from app.schemas.provider_availability_week import WEEKDAY_VALUES
from app.schemas.reports import FutureAvailabilityCutoffRead
from conftest import SchedulingDatabase


def read_report(database: SchedulingDatabase, cutoff_date: date = date(2026, 9, 16)):
    cutoff = FutureAvailabilityCutoffRead(cutoff_date=cutoff_date, timezone="America/New_York")
    return reports.read_provider_future_availability(
        database.provider.id, database.organization.id, database.session, cutoff,
    )


def add_week(database: SchedulingDatabase, start_date: date, end_date: date, name: str, status: str = "draft"):
    week = SchedulePeriod(
        organization_id=database.organization.id,
        name=name,
        start_date=start_date,
        end_date=end_date,
        status=status,
    )
    database.session.add(week)
    database.session.flush()
    return week


def add_note(database: SchedulingDatabase, week: SchedulePeriod, notes: str):
    note = ProviderScheduleWeekNote(
        organization_id=database.organization.id,
        provider_id=database.provider.id,
        schedule_week_id=week.id,
        notes=notes,
    )
    database.session.add(note)
    return note


def test_current_week_keeps_full_week_requests_notes_and_completion(scheduling_database):
    database = scheduling_database
    database.session.execute(delete(ProviderScheduleWeekAvailability))
    for weekday in WEEKDAY_VALUES:
        options = ["none"]
        if weekday == "monday":
            options = ["full_shift"]
        if weekday == "wednesday":
            options = ["first_half", "second_half", "short_shift"]
        row = ProviderScheduleWeekAvailability(
            organization_id=database.organization.id,
            provider_id=database.provider.id,
            schedule_week_id=database.period.id,
            weekday=weekday,
            availability_options=options,
            min_shifts_requested_units=3,
            max_shifts_requested_units=5,
        )
        database.session.add(row)
    add_note(database, database.period, "Whole week\n<script>plain text</script>")
    database.session.commit()

    report = read_report(database)
    week = report.weeks[0]

    assert report.cutoff_date == date(2026, 9, 16)
    assert report.timezone == "America/New_York"
    assert week.start_date == date(2026, 9, 14)
    assert week.end_date == date(2026, 9, 20)
    assert [day.date for day in week.days] == [date(2026, 9, day) for day in range(16, 21)]
    assert week.days[0].options == ["first_half", "second_half", "short_shift"]
    assert week.days[1].options == ["none"]
    assert all(day.is_saved for day in week.days)
    assert week.min_shifts_requested == 1.5
    assert week.max_shifts_requested == 2.5
    assert week.notes == "Whole week\n<script>plain text</script>"
    assert week.is_complete
    assert week.has_submission


def test_all_future_periods_remain_separate_including_notes_without_rows(scheduling_database):
    database = scheduling_database
    add_week(database, date(2026, 9, 7), date(2026, 9, 13), "Past")
    year_boundary = add_week(database, date(2026, 12, 28), date(2027, 1, 3), "New year")
    overlap = add_week(database, date(2026, 9, 14), date(2026, 9, 20), "Published overlap", "published")
    distant_week = add_week(database, date(2032, 1, 5), date(2032, 1, 11), "Distant week")
    add_note(database, overlap, "Published note")
    add_note(database, distant_week, "x" * 2000)
    database.session.commit()

    report = read_report(database)
    names = [week.name for week in report.weeks]
    published = next(week for week in report.weeks if week.schedule_period_id == overlap.id)
    year_week = next(week for week in report.weeks if week.schedule_period_id == year_boundary.id)

    assert len(report.weeks) == 4
    assert "Past" not in names
    assert names[-2:] == ["New year", "Distant week"]
    assert year_week.days[-1].date == date(2027, 1, 3)
    assert report.weeks[-1].notes == "x" * 2000
    assert published.status == "published"
    assert published.notes == "Published note"
    assert not published.has_submission
    assert not published.is_complete
    assert published.unset_weekdays == WEEKDAY_VALUES[:5]
    assert published.days[0].options == ["unset"]
    assert published.days[-1].options == ["none"]
    assert not any(day.is_saved for day in published.days)


def test_completion_uses_past_weekdays_and_end_date_includes_today(scheduling_database):
    database = scheduling_database
    report = read_report(database, date(2026, 9, 20))
    week = report.weeks[0]

    assert len(week.days) == 1
    assert week.days[0].date == date(2026, 9, 20)
    assert week.has_submission
    assert not week.is_complete
    assert week.unset_weekdays == ["tuesday", "wednesday", "thursday", "friday"]
    assert read_report(database, date(2026, 9, 21)).weeks == []


def test_refresh_reads_latest_and_cleared_notes(scheduling_database):
    database = scheduling_database
    note = add_note(database, database.period, "Before")
    database.session.commit()
    assert read_report(database).weeks[0].notes == "Before"
    note.notes = "After"
    database.session.commit()
    assert read_report(database).weeks[0].notes == "After"
    database.session.delete(note)
    database.session.commit()
    assert read_report(database).weeks[0].notes is None


def test_provider_and_every_query_are_organization_scoped(scheduling_database):
    database = scheduling_database
    other_organization = Organization(name="Other organization")
    database.session.add(other_organization)
    database.session.flush()
    other_provider = Provider(
        organization_id=other_organization.id,
        first_name="Other",
        last_name="Provider",
        display_name="Other Provider",
        provider_type="doctor",
        employment_type="contractor",
    )
    other_week = SchedulePeriod(
        organization_id=other_organization.id,
        name="Private week",
        start_date=date(2026, 9, 14),
        end_date=date(2026, 9, 20),
        status="draft",
    )
    database.session.add_all([other_provider, other_week])
    database.session.flush()
    # The schema permits individually valid foreign keys with inconsistent scopes.
    # Both joined tables must still filter their organization and Provider.
    for organization_id, provider_id in [
        (other_organization.id, database.provider.id),
        (database.organization.id, other_provider.id),
    ]:
        note = ProviderScheduleWeekNote(
            organization_id=organization_id,
            provider_id=provider_id,
            schedule_week_id=database.period.id,
            notes="Private note",
        )
        row = ProviderScheduleWeekAvailability(
            organization_id=organization_id,
            provider_id=provider_id,
            schedule_week_id=database.period.id,
            weekday="wednesday",
            availability_options=["full_shift"],
        )
        database.session.add_all([note, row])
    database.session.commit()

    report = read_report(database)
    providers = reports.list_future_availability_providers(database.organization.id, database.session)

    assert [provider.id for provider in providers] == [database.provider.id]
    assert len(report.weeks) == 1
    assert report.weeks[0].notes is None
    assert report.weeks[0].days[0].options == ["unset"]
    assert not report.weeks[0].days[0].is_saved
    for inaccessible_id in [other_provider.id, uuid4()]:
        with pytest.raises(HTTPException) as error:
            cutoff = FutureAvailabilityCutoffRead(cutoff_date=date(2026, 9, 16), timezone="UTC")
            reports.read_provider_future_availability(
                inaccessible_id, database.organization.id, database.session, cutoff,
            )
        assert error.value.status_code == 404


def test_inactive_providers_and_all_employment_types_remain_discoverable(scheduling_database):
    database = scheduling_database
    database.provider.is_active = False
    database.provider.employment_type = "contractor"
    add_note(database, database.period, "Retained note")
    database.session.commit()

    providers = reports.list_future_availability_providers(database.organization.id, database.session)
    report = read_report(database)

    assert providers[0].id == database.provider.id
    assert not providers[0].is_active
    assert providers[0].employment_type == "contractor"
    assert not report.provider.is_active
    assert report.weeks[0].notes == "Retained note"


def test_report_uses_one_joined_snapshot_for_all_week_data(scheduling_database):
    database = scheduling_database
    for year in range(2027, 2040):
        add_week(database, date(year, 1, 1), date(year, 1, 7), str(year))
    database.session.commit()
    statements: list[str] = []

    def capture_statement(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    engine = database.session.get_bind()
    event.listen(engine, "before_cursor_execute", capture_statement)
    try:
        report = read_report(database)
    finally:
        event.remove(engine, "before_cursor_execute", capture_statement)

    assert len(report.weeks) == 14
    assert len(statements) == 2
    assert "LEFT OUTER JOIN provider_schedule_week_availability" in statements[1]
    assert "LEFT OUTER JOIN provider_schedule_week_notes" in statements[1]


@pytest.mark.parametrize("instant, expected", [
    (datetime(2027, 1, 1, 4, 59, tzinfo=UTC), date(2026, 12, 31)),
    (datetime(2027, 1, 1, 5, 0, tzinfo=UTC), date(2027, 1, 1)),
    (datetime(2026, 9, 16, 3, 59, tzinfo=UTC), date(2026, 9, 15)),
    (datetime(2026, 9, 16, 4, 0, tzinfo=UTC), date(2026, 9, 16)),
])
def test_cutoff_uses_scheduling_timezone_across_midnight(monkeypatch, instant, expected):
    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz):
            return instant.astimezone(tz)

    monkeypatch.setattr(reports, "datetime", FixedDatetime)
    settings = Settings(scheduling_timezone="America/New_York")
    cutoff = reports.future_availability_cutoff(settings)
    assert cutoff.cutoff_date == expected
    assert cutoff.timezone == "America/New_York"


def test_invalid_scheduling_timezone_is_rejected():
    with pytest.raises(ValidationError, match="Scheduling timezone"):
        Settings(scheduling_timezone="Invalid/Timezone")


def test_both_report_endpoints_require_admin_authorization():
    report_routes = [route for route in reports.router.routes if "provider-future-availability" in route.path]
    assert len(report_routes) == 2
    for route in report_routes:
        dependencies = [dependency.call for dependency in route.dependant.dependencies]
        assert require_admin_user in dependencies
        assert route.methods == {"GET"}
