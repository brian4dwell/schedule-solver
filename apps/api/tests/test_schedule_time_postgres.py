"""PostgreSQL migration and persistence tests on an explicitly supplied test server.

Set SCHEDULE_TEST_POSTGRES_URL to an isolated server's postgres database.
Each run creates and removes its own uniquely named database.
"""

from dataclasses import dataclass
from datetime import date
from datetime import time
from pathlib import Path
from uuid import UUID
from uuid import uuid4
import importlib.util
import os
import subprocess

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine
from sqlalchemy import select
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session
import pytest

from app.db.models import Center
from app.db.models import Organization
from app.db.models import Provider
from app.db.models import ProviderCenterCredential
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import Room
from app.db.models import SchedulePeriod
from app.db.models import ScheduleVersion
from app.routers.reports import build_monthly_availability_report
from app.routers.schedules import generate_schedule_period
from app.routers.schedules import read_schedule_version
from app.routers.schedules import save_schedule_version
from app.schemas.schedule import ScheduleAssignmentCreate
from app.schemas.schedule import ScheduleDraftSaveRequest
from app.schemas.schedule import ScheduleGenerateRequest
from app.services.scheduling.draft_cleanup import DraftCleanupSelection
from app.services.scheduling.draft_cleanup import apply_draft_cleanup
from app.services.scheduling.draft_cleanup import preview_draft_cleanup


API_ROOT = Path(__file__).resolve().parents[1]
MIGRATION_PATH = API_ROOT / "alembic/versions/202609130002_schedule_wall_clocks.py"


@pytest.fixture(scope="module")
def postgres_engine():
    server_url = os.environ.get("SCHEDULE_TEST_POSTGRES_URL")

    if server_url is None:
        pytest.skip("Set SCHEDULE_TEST_POSTGRES_URL to an isolated PostgreSQL test server.")

    database_name = "schedule_time_test_" + uuid4().hex
    admin_engine = create_engine(server_url, isolation_level="AUTOCOMMIT")
    url = make_url(server_url)
    database_url = url.set(database=database_name)

    with admin_engine.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{database_name}"'))

    engine = create_engine(database_url)

    try:
        environment = os.environ.copy()
        environment["DATABASE_URL"] = database_url.render_as_string(hide_password=False)
        for operation, revision in [("upgrade", "head"), ("downgrade", "202609130001")]:
            subprocess.run(
                ["uv", "run", "alembic", operation, revision],
                cwd=API_ROOT,
                env=environment,
                capture_output=True,
                text=True,
                check=True,
            )
        yield engine
    finally:
        engine.dispose()

        with admin_engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE "{database_name}"'))

        admin_engine.dispose()


@pytest.fixture
def postgres_connection(postgres_engine):
    with postgres_engine.connect() as connection:
        transaction = connection.begin()
        # Keep current ORM configuration columns available while testing legacy slot clocks.
        migrate_controls(connection, "upgrade")
        yield connection
        transaction.rollback()


