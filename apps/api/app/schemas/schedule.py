from datetime import date
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from app.schemas.common import TimestampedSchema
from app.services.scheduling.provider_eligibility_contracts import ProviderEligibilityViolation


class ProviderEligibilityRequest(BaseModel):
    schedule_version_id: UUID | None = None
    assignment_id: UUID | None = None
    provider_id: UUID
    center_id: UUID
    room_id: UUID | None = None
    required_provider_type: str | None = None
    start_time: datetime
    end_time: datetime


class ScheduleAssignmentCreate(BaseModel):
    provider_id: UUID | None
    center_id: UUID
    room_id: UUID | None = None
    shift_requirement_id: UUID | None = None
    required_provider_type: str | None = None
    start_time: datetime
    end_time: datetime
    source: str = "manual"
    notes: str | None = None


class ScheduleDraftSaveRequest(BaseModel):
    schedule_period_id: UUID
    parent_schedule_version_id: UUID | None = None
    notes: str | None = None
    assignments: list[ScheduleAssignmentCreate] = Field(default_factory=list)


class SchedulePeriodCreate(BaseModel):
    name: str
    start_date: date
    end_date: date
    status: str = "draft"


class SchedulePeriodRead(TimestampedSchema):
    name: str
    start_date: date
    end_date: date
    status: str

    model_config = ConfigDict(from_attributes=True)


class AssignmentRead(TimestampedSchema):
    schedule_version_id: UUID
    schedule_period_id: UUID
    provider_id: UUID | None
    center_id: UUID
    room_id: UUID | None
    shift_requirement_id: UUID | None
    required_provider_type: str | None
    start_time: datetime
    end_time: datetime
    assignment_status: str
    source: str
    notes: str | None

    model_config = ConfigDict(from_attributes=True)


class ConstraintViolationRead(TimestampedSchema):
    schedule_version_id: UUID
    assignment_id: UUID | None
    severity: str
    constraint_type: str
    message: str
    metadata_json: dict | None

    model_config = ConfigDict(from_attributes=True)


class ScheduleVersionRead(TimestampedSchema):
    schedule_period_id: UUID
    schedule_job_id: UUID | None
    version_number: int
    status: str
    source: str
    parent_schedule_version_id: UUID | None
    published_at: datetime | None
    published_by_user_id: UUID | None
    created_by_user_id: UUID | None
    solver_score: float | None
    notes: str | None

    model_config = ConfigDict(from_attributes=True)


class ScheduleVersionDetailRead(BaseModel):
    version: ScheduleVersionRead
    assignments: list[AssignmentRead]
    violations: list[ConstraintViolationRead]


class ScheduleDraftSaveResponse(BaseModel):
    version: ScheduleVersionRead
    assignments: list[AssignmentRead]
    violations: list[ConstraintViolationRead]


class SchedulePublishResponse(BaseModel):
    version: ScheduleVersionRead
    violations: list[ProviderEligibilityViolation]
