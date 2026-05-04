from datetime import date
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.routers.preferences import router
from app.routers.preferences import validate_no_duplicate_ids
from app.routers.preferences import validate_no_duplicate_values
from app.schemas.preferences import ManagerProviderCenterPreferenceUpsert
from app.schemas.preferences import ManagerProviderPreferencesReplace
from app.schemas.preferences import ProviderCenterPreferenceUpsert
from app.schemas.preferences import ProviderPreferencesReplace
from app.schemas.preferences import ProviderShiftTypePreferenceUpsert


def test_provider_preferences_route_accepts_put() -> None:
    preference_routes = [
        route
        for route in router.routes
        if route.path == "/providers/{provider_id}/preferences"
    ]
    put_routes = [
        route
        for route in preference_routes
        if "PUT" in route.methods
    ]

    assert len(put_routes) == 1


def test_manager_preferences_route_accepts_put() -> None:
    preference_routes = [
        route
        for route in router.routes
        if route.path == "/manager/providers/{provider_id}/preferences"
    ]
    put_routes = [
        route
        for route in preference_routes
        if "PUT" in route.methods
    ]

    assert len(put_routes) == 1


def test_duplicate_center_preference_validation_rejects_duplicate_ids() -> None:
    center_id = uuid4()

    with pytest.raises(HTTPException) as error:
        validate_no_duplicate_ids([center_id, center_id], "Duplicate center preference")

    assert error.value.status_code == 400


def test_duplicate_shift_type_validation_rejects_duplicate_values() -> None:
    with pytest.raises(HTTPException) as error:
        validate_no_duplicate_values(["full_shift", "full_shift"], "Duplicate shift type preference")

    assert error.value.status_code == 400


def test_provider_preferences_replace_accepts_effective_dates() -> None:
    center_id = uuid4()
    center_preference_input = ProviderCenterPreferenceUpsert(
        center_id=center_id,
        preference_level=2,
        effective_start_date="2026-05-01",
        effective_end_date="2026-05-31",
    )
    shift_type_preference_input = ProviderShiftTypePreferenceUpsert(
        shift_type="full_shift",
        preference_level=3,
        effective_start_date="2026-06-01",
        effective_end_date=None,
    )
    request = ProviderPreferencesReplace(
        center_preferences=[center_preference_input],
        shift_type_preferences=[shift_type_preference_input],
    )

    center_preference = request.center_preferences[0]
    shift_type_preference = request.shift_type_preferences[0]

    assert center_preference.effective_start_date == date(2026, 5, 1)
    assert center_preference.effective_end_date == date(2026, 5, 31)
    assert shift_type_preference.effective_start_date == date(2026, 6, 1)
    assert shift_type_preference.effective_end_date is None


def test_manager_preferences_replace_accepts_effective_dates() -> None:
    center_id = uuid4()
    center_preference_input = ManagerProviderCenterPreferenceUpsert(
        center_id=center_id,
        preference_level=-2,
        effective_start_date="2026-07-01",
        effective_end_date="2026-07-31",
        manager_note="Summer coverage only",
    )
    request = ManagerProviderPreferencesReplace(
        center_preferences=[center_preference_input],
    )

    center_preference = request.center_preferences[0]

    assert center_preference.effective_start_date == date(2026, 7, 1)
    assert center_preference.effective_end_date == date(2026, 7, 31)