def migrate(connection, direction: str) -> None:
    spec = importlib.util.spec_from_file_location("wall_clock_migration", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    context = MigrationContext.configure(connection)

    with Operations.context(context):
        operation = getattr(module, direction)
        operation()


def migrate_controls(connection, direction: str) -> None:
    migration_path = API_ROOT / "alembic/versions/202609140003_solver_controls.py"
    spec = importlib.util.spec_from_file_location("solver_controls_migration", migration_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        operation = getattr(module, direction)
        operation()


def test_solver_controls_migration_backfills_existing_organizations(postgres_connection) -> None:
    connection = postgres_connection
    migrate_controls(connection, "downgrade")
    organization_id = uuid4()
    statement = text("INSERT INTO organizations (id, name, created_at, updated_at) VALUES (:id, 'Existing organization', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
    connection.execute(statement, {"id": organization_id})
    migrate_controls(connection, "upgrade")
    row = connection.execute(text("SELECT solver_weights, solver_weights_revision FROM organizations WHERE id = :id"), {"id": organization_id}).one()
    assert row.solver_weights["center_weight"] == 4
    assert row.solver_weights["unfilled_weight"] == 100000
    assert row.solver_weights_revision == 1
    migrate_controls(connection, "downgrade")
    assert connection.execute(text("SELECT name FROM organizations WHERE id = :id"), {"id": organization_id}).scalar_one() == "Existing organization"


@dataclass(frozen=True)
class Seed:
    organization_id: UUID
    period_id: UUID
    version_id: UUID
    room_id: UUID
    center_id: UUID
    provider_id: UUID


def seed(session: Session) -> Seed:
    organization = Organization(name="Time integration")
    session.add(organization)
    session.flush()
    center = Center(organization_id=organization.id, name="Denver", timezone="America/Denver")
    period = SchedulePeriod(organization_id=organization.id, name="Week", start_date=date(2026, 11, 2), end_date=date(2026, 11, 8), status="draft")
    provider = Provider(organization_id=organization.id, first_name="Test", last_name="Provider", display_name="Test Provider", provider_type="doctor", employment_type="employee", email="time@example.com")
    session.add_all([center, period, provider])
    session.flush()
    room = Room(organization_id=organization.id, center_id=center.id, name="Room")
    version = ScheduleVersion(organization_id=organization.id, schedule_period_id=period.id, version_number=1, status="draft", source="manual")
    credential = ProviderCenterCredential(organization_id=organization.id, provider_id=provider.id, center_id=center.id)
    availability = ProviderScheduleWeekAvailability(organization_id=organization.id, provider_id=provider.id, schedule_week_id=period.id, weekday="thursday", availability_options=["full_shift"], min_shifts_requested=0, max_shifts_requested=5, min_shifts_requested_units=0, max_shifts_requested_units=10)
    session.add_all([room, version, credential, availability])
    session.flush()
    return Seed(organization.id, period.id, version.id, room.id, center.id, provider.id)


def insert_old_assignment(connection, data: Seed, start: str, end: str) -> None:
    # SQL bind parameters form the database boundary; no credentials are emitted.
    statement = text("""
        INSERT INTO assignments
            (id, organization_id, room_slot_id, schedule_version_id, schedule_period_id,
             center_id, room_id, schedule_date, start_time, end_time, shift_type,
             assignment_status, source, created_at, updated_at)
        VALUES
            (:id, :organization, :slot, :version, :period, :center, :room,
             '2026-11-05', CAST(:start AS timestamp), CAST(:end AS timestamp),
             'full_shift', 'draft', 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    """)
    connection.execute(statement, {
        "id": uuid4(), "organization": data.organization_id, "slot": uuid4(),
        "version": data.version_id, "period": data.period_id, "center": data.center_id,
        "room": data.room_id, "start": start, "end": end,
    })


@pytest.mark.parametrize("timezone", ["UTC", "America/Denver"])
def test_migration_preserves_wall_clocks_and_downgrade(postgres_connection, timezone: str) -> None:
    connection = postgres_connection
    connection.execute(text("SELECT set_config('TimeZone', :zone, true)"), {"zone": timezone})

    with Session(connection) as session:
        data = seed(session)
        insert_old_assignment(connection, data, "2026-11-05 07:00", "2026-11-05 15:00")
        migrate(connection, "upgrade")
        row = connection.execute(text("SELECT schedule_date, start_time, end_time FROM assignments")).one()
        assert tuple(row) == (date(2026, 11, 5), time(7), time(15))
        constraints = connection.execute(text("SELECT convalidated FROM pg_constraint WHERE conname LIKE 'ck_%_time_range' OR conname LIKE 'ck_%_clock_precision'")).scalars().all()
        assert constraints == [True] * 6
        migrate(connection, "downgrade")
        row = connection.execute(text("SELECT start_time::text, end_time::text FROM assignments")).one()
        assert tuple(row) == ("2026-11-05 07:00:00", "2026-11-05 15:00:00")


@pytest.mark.parametrize("start,end", [("2026-11-05 23:00", "2026-11-05 07:00"), ("2026-11-05 23:00", "2026-11-06 07:00"), ("2026-11-05 07:00:01", "2026-11-05 15:00")])
def test_migration_refuses_invalid_retained_data(postgres_connection, start: str, end: str) -> None:
    connection = postgres_connection

    with Session(connection) as session:
        data = seed(session)
        insert_old_assignment(connection, data, start, end)

        with pytest.raises(DBAPIError, match="Invalid schedule times remain"):
            with connection.begin_nested():
                migrate(connection, "upgrade")

        count = connection.execute(text("SELECT count(*) FROM assignments")).scalar_one()
        assert count == 1


def test_cleanup_old_schema_then_migration_preserves_operational_data(postgres_connection) -> None:
    connection = postgres_connection

    with Session(connection, autoflush=False) as session:
        data = seed(session)
        insert_old_assignment(connection, data, "2026-11-05 23:00", "2026-11-05 07:00")
        selection = DraftCleanupSelection(organization_id=data.organization_id, version_ids=[data.version_id])
        preview = preview_draft_cleanup(selection, session)
        assert preview.assignment_count == 1
        apply_draft_cleanup(selection, session)
        migrate(connection, "upgrade")
        assert connection.execute(text("SELECT count(*) FROM assignments")).scalar_one() == 0
        assert connection.execute(text("SELECT count(*) FROM schedule_versions")).scalar_one() == 0
        assert session.get(SchedulePeriod, data.period_id) is not None
        assert session.scalar(select(ProviderScheduleWeekAvailability)) is not None


def test_real_postgres_save_generate_read_report_round_trip(postgres_connection) -> None:
    connection = postgres_connection
    migrate(connection, "upgrade")

    with Session(connection, autoflush=False, expire_on_commit=False, join_transaction_mode="create_savepoint") as session:
        data = seed(session)
        assignment = ScheduleAssignmentCreate(room_slot_id=uuid4(), provider_id=data.provider_id, center_id=data.center_id, room_id=data.room_id, schedule_date="2026-11-05", start_time="07:00", end_time="15:00")
        parent = None

        for _ in range(10):
            request = ScheduleDraftSaveRequest(schedule_period_id=data.period_id, parent_schedule_version_id=parent, assignments=[assignment])
            saved = save_schedule_version(request, "manual", session, data.organization_id)
            session.expire_all()
            detail = read_schedule_version(saved.version.id, session, data.organization_id)
            serialized = detail.model_dump(mode="json")["assignments"][0]
            assert serialized["start_time"] == "07:00"
            assert serialized["end_time"] == "15:00"
            assignment = ScheduleAssignmentCreate.model_validate(serialized)
            parent = saved.version.id

        request = ScheduleGenerateRequest(parent_schedule_version_id=parent, assignments=[assignment])
        generated = generate_schedule_period(data.period_id, request, session, data.organization_id)
        assert generated.is_feasible
        assert generated.assignments[0].start_time == time(7)
        report = build_monthly_availability_report(data.organization_id, 2026, 11, [], session)
        day = next(day for day in report.days if day.date == date(2026, 11, 5))
        report_assignment = day.providers[0].scheduled_assignments[0]
        assert report_assignment.model_dump(mode="json")["start_time"] == "07:00"

        for invalid_value in ["06:00", "07:00", "24:00", "15:00:01"]:
            with pytest.raises(DBAPIError):
                with connection.begin_nested():
                    connection.execute(text("UPDATE assignments SET end_time = CAST(:clock AS time)"), {"clock": invalid_value})

            with pytest.raises(DBAPIError):
                with connection.begin_nested():
                    connection.execute(text("""
                        INSERT INTO assignments
                            (id, organization_id, room_slot_id, schedule_version_id, schedule_period_id,
                             center_id, room_id, schedule_date, start_time, end_time, shift_type,
                             assignment_status, source, created_at, updated_at)
                        SELECT :id, organization_id, :slot, schedule_version_id, schedule_period_id,
                               center_id, room_id, schedule_date, start_time, CAST(:clock AS time), shift_type,
                               assignment_status, source, created_at, updated_at
                        FROM assignments LIMIT 1
                    """), {"id": uuid4(), "slot": uuid4(), "clock": invalid_value})
