from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from types import SimpleNamespace
from uuid import uuid4

from app.routers.centers import update_center
from app.routers.providers import update_provider
from app.schemas.center import CenterUpdate
from app.schemas.provider import ProviderUpdate


class DummySession:
    def commit(self) -> None:
        return None

    def refresh(self, _value: object) -> None:
        return None


def test_center_nullable_fields_can_be_cleared_with_patch(monkeypatch) -> None:
    center = SimpleNamespace(
        name="Center A",
        address_line_1="123 Main",
        address_line_2="Suite 1",
        city="Chicago",
        state="IL",
        postal_code="60601",
        timezone="America/Chicago",
    )

    def fake_find_center(_center_id, _organization_id, _session):
        return center

    monkeypatch.setattr("app.routers.centers.find_center", fake_find_center)

    request = CenterUpdate(address_line_1=None, city=None, state=None, postal_code=None)
    session = DummySession()

    update_center(uuid4(), request, session, uuid4())

    assert center.address_line_1 is None
    assert center.city is None
    assert center.state is None
    assert center.postal_code is None


def test_provider_nullable_fields_can_be_cleared_with_patch(monkeypatch) -> None:
    provider = SimpleNamespace(
        first_name="Pat",
        last_name="Lee",
        display_name="Pat Lee",
        email="pat@example.com",
        phone="555-0101",
        provider_type="crna",
        employment_type="employee",
        notes="notes",
    )

    def fake_find_provider(_provider_id, _organization_id, _session):
        return provider

    monkeypatch.setattr("app.routers.providers.find_provider", fake_find_provider)

    request = ProviderUpdate(email=None, phone=None, notes=None)
    session = DummySession()

    update_provider(uuid4(), request, session, uuid4())

    assert provider.email is None
    assert provider.phone is None
    assert provider.notes is None
