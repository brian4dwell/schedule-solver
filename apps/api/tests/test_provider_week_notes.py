from datetime import date
from datetime import datetime
from importlib.util import module_from_spec
from importlib.util import spec_from_file_location
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from app.core.auth import local_development_user
from app.db.models import Provider
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import ProviderScheduleWeekNote
from app.db.models import SchedulePeriod
from app.dependencies import CurrentProvider
from app.routers.provider_availability import delete_provider_weekly_availability
from app.routers.provider_availability import read_provider_weekly_availability
from app.routers.provider_availability import replace_provider_weekly_availability
from app.routers.provider_portal import availability_completion
from app.routers.provider_portal import list_admin_provider_status
from app.routers.provider_portal import read_current_provider_weekly_availability
from app.routers.provider_portal import replace_current_provider_weekly_availability
from app.routers.schedules import delete_weekly_availability_for_period
from app.schemas.provider_availability_week import ProviderAvailabilityDayInput
from app.schemas.provider_availability_week import ProviderWeeklyAvailabilityReplaceRequest
from app.schemas.provider_availability_week import WEEKDAY_VALUES
from app.services.provider_week_notes import replace_provider_week_notes
from conftest import SchedulingDatabase


def request_with_notes(notes: str | None) -> ProviderWeeklyAvailabilityReplaceRequest:
    days = [ProviderAvailabilityDayInput(weekday=weekday, options=["full_shift"]) for weekday in WEEKDAY_VALUES]
    return ProviderWeeklyAvailabilityReplaceRequest(
        notes=notes,
        min_shifts_requested=0,
        max_shifts_requested=5,
        days=days,
    )


def save_notes(database: SchedulingDatabase, notes: str | None):
    current_provider = CurrentProvider(user=local_development_user(), provider=database.provider)
    request = request_with_notes(notes)
    return replace_current_provider_weekly_availability(
        database.period.id, request, current_provider, database.organization.id, database.session,
    )


def read_notes(database: SchedulingDatabase):
    database.session.expire_all()
    return read_provider_weekly_availability(
        database.period.id, database.provider.id, database.organization.id, database.session,
    )


@pytest.mark.parametrize("notes", [None, "", " \t\n", "line one\n  line two", "<script>alert('test')</script>", "x" * 2000, "😀" * 2000])
def test_notes_round_trip_and_blank_normalization(scheduling_database, notes):
    expected = None if notes is None or notes.strip() == "" else notes
    save_notes(scheduling_database, notes)
    assert read_notes(scheduling_database).notes == expected


def test_notes_are_required_and_oversized_notes_are_rejected():
    payload = request_with_notes(None).model_dump()
    del payload["notes"]
    with pytest.raises(ValidationError):
        ProviderWeeklyAvailabilityReplaceRequest.model_validate(payload)
    for notes in ["x" * 2001, " " * 2001, "😀" * 2001]:
        with pytest.raises(ValidationError):
            request_with_notes(notes)


def test_existing_submission_reads_null_and_notes_can_be_cleared(scheduling_database):
    assert read_notes(scheduling_database).notes is None
    save_notes(scheduling_database, "First note")
    save_notes(scheduling_database, None)
    assert read_notes(scheduling_database).notes is None


def test_admin_saves_preserve_latest_note_and_reset_clears_it(scheduling_database):
    database = scheduling_database
    stale_request = request_with_notes("Admin cannot replace this text")
    save_notes(database, "Provider's latest note")
    stale_request.max_shifts_requested = 4
    result = replace_provider_weekly_availability(
        database.period.id, database.provider.id, stale_request, database.organization.id, database.session,
    )
    assert result.notes == "Provider's latest note"
    assert result.max_shifts_requested == 4
    assert read_notes(database).notes == "Provider's latest note"
    delete_provider_weekly_availability(
        database.period.id, database.provider.id, database.organization.id, database.session,
    )
    reset = read_notes(database)
    assert reset.notes is None
    assert reset.days[0].options == ["unset"]


def test_week_and_provider_notes_are_isolated(scheduling_database):
    database = scheduling_database
    first_week = database.period
    first_provider = database.provider
    second_week = SchedulePeriod(
        organization_id=database.organization.id, name="Second week", status="draft",
        start_date=date(2026, 9, 21), end_date=date(2026, 9, 27),
    )
    second_provider = Provider(
        organization_id=database.organization.id, first_name="Second", last_name="Provider",
        display_name="Second Provider", provider_type="doctor", employment_type="employee",
    )
    database.session.add_all([second_week, second_provider])
    database.session.commit()
    save_notes(database, "First Provider, first week")
    database.period = second_week
    save_notes(database, "First Provider, second week")
    database.period = first_week
    database.provider = second_provider
    save_notes(database, "Second Provider, first week")
    database.provider = first_provider
    assert read_notes(database).notes == "First Provider, first week"
    database.period = second_week
    assert read_notes(database).notes == "First Provider, second week"


