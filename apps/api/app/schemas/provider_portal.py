from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import EmailStr
from pydantic import Field

from app.schemas.common import TimestampedSchema
from app.schemas.provider_availability_week import ProviderWeeklyAvailabilityRead


ProviderAccountState = Literal["invited", "accepted", "linked"]


class ProviderInviteCreate(BaseModel):
    email: EmailStr | None = None


class ProviderInviteRead(TimestampedSchema):
    provider_id: UUID
    email: EmailStr
    invite_token: str
    status: str
    accepted_by_clerk_user_id: str | None
    accepted_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class ProviderInviteAcceptanceRequest(BaseModel):
    invite_token: str = Field(min_length=1)


class ProviderPortalProfileRead(BaseModel):
    provider_id: UUID
    display_name: str
    email: EmailStr | None


class ProviderPortalInviteAcceptanceRead(BaseModel):
    provider: ProviderPortalProfileRead


class ProviderPortalCenterOption(BaseModel):
    center_id: UUID
    name: str


class ProviderPortalPreferenceOptionsRead(BaseModel):
    center_options: list[ProviderPortalCenterOption] = Field(default_factory=list)


class ProviderWeeklyAvailabilityCompletion(BaseModel):
    schedule_week_id: UUID
    schedule_week_name: str
    is_complete: bool
    unset_weekdays: list[str] = Field(default_factory=list)


class AdminProviderStatusRow(BaseModel):
    provider_id: UUID
    provider_name: str
    provider_email: EmailStr | None
    account_state: ProviderAccountState | None
    last_availability_update_at: datetime | None
    open_week_count: int
    incomplete_open_required_week_count: int
    open_week_availability_complete: bool


class ProviderPortalWeekAvailabilityRead(BaseModel):
    schedule_week_id: UUID
    schedule_week_name: str
    availability: ProviderWeeklyAvailabilityRead
    completion: ProviderWeeklyAvailabilityCompletion
