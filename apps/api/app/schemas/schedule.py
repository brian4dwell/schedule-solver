from datetime import date
from datetime import datetime
from datetime import time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from app.schemas.common import TimestampedSchema
from app.services.scheduling.provider_eligibility_contracts import ProviderEligibilityViolation
from app.services.scheduling.solver_contracts import SolverRunMetrics

ScheduleTemplateWeekday = Literal[
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]

ScheduleShiftType = Literal[
    "full_shift",
    "first_half",
    "second_half",
    "short_shift",
]


class ProviderEligibilityRequest(BaseModel):
    schedule_period_id: UUID
    schedule_version_id: UUID | None = None
    assignment_id: UUID | None = None
    provider_id: UUID
    center_id: UUID
    room_id: UUID | None = None
    required_provider_type: str | None = None
    shift_type: str = "full_shift"
    start_time: datetime
    end_time: datetime


class ScheduleAssignmentCreate(BaseModel):
    room_slot_id: UUID
    allow_slot_date_change: bool = False
    provider_id: UUID | None
    center_id: UUID
    room_id: UUID | None = None
    shift_requirement_id: UUID | None = None
    required_provider_type: str | None = None
    shift_type: str = "full_shift"
    schedule_date: date
    start_time: datetime
    end_time: datetime
    source: str = "manual"
    notes: str | None = None


class ScheduleDraftSaveRequest(BaseModel):
    schedule_period_id: UUID
    parent_schedule_version_id: UUID | None = None
    notes: str | None = None
    assignments: list[ScheduleAssignmentCreate] = Field(default_factory=list)


class ScheduleGenerateRequest(BaseModel):
    parent_schedule_version_id: UUID | None = None
    notes: str | None = None
    assignments: list[ScheduleAssignmentCreate] | None = None


class SchedulePeriodCreate(BaseModel):
    name: str
    start_date: date
    end_date: date
    status: str = "draft"


class SchedulePeriodRenameRequest(BaseModel):
    name: str = Field(min_length=1)


class ScheduleStructureTemplateSlotWrite(BaseModel):
    weekday: ScheduleTemplateWeekday
    room_id: UUID
    shift_type: ScheduleShiftType
    start_time: time
    end_time: time
    display_order: int = Field(ge=0)


class ScheduleStructureTemplateWrite(BaseModel):
    name: str = Field(min_length=1)
    slots: list[ScheduleStructureTemplateSlotWrite] = Field(default_factory=list)


class ScheduleStructureTemplateSlotRead(TimestampedSchema):
    template_id: UUID
    weekday: ScheduleTemplateWeekday
    room_id: UUID
    shift_type: ScheduleShiftType
    start_time: time
    end_time: time
    display_order: int

    model_config = ConfigDict(from_attributes=True)


class ScheduleStructureTemplateRead(TimestampedSchema):
    name: str
    slots: list[ScheduleStructureTemplateSlotRead] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class ScheduleStructureTemplateApplyRequest(BaseModel):
    schedule_period_id: UUID


class ScheduleStructureTemplateAppliedSlot(BaseModel):
    room_slot_id: UUID
    weekday: ScheduleTemplateWeekday
    room_id: UUID
    center_id: UUID
    shift_type: ScheduleShiftType
    schedule_date: date
    start_time: datetime
    end_time: datetime
    display_order: int


class ScheduleStructureTemplateSkippedSlot(BaseModel):
    weekday: ScheduleTemplateWeekday
    room_id: UUID
    reason: str
    message: str


class ScheduleStructureTemplateApplyResponse(BaseModel):
    template: ScheduleStructureTemplateRead
    applied_slots: list[ScheduleStructureTemplateAppliedSlot] = Field(default_factory=list)
    skipped_slots: list[ScheduleStructureTemplateSkippedSlot] = Field(default_factory=list)


class SchedulePeriodRead(TimestampedSchema):
    name: str
    start_date: date
    end_date: date
    status: str

    model_config = ConfigDict(from_attributes=True)


class AssignmentRead(TimestampedSchema):
    room_slot_id: UUID
    schedule_version_id: UUID
    schedule_period_id: UUID
    provider_id: UUID | None
    center_id: UUID
    room_id: UUID | None
    shift_requirement_id: UUID | None
    required_provider_type: str | None
    shift_type: str
    schedule_date: date
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


class CalendarAvailabilityEmailRecipientRead(BaseModel):
    provider_id: UUID
    recipient_email: str
    gmail_message_id: str
    sent_at: datetime


class CalendarAvailabilityEmailSendRead(BaseModel):
    schedule_period: SchedulePeriodRead
    sent_count: int
    recipients: list[CalendarAvailabilityEmailRecipientRead] = Field(default_factory=list)


class SchedulePeriodCloneResponse(BaseModel):
    schedule_period: SchedulePeriodRead
    schedule_version: ScheduleDraftSaveResponse


class ScheduleGenerateResponse(BaseModel):
    version: ScheduleVersionRead
    assignments: list[AssignmentRead]
    violations: list[ConstraintViolationRead]
    metrics: SolverRunMetrics
    is_feasible: bool


class SchedulePublishResponse(BaseModel):
    version: ScheduleVersionRead
    violations: list[ProviderEligibilityViolation]
