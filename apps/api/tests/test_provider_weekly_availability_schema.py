import pytest

from app.schemas.provider_availability_week import ProviderWeeklyAvailabilityReplaceRequest


def test_provider_weekly_availability_requires_seven_unique_days() -> None:
    request_data = {
        "days": [
            {"weekday": "monday", "option": "full_shift"},
            {"weekday": "tuesday", "option": "first_half"},
            {"weekday": "wednesday", "option": "second_half"},
            {"weekday": "thursday", "option": "short_shift"},
            {"weekday": "friday", "option": "none"},
            {"weekday": "saturday", "option": "unset"},
            {"weekday": "sunday", "option": "full_shift"},
        ]
    }

    request = ProviderWeeklyAvailabilityReplaceRequest(**request_data)

    assert len(request.days) == 7


def test_provider_weekly_availability_rejects_duplicate_weekday() -> None:
    request_data = {
        "days": [
            {"weekday": "monday", "option": "full_shift"},
            {"weekday": "monday", "option": "first_half"},
            {"weekday": "wednesday", "option": "second_half"},
            {"weekday": "thursday", "option": "short_shift"},
            {"weekday": "friday", "option": "none"},
            {"weekday": "saturday", "option": "unset"},
            {"weekday": "sunday", "option": "full_shift"},
        ]
    }

    with pytest.raises(ValueError):
        ProviderWeeklyAvailabilityReplaceRequest(**request_data)
