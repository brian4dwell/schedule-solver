from datetime import date
from uuid import UUID

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from app.schemas.provider_availability_week import ProviderAvailabilityDayRead

from app.schemas.schedule_time import ScheduleTimeRange


class MonthlyScheduleAssignmentRead(ScheduleTimeRange):
    assignment_id: UUID
    schedule_period_id: UUID
    schedule_period_name: str
    schedule_version_id: UUID
    schedule_version_number: int
    schedule_version_status: str
    center_id: UUID
    center_name: str
    room_id: UUID | None
    room_name: str | None
    shift_type: str


class MonthlyAvailabilityProviderRead(BaseModel):
    provider_id: UUID
    provider_display_name: str
    schedule_period_id: UUID
    schedule_period_name: str
    options: list[str]
    scheduled_assignments: list[MonthlyScheduleAssignmentRead]


class MonthlyAvailabilityDayRead(BaseModel):
    date: date
    providers: list[MonthlyAvailabilityProviderRead]


class MonthlyScheduleCandidateRead(BaseModel):
    schedule_period_id: UUID
    schedule_period_name: str
    start_date: date
    end_date: date
    latest_schedule_version_id: UUID
    latest_schedule_version_number: int
    latest_schedule_version_status: str
    latest_schedule_version_updated_at: str


class MonthlyScheduleCandidateGroupRead(BaseModel):
    group_key: str
    start_date: date
    end_date: date
    selected_schedule_period_id: UUID
    candidates: list[MonthlyScheduleCandidateRead]


class MonthlyAvailabilityReportRead(BaseModel):
    year: int
    month: int
    start_date: date
    end_date: date
    schedule_candidate_groups: list[MonthlyScheduleCandidateGroupRead]
    days: list[MonthlyAvailabilityDayRead]


class ReportProviderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    display_name: str
    provider_type: str
    employment_type: str
    is_active: bool


class FutureAvailabilityCutoffRead(BaseModel):
    cutoff_date: date
    timezone: str


class FutureAvailabilityDayRead(ProviderAvailabilityDayRead):
    date: date
    is_saved: bool


class FutureAvailabilityWeekRead(BaseModel):
    schedule_period_id: UUID
    name: str
    start_date: date
    end_date: date
    status: str
    has_submission: bool
    is_complete: bool
    unset_weekdays: list[str]
    min_shifts_requested: float
    max_shifts_requested: float
    notes: str | None = Field(max_length=2000)
    days: list[FutureAvailabilityDayRead]


class ProviderFutureAvailabilityReportRead(FutureAvailabilityCutoffRead):
    provider: ReportProviderRead
    weeks: list[FutureAvailabilityWeekRead]
