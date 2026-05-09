from calendar import monthrange
from dataclasses import dataclass
from datetime import date
from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Provider
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import SchedulePeriod
from app.db.session import get_db
from app.dependencies import get_current_organization_id
from app.schemas.provider_availability_week import WORK_AVAILABILITY_OPTION_VALUES
from app.schemas.provider_availability_week import WEEKDAY_VALUES
from app.schemas.reports import MonthlyAvailabilityDayRead
from app.schemas.reports import MonthlyAvailabilityProviderRead
from app.schemas.reports import MonthlyAvailabilityReportRead

router = APIRouter(prefix="/reports", tags=["reports"])
MINIMUM_YEAR = 2000
MAXIMUM_YEAR = 2100
MINIMUM_MONTH = 1
MAXIMUM_MONTH = 12


@dataclass(frozen=True)
class MonthlyAvailabilityRow:
    schedule_period_id: UUID
    schedule_period_name: str
    schedule_period_start_date: date
    schedule_period_end_date: date
    provider_id: UUID
    provider_display_name: str
    weekday: str
    availability_options: list[str]


def validate_month(month: int) -> None:
    month_is_too_low = month < MINIMUM_MONTH
    month_is_too_high = month > MAXIMUM_MONTH
    month_is_invalid = month_is_too_low or month_is_too_high

    if month_is_invalid:
        raise HTTPException(status_code=400, detail="Month must be between 1 and 12")


def validate_year(year: int) -> None:
    year_is_too_low = year < MINIMUM_YEAR
    year_is_too_high = year > MAXIMUM_YEAR
    year_is_invalid = year_is_too_low or year_is_too_high

    if year_is_invalid:
        raise HTTPException(status_code=400, detail="Year must be between 2000 and 2100")


def month_start_date(year: int, month: int) -> date:
    validate_year(year)
    validate_month(month)
    start_date = date(year, month, 1)
    return start_date


def month_end_date(year: int, month: int) -> date:
    validate_year(year)
    validate_month(month)
    last_day = monthrange(year, month)[1]
    end_date = date(year, month, last_day)
    return end_date


def dates_between(start_date: date, end_date: date) -> list[date]:
    current_date = start_date
    dates: list[date] = []

    while current_date <= end_date:
        dates.append(current_date)
        next_date = current_date + timedelta(days=1)
        current_date = next_date

    return dates


def weekday_for_date(value: date) -> str:
    weekday_index = value.weekday()
    weekday = WEEKDAY_VALUES[weekday_index]
    return weekday


def work_options_from_availability_options(options: list[str]) -> list[str]:
    work_options: list[str] = []

    for option in WORK_AVAILABILITY_OPTION_VALUES:
        option_is_selected = option in options

        if option_is_selected:
            work_options.append(option)

    return work_options


def monthly_availability_row_from_result(
    schedule_period: SchedulePeriod,
    provider: Provider,
    availability: ProviderScheduleWeekAvailability,
) -> MonthlyAvailabilityRow:
    row = MonthlyAvailabilityRow(
        schedule_period_id=schedule_period.id,
        schedule_period_name=schedule_period.name,
        schedule_period_start_date=schedule_period.start_date,
        schedule_period_end_date=schedule_period.end_date,
        provider_id=provider.id,
        provider_display_name=provider.display_name,
        weekday=availability.weekday,
        availability_options=availability.availability_options,
    )
    return row


def monthly_availability_rows(
    organization_id: UUID,
    start_date: date,
    end_date: date,
    session: Session,
) -> list[MonthlyAvailabilityRow]:
    statement = select(SchedulePeriod, Provider, ProviderScheduleWeekAvailability)
    statement = statement.join(
        ProviderScheduleWeekAvailability,
        ProviderScheduleWeekAvailability.schedule_week_id == SchedulePeriod.id,
    )
    statement = statement.join(
        Provider,
        Provider.id == ProviderScheduleWeekAvailability.provider_id,
    )
    statement = statement.where(SchedulePeriod.organization_id == organization_id)
    statement = statement.where(ProviderScheduleWeekAvailability.organization_id == organization_id)
    statement = statement.where(Provider.organization_id == organization_id)
    statement = statement.where(Provider.is_active.is_(True))
    statement = statement.where(SchedulePeriod.start_date <= end_date)
    statement = statement.where(SchedulePeriod.end_date >= start_date)
    statement = statement.order_by(SchedulePeriod.start_date)
    statement = statement.order_by(Provider.display_name)
    results = session.execute(statement).all()
    rows: list[MonthlyAvailabilityRow] = []

    for schedule_period, provider, availability in results:
        row = monthly_availability_row_from_result(
            schedule_period,
            provider,
            availability,
        )
        rows.append(row)

    return rows


def row_applies_to_date(row: MonthlyAvailabilityRow, value: date) -> bool:
    date_is_after_start = value >= row.schedule_period_start_date
    date_is_before_end = value <= row.schedule_period_end_date
    date_is_inside_period = date_is_after_start and date_is_before_end
    weekday = weekday_for_date(value)
    weekday_matches = weekday == row.weekday
    applies_to_date = date_is_inside_period and weekday_matches
    return applies_to_date


def provider_read_for_row(row: MonthlyAvailabilityRow) -> MonthlyAvailabilityProviderRead | None:
    work_options = work_options_from_availability_options(row.availability_options)
    has_work_options = len(work_options) > 0

    if not has_work_options:
        return None

    provider = MonthlyAvailabilityProviderRead(
        provider_id=row.provider_id,
        provider_display_name=row.provider_display_name,
        schedule_period_id=row.schedule_period_id,
        schedule_period_name=row.schedule_period_name,
        options=work_options,
    )
    return provider


def providers_for_date(
    value: date,
    rows: list[MonthlyAvailabilityRow],
) -> list[MonthlyAvailabilityProviderRead]:
    providers: list[MonthlyAvailabilityProviderRead] = []

    for row in rows:
        row_applies = row_applies_to_date(row, value)

        if not row_applies:
            continue

        provider = provider_read_for_row(row)

        if provider is None:
            continue

        providers.append(provider)

    return providers


def monthly_availability_days(
    start_date: date,
    end_date: date,
    rows: list[MonthlyAvailabilityRow],
) -> list[MonthlyAvailabilityDayRead]:
    month_dates = dates_between(start_date, end_date)
    days: list[MonthlyAvailabilityDayRead] = []

    for month_date in month_dates:
        providers = providers_for_date(month_date, rows)
        day = MonthlyAvailabilityDayRead(date=month_date, providers=providers)
        days.append(day)

    return days


def build_monthly_availability_report(
    organization_id: UUID,
    year: int,
    month: int,
    session: Session,
) -> MonthlyAvailabilityReportRead:
    start_date = month_start_date(year, month)
    end_date = month_end_date(year, month)
    rows = monthly_availability_rows(organization_id, start_date, end_date, session)
    days = monthly_availability_days(start_date, end_date, rows)
    report = MonthlyAvailabilityReportRead(
        year=year,
        month=month,
        start_date=start_date,
        end_date=end_date,
        days=days,
    )
    return report


@router.get("/monthly-availability", response_model=MonthlyAvailabilityReportRead)
def read_monthly_availability_report(
    year: int,
    month: int,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> MonthlyAvailabilityReportRead:
    report = build_monthly_availability_report(
        organization_id,
        year,
        month,
        session,
    )
    return report
