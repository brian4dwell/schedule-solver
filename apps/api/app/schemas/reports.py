from datetime import date
from uuid import UUID

from pydantic import BaseModel


class MonthlyAvailabilityProviderRead(BaseModel):
    provider_id: UUID
    provider_display_name: str
    schedule_period_id: UUID
    schedule_period_name: str
    options: list[str]


class MonthlyAvailabilityDayRead(BaseModel):
    date: date
    providers: list[MonthlyAvailabilityProviderRead]


class MonthlyAvailabilityReportRead(BaseModel):
    year: int
    month: int
    start_date: date
    end_date: date
    days: list[MonthlyAvailabilityDayRead]