def test_other_organization_cannot_read_write_or_reset_notes(scheduling_database):
    database = scheduling_database
    save_notes(database, "Private")
    other_organization_id = uuid4()
    current_provider = CurrentProvider(user=local_development_user(), provider=database.provider)
    with pytest.raises(HTTPException) as error:
        read_current_provider_weekly_availability(database.period.id, current_provider, other_organization_id, database.session)
    assert error.value.status_code == 404
    with pytest.raises(HTTPException) as error:
        replace_current_provider_weekly_availability(database.period.id, request_with_notes("Changed"), current_provider, other_organization_id, database.session)
    assert error.value.status_code == 404
    with pytest.raises(HTTPException) as error:
        delete_provider_weekly_availability(database.period.id, database.provider.id, other_organization_id, database.session)
    assert error.value.status_code == 404
    assert read_notes(database).notes == "Private"


def test_published_weeks_reject_both_writes_and_reset_but_show_notes(scheduling_database):
    database = scheduling_database
    save_notes(database, "Visible when locked")
    database.period.status = "published"
    database.session.commit()
    with pytest.raises(HTTPException) as error:
        save_notes(database, "Changed")
    assert error.value.status_code == 409
    with pytest.raises(HTTPException) as error:
        replace_provider_weekly_availability(database.period.id, database.provider.id, request_with_notes(None), database.organization.id, database.session)
    assert error.value.status_code == 409
    with pytest.raises(HTTPException) as error:
        delete_provider_weekly_availability(database.period.id, database.provider.id, database.organization.id, database.session)
    assert error.value.status_code == 409
    assert read_notes(database).notes == "Visible when locked"


def test_failed_transaction_preserves_days_and_note(scheduling_database, monkeypatch):
    database = scheduling_database
    save_notes(database, "Original")
    original = read_notes(database)

    def fail_commit():
        database.session.flush()
        raise RuntimeError("Save failed")

    monkeypatch.setattr(database.session, "commit", fail_commit)
    request = request_with_notes("Changed")
    request.days[0].options = ["none"]
    current_provider = CurrentProvider(user=local_development_user(), provider=database.provider)
    with pytest.raises(RuntimeError, match="Save failed"):
        replace_current_provider_weekly_availability(database.period.id, request, current_provider, database.organization.id, database.session)
    database.session.rollback()
    assert read_notes(database) == original


def test_note_only_edit_updates_monitor_timestamp_without_new_completion_rule(scheduling_database):
    database = scheduling_database
    replace_provider_week_notes(database.period.id, database.provider.id, database.organization.id, "Context", database.session)
    database.session.commit()
    incomplete = read_notes(database)
    assert not availability_completion(database.period, incomplete).is_complete
    save_notes(database, "First submission")
    statement = select(ProviderScheduleWeekAvailability)
    rows = list(database.session.scalars(statement))
    for row in rows:
        row.updated_at = datetime(2020, 1, 1)
    database.session.commit()
    original = read_notes(database)
    save_notes(database, "Note-only edit")
    changed = read_notes(database)
    assert changed.days == original.days
    assert changed.min_shifts_requested == original.min_shifts_requested
    assert changed.max_shifts_requested == original.max_shifts_requested
    status = list_admin_provider_status(None, None, database.organization.id, database.session)
    assert status[0].last_availability_update_at.year > 2020


def test_note_uniqueness_and_period_cleanup(scheduling_database):
    database = scheduling_database
    save_notes(database, "One note per week")
    duplicate = ProviderScheduleWeekNote(
        organization_id=database.organization.id, provider_id=database.provider.id,
        schedule_week_id=database.period.id, notes="Duplicate",
    )
    database.session.add(duplicate)
    with pytest.raises(IntegrityError):
        database.session.flush()
    database.session.rollback()
    delete_weekly_availability_for_period(database.period.id, database.organization.id, database.session)
    database.session.commit()
    assert read_notes(database).notes is None


def test_week_note_migration_upgrades_and_downgrades(scheduling_database):
    session = scheduling_database.session
    connection = session.connection()
    ProviderScheduleWeekNote.__table__.drop(connection)
    migration_path = Path(__file__).parents[1] / "alembic/versions/202609140001_provider_week_notes.py"
    spec = spec_from_file_location("provider_week_notes_migration", migration_path)
    assert spec is not None
    assert spec.loader is not None
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)
    migration_context = MigrationContext.configure(connection)
    with Operations.context(migration_context):
        migration.upgrade()
        inspector = inspect(connection)
        assert inspector.has_table("provider_schedule_week_notes")
        constraints = inspector.get_unique_constraints("provider_schedule_week_notes")
        assert constraints[0]["column_names"] == ["organization_id", "provider_id", "schedule_week_id"]
        migration.downgrade()
        inspector = inspect(connection)
        assert not inspector.has_table("provider_schedule_week_notes")
