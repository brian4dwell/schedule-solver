from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.routers.preferences import router
from app.routers.preferences import validate_no_duplicate_ids
from app.routers.preferences import validate_no_duplicate_values
from app.schemas.preferences import ManagerProviderPreferencesReplace
from app.schemas.preferences import ProviderPreferencesReplace


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


def test_provider_preferences_replace_rejects_effective_dates() -> None:
    center_id = uuid4()
    center_preference_input = {
        "center_id": center_id,
        "preference_level": 2,
        "effective_start_date": "2026-05-01",
    }
    shift_type_preference_input = {
        "shift_type": "full_shift",
        "preference_level": 3,
        "effective_end_date": "2026-05-31",
    }

    with pytest.raises(ValidationError):
        ProviderPreferencesReplace(
            center_preferences=[center_preference_input],
            shift_type_preferences=[shift_type_preference_input],
        )


def test_manager_preferences_replace_rejects_effective_dates() -> None:
    center_id = uuid4()
    center_preference_input = {
        "center_id": center_id,
        "preference_level": -2,
        "effective_start_date": "2026-07-01",
        "manager_note": "Stable manager preference",
    }

    with pytest.raises(ValidationError):
        ManagerProviderPreferencesReplace(
            center_preferences=[center_preference_input],
        )
