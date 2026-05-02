from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy.dialects.postgresql import JSONB

from app.db.models import SchedulePeriod
from app.db.models import ProviderScheduleWeekAvailability
from app.routers.provider_availability import build_read_response
from app.routers.provider_availability import schedule_week_is_locked
from app.schemas.provider_availability_week import ProviderWeeklyAvailabilityReplaceRequest


def create_schedule_week(status: str) -> SchedulePeriod:
    organization_id = uuid4()
    start_date = date(2026, 5, 4)
    end_date = date(2026, 5, 10)
    schedule_week = SchedulePeriod(
        id=uuid4(),
        organization_id=organization_id,
        name="Week of May 4",
        start_date=start_date,
        end_date=end_date,
        status=status,
    )
    return schedule_week


def test_provider_weekly_availability_requires_seven_unique_days() -> None:
    request_data = {
        "min_shifts_requested": 2,
        "max_shifts_requested": 5,
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
        "min_shifts_requested": 2,
        "max_shifts_requested": 5,
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


def test_provider_weekly_availability_rejects_invalid_shift_request_range() -> None:
    request_data = {
        "min_shifts_requested": 6,
        "max_shifts_requested": 5,
        "days": [
            {"weekday": "monday", "options": ["full_shift"]},
            {"weekday": "tuesday", "options": ["first_half"]},
            {"weekday": "wednesday", "options": ["second_half"]},
            {"weekday": "thursday", "options": ["short_shift"]},
            {"weekday": "friday", "options": ["none"]},
            {"weekday": "saturday", "options": ["unset"]},
            {"weekday": "sunday", "options": ["full_shift"]},
        ],
    }

    with pytest.raises(ValueError):
        ProviderWeeklyAvailabilityReplaceRequest(**request_data)


def test_provider_weekly_availability_rejects_min_above_available_days() -> None:
    request_data = {
        "min_shifts_requested": 6,
        "max_shifts_requested": 6,
        "days": [
            {"weekday": "monday", "options": ["full_shift"]},
            {"weekday": "tuesday", "options": ["first_half"]},
            {"weekday": "wednesday", "options": ["second_half"]},
            {"weekday": "thursday", "options": ["short_shift"]},
            {"weekday": "friday", "options": ["none"]},
            {"weekday": "saturday", "options": ["unset"]},
            {"weekday": "sunday", "options": ["full_shift"]},
        ],
    }

    with pytest.raises(ValueError):
        ProviderWeeklyAvailabilityReplaceRequest(**request_data)


def test_provider_weekly_availability_rejects_max_above_available_days() -> None:
    request_data = {
        "min_shifts_requested": 2,
        "max_shifts_requested": 6,
        "days": [
            {"weekday": "monday", "options": ["full_shift"]},
            {"weekday": "tuesday", "options": ["first_half"]},
            {"weekday": "wednesday", "options": ["second_half"]},
            {"weekday": "thursday", "options": ["short_shift"]},
            {"weekday": "friday", "options": ["none"]},
            {"weekday": "saturday", "options": ["unset"]},
            {"weekday": "sunday", "options": ["full_shift"]},
        ],
    }

    with pytest.raises(ValueError):
        ProviderWeeklyAvailabilityReplaceRequest(**request_data)


def test_provider_weekly_availability_remains_editable_for_draft_week() -> None:
    schedule_week = create_schedule_week("draft")

    is_locked = schedule_week_is_locked(schedule_week)

    assert is_locked is False


def test_provider_weekly_availability_locks_for_published_week() -> None:
    schedule_week = create_schedule_week("published")

    is_locked = schedule_week_is_locked(schedule_week)

    assert is_locked is True


def test_provider_weekly_availability_options_are_stored_as_json() -> None:
    option_column = ProviderScheduleWeekAvailability.__table__.c.availability_options
    option_column_type = option_column.type

    assert isinstance(option_column_type, JSONB)


def test_provider_weekly_availability_read_normalizes_invalid_existing_requests() -> None:
    provider_id = uuid4()
    schedule_week = create_schedule_week("draft")
    rows = [
        ProviderScheduleWeekAvailability(
            organization_id=schedule_week.organization_id,
            schedule_week_id=schedule_week.id,
            provider_id=provider_id,
            weekday="monday",
            availability_options=["unset"],
            min_shifts_requested=3,
            max_shifts_requested=14,
        )
    ]

    response = build_read_response(schedule_week, provider_id, rows)

    assert response.min_shifts_requested == 0
    assert response.max_shifts_requested == 0


def test_provider_weekly_availability_defaults_weekends_to_none() -> None:
    provider_id = uuid4()
    schedule_week = create_schedule_week("draft")
    rows: list[ProviderScheduleWeekAvailability] = []

    response = build_read_response(schedule_week, provider_id, rows)
    day_by_weekday = {day.weekday: day for day in response.days}

    assert day_by_weekday["friday"].options == ["unset"]
    assert day_by_weekday["saturday"].options == ["none"]
    assert day_by_weekday["sunday"].options == ["none"]
