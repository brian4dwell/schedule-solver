from datetime import date
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.schemas.common import TimestampedSchema


class ProviderAvailabilityRead(TimestampedSchema):
    provider_id: UUID
    start_time: datetime
    end_time: datetime
    availability_type: str
    notes: str | None


class ShiftRequirementRead(TimestampedSchema):
    center_id: UUID
    room_id: UUID | None
    start_time: datetime
    end_time: datetime
    required_provider_count: int
    required_provider_type: str | None
    notes: str | None


class SchedulePeriodRead(TimestampedSchema):
    name: str
    start_date: date
    end_date: date
    status: str


class ScheduleJobRead(TimestampedSchema):
    schedule_period_id: UUID
    status: str
    started_at: datetime | None
    finished_at: datetime | None
    error_message: str | None


class ScheduleVersionRead(TimestampedSchema):
    schedule_period_id: UUID
    schedule_job_id: UUID | None
    version_number: int
    status: str
    solver_score: float | None
    notes: str | None


class AssignmentRead(TimestampedSchema):
    schedule_version_id: UUID
    schedule_period_id: UUID
    provider_id: UUID
    center_id: UUID
    room_id: UUID | None
    shift_requirement_id: UUID | None
    start_time: datetime
    end_time: datetime
    assignment_status: str
    source: str
    notes: str | None


class ConstraintViolationRead(TimestampedSchema):
    schedule_version_id: UUID
    assignment_id: UUID | None
    severity: str
    constraint_type: str
    message: str
    metadata_json: dict | None
