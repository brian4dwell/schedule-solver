import pytest

from app.schemas.provider_availability_week import ProviderWeeklyAvailabilityReplaceRequest


def test_provider_weekly_availability_requires_seven_unique_days() -> None:
    request_data = {
        "days": [
            {"weekday": "monday", "options": ["full_shift"]},
            {"weekday": "tuesday", "options": ["first_half"]},
            {"weekday": "wednesday", "options": ["second_half"]},
            {"weekday": "thursday", "options": ["short_shift"]},
            {"weekday": "friday", "options": ["none"]},
            {"weekday": "saturday", "options": ["unset"]},
            {"weekday": "sunday", "options": ["full_shift"]},
        ]
    }

    request = ProviderWeeklyAvailabilityReplaceRequest(**request_data)

    assert len(request.days) == 7


def test_provider_weekly_availability_rejects_duplicate_weekday() -> None:
    request_data = {
        "days": [
            {"weekday": "monday", "options": ["full_shift"]},
            {"weekday": "monday", "options": ["first_half"]},
            {"weekday": "wednesday", "options": ["second_half"]},
            {"weekday": "thursday", "options": ["short_shift"]},
            {"weekday": "friday", "options": ["none"]},
            {"weekday": "saturday", "options": ["unset"]},
            {"weekday": "sunday", "options": ["full_shift"]},
        ]
    }

    with pytest.raises(ValueError):
        ProviderWeeklyAvailabilityReplaceRequest(**request_data)
