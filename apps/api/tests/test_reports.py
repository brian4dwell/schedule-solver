from datetime import date
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.routers.reports import MonthlyAvailabilityRow
from app.routers.reports import monthly_availability_days
from app.routers.reports import month_end_date
from app.routers.reports import router
from app.routers.reports import validate_month
from app.routers.reports import work_options_from_availability_options


def create_monthly_availability_row(
    weekday: str,
    availability_options: list[str],
) -> MonthlyAvailabilityRow:
    row = MonthlyAvailabilityRow(
        schedule_period_id=uuid4(),
        schedule_period_name="Week of May 4",
        schedule_period_start_date=date(2026, 5, 4),
        schedule_period_end_date=date(2026, 5, 10),
        provider_id=uuid4(),
        provider_display_name="Avery Provider",
        weekday=weekday,
        availability_options=availability_options,
    )
    return row


def test_monthly_availability_route_is_registered() -> None:
    report_routes = [
        route
        for route in router.routes
        if route.path == "/reports/monthly-availability"
    ]
    get_routes = [
        route
        for route in report_routes
        if "GET" in route.methods
    ]

    assert len(get_routes) == 1


def test_validate_month_rejects_invalid_month() -> None:
    with pytest.raises(HTTPException) as error:
        validate_month(13)

    assert error.value.status_code == 400


def test_month_end_date_handles_month_length() -> None:
    end_date = month_end_date(2026, 2)

    assert end_date == date(2026, 2, 28)


def test_work_options_keep_report_order() -> None:
    options = ["short_shift", "none", "full_shift"]

    work_options = work_options_from_availability_options(options)

    assert work_options == ["full_shift", "short_shift"]


def test_monthly_availability_days_expands_weekly_rows_to_matching_dates() -> None:
    row = create_monthly_availability_row(
        "monday",
        ["full_shift", "first_half"],
    )

    days = monthly_availability_days(
        date(2026, 5, 1),
        date(2026, 5, 31),
        [row],
    )
    matching_days = [
        day
        for day in days
        if len(day.providers) > 0
    ]
    first_matching_day = matching_days[0]
    provider = first_matching_day.providers[0]

    assert len(days) == 31
    assert len(matching_days) == 1
    assert first_matching_day.date == date(2026, 5, 4)
    assert provider.provider_display_name == "Avery Provider"
    assert provider.options == ["full_shift", "first_half"]


def test_monthly_availability_days_omits_none_and_unset_rows() -> None:
    none_row = create_monthly_availability_row("monday", ["none"])
    unset_row = create_monthly_availability_row("tuesday", ["unset"])

    days = monthly_availability_days(
        date(2026, 5, 1),
        date(2026, 5, 31),
        [none_row, unset_row],
    )
    matching_days = [
        day
        for day in days
        if len(day.providers) > 0
    ]

    assert matching_days == []
