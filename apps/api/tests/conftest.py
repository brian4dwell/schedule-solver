from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date
from pathlib import Path
import sys

import pytest
from sqlalchemy import create_engine
from sqlalchemy import event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.models import Center
from app.db.models import Organization
from app.db.models import Provider
from app.db.models import ProviderCenterCredential
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import Room
from app.db.models import SchedulePeriod
from app.db.models.scheduling import Base


@compiles(JSONB, "sqlite")
def compile_jsonb_for_sqlite(_type, _compiler, **_kwargs) -> str:
    return "JSON"


@compiles(UUID, "sqlite")
def compile_uuid_for_sqlite(_type, _compiler, **_kwargs) -> str:
    # TEXT prevents numeric UUIDs from being coerced to numbers by SQLite affinity.
    return "TEXT"


@dataclass
class SchedulingDatabase:
    session: Session
    organization: Organization
    center: Center
    room: Room
    provider: Provider
    period: SchedulePeriod


@pytest.fixture
def scheduling_database() -> Iterator[SchedulingDatabase]:
    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record) -> None:
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False, expire_on_commit=False) as session:
        organization = Organization(name="Regression tests")
        session.add(organization)
        session.flush()
        center = Center(organization_id=organization.id, name="Center A", timezone="UTC")
        provider = Provider(
            organization_id=organization.id,
            first_name="Test",
            last_name="Provider",
            display_name="Test Provider",
            provider_type="doctor",
            employment_type="employee",
            email="provider@example.com",
        )
        period = SchedulePeriod(
            organization_id=organization.id,
            name="Test week",
            start_date=date(2026, 9, 14),
            end_date=date(2026, 9, 20),
            status="draft",
        )
        session.add_all([center, provider, period])
        session.flush()
        room = Room(organization_id=organization.id, center_id=center.id, name="Room A")
        credential = ProviderCenterCredential(
            organization_id=organization.id,
            center_id=center.id,
            provider_id=provider.id,
        )
        availability = ProviderScheduleWeekAvailability(
            organization_id=organization.id,
            provider_id=provider.id,
            schedule_week_id=period.id,
            weekday="monday",
            availability_options=["full_shift"],
            min_shifts_requested=0,
            max_shifts_requested=0,
            min_shifts_requested_units=0,
            max_shifts_requested_units=1,
        )
        session.add_all([room, credential, availability])
        session.commit()
        yield SchedulingDatabase(session, organization, center, room, provider, period)
    engine.dispose()
