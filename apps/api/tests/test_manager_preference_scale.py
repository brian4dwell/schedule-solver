import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from uuid import uuid4

from app.db.models import ManagerProviderCenterPreference
from app.routers.preferences import read_manager_provider_preferences
from app.routers.preferences import replace_manager_provider_preferences
from app.schemas.preferences import ManagerProviderCenterPreferenceUpsert
from app.schemas.preferences import ManagerProviderPreferencesReplace
from app.schemas.preferences import ProviderCenterPreferenceUpsert
from app.schemas.preferences import ProviderShiftTypePreferenceUpsert
from app.services.scheduling.solver_contracts import SolverManagerCenterPreference
from app.services.scheduling.solver_input_builder import solver_manager_center_preferences
from conftest import SchedulingDatabase


@pytest.mark.parametrize("level", range(-5, 6))
def test_manager_preference_round_trips_into_solver(
    scheduling_database: SchedulingDatabase,
    level: int,
) -> None:
    database = scheduling_database
    preference = ManagerProviderCenterPreferenceUpsert(
        center_id=database.center.id,
        preference_level=level,
        manager_note="Manager context",
    )
    request = ManagerProviderPreferencesReplace(center_preferences=[preference])
    saved = replace_manager_provider_preferences(
        database.provider.id, request, database.session, database.organization.id,
    )
    assert saved.center_preferences[0].preference_level == level

    database.session.expire_all()
    reloaded = read_manager_provider_preferences(
        database.provider.id, database.session, database.organization.id,
    )
    assert reloaded.center_preferences[0].preference_level == level
    assert reloaded.center_preferences[0].manager_note == "Manager context"

    statement = select(ManagerProviderCenterPreference)
    rows = database.session.scalars(statement).all()
    solver_preferences = solver_manager_center_preferences(database.provider, list(rows))
    assert solver_preferences[0].preference_level == level


@pytest.mark.parametrize("level", [-6, 6, -1.5, 1.5])
def test_manager_preference_rejects_invalid_levels(level: float) -> None:
    center_id = uuid4()
    with pytest.raises(ValidationError):
        ManagerProviderCenterPreferenceUpsert(center_id=center_id, preference_level=level)
    with pytest.raises(ValidationError):
        SolverManagerCenterPreference(center_id=center_id, preference_level=level)


@pytest.mark.parametrize("level", [-5, -4, 4, 5])
def test_provider_preferences_keep_existing_range(level: int) -> None:
    center_id = uuid4()
    with pytest.raises(ValidationError):
        ProviderCenterPreferenceUpsert(center_id=center_id, preference_level=level)
    with pytest.raises(ValidationError):
        ProviderShiftTypePreferenceUpsert(shift_type="full_shift", preference_level=level)


@pytest.mark.parametrize("level", [-6, 6])
def test_database_rejects_out_of_range_manager_preferences(
    scheduling_database: SchedulingDatabase,
    level: int,
) -> None:
    database = scheduling_database
    preference = ManagerProviderCenterPreference(
        organization_id=database.organization.id,
        provider_id=database.provider.id,
        center_id=database.center.id,
        preference_level=level,
    )
    database.session.add(preference)
    with pytest.raises(IntegrityError):
        database.session.flush()
    database.session.rollback()
