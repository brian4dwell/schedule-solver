from datetime import date
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import model_validator

from app.schemas.provider_availability_week import ProviderAvailabilityDayRead

from app.schemas.schedule_time import ScheduleTimeRange
from app.schemas.schedule_time import WallClock
from app.services.scheduling.provider_eligibility_contracts import ProviderEligibilityViolation


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


class BackupReportDateRange(BaseModel):
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def validate_date_range(self) -> "BackupReportDateRange":
        if self.end_date < self.start_date:
            raise ValueError("End date must be on or after start date.")
        return self


class BackupReportRequest(BackupReportDateRange):
    center_id: UUID | None
    selected_version_ids: list[UUID]
    excluded_period_ids: list[UUID]


class BackupReportVersionRead(BaseModel):
    id: UUID
    version_number: int
    status: str


class BackupReportPeriodRead(BackupReportDateRange):
    id: UUID
    name: str
    versions: list[BackupReportVersionRead]


class BackupReportCenterRead(BaseModel):
    id: UUID
    name: str
    timezone: str
    is_active: bool


class BackupReportOptionsRead(BackupReportDateRange):
    context_start_date: date
    context_end_date: date
    periods: list[BackupReportPeriodRead]
    centers: list[BackupReportCenterRead]


class BackupReportSelectedVersionRead(BackupReportVersionRead):
    schedule_period_id: UUID
    period_name: str
    start_date: date
    end_date: date


class BackupReportExcludedPeriodRead(BackupReportDateRange):
    id: UUID
    name: str


class BackupReportShiftIdentityRead(BaseModel):
    assignment_id: UUID
    schedule_period_id: UUID
    schedule_version_id: UUID
    schedule_date: date
    start_time: WallClock
    end_time: WallClock
    center_id: UUID
    center_name: str | None
    timezone: str | None
    room_id: UUID | None
    room_name: str | None
    shift_type: str


class BackupReportConflictRead(BaseModel):
    shift: BackupReportShiftIdentityRead
    violations: list[ProviderEligibilityViolation]


class BackupReportCandidateRead(BaseModel):
    provider_id: UUID
    display_name: str
    warnings: list[ProviderEligibilityViolation]
    conflicts: list[BackupReportConflictRead]


class BackupReportShiftRead(BackupReportShiftIdentityRead):
    assigned_provider_id: UUID | None
    assigned_provider_name: str | None
    blockers: list[ProviderEligibilityViolation]
    available_replacements: list[BackupReportCandidateRead]
    qualified_but_scheduled: list[BackupReportCandidateRead]


class ShiftBackupProviderReportRead(BackupReportDateRange):
    generated_at: datetime
    center: BackupReportCenterRead | None
    selected_versions: list[BackupReportSelectedVersionRead]
    excluded_periods: list[BackupReportExcludedPeriodRead]
    shifts: list[BackupReportShiftRead]
