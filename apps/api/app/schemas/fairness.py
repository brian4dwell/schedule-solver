from datetime import datetime
from uuid import UUID

from pydantic import BaseModel
from pydantic import ConfigDict

from app.schemas.common import TimestampedSchema
from app.schemas.schedule import SchedulePeriodRead
from app.schemas.schedule import ScheduleVersionRead


class FairnessConfigVersionRead(TimestampedSchema):
    version_number: int
    status: str
    decay_factor: float
    debt_weight: float
    favor_weight: float
    standard_priority_multiplier: float
    elevated_priority_multiplier: float
    critical_priority_multiplier: float

    model_config = ConfigDict(from_attributes=True)


class ProviderFairnessSnapshotRead(TimestampedSchema):
    provider_id: UUID
    provider_display_name: str
    schedule_period_id: UUID
    schedule_version_id: UUID
    starting_debt: float
    starting_favor_credit: float
    weekly_debt_delta: float
    weekly_favor_delta: float
    ending_debt: float
    ending_favor_credit: float
    fairness_pressure: float
    priority_tier: str
    priority_multiplier: float
    assignment_count: int
    negative_event_count: int
    positive_event_count: int


class ProviderFairnessEventRead(TimestampedSchema):
    provider_id: UUID
    provider_display_name: str
    schedule_period_id: UUID
    schedule_version_id: UUID
    assignment_id: UUID | None
    event_type: str
    category: str
    debt_delta: float
    favor_delta: float
    occurred_at: datetime
    reason: str


class FairnessMetricRead(BaseModel):
    id: str
    label: str
    value: str
    status: str
    detail: str


class FairnessReportRead(BaseModel):
    has_data: bool
    schedule_period: SchedulePeriodRead | None
    schedule_version: ScheduleVersionRead | None
    config: FairnessConfigVersionRead | None
    metrics: list[FairnessMetricRead]
    snapshots: list[ProviderFairnessSnapshotRead]
    events: list[ProviderFairnessEventRead]
