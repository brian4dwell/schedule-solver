from datetime import date
from uuid import UUID

from pydantic import BaseModel

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
