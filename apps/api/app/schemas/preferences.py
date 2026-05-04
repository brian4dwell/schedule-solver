from datetime import date
from uuid import UUID

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from app.schemas.common import TimestampedSchema


class PreferenceWindow(BaseModel):
    preference_level: int = Field(ge=-3, le=3)
    effective_start_date: date | None = None
    effective_end_date: date | None = None


class ProviderCenterPreferenceUpsert(PreferenceWindow):
    center_id: UUID


class ProviderShiftTypePreferenceUpsert(PreferenceWindow):
    shift_type: str = Field(min_length=1, max_length=40)


class ManagerProviderCenterPreferenceUpsert(PreferenceWindow):
    center_id: UUID
    manager_note: str | None = None


class ProviderCenterPreferenceRead(TimestampedSchema):
    provider_id: UUID
    center_id: UUID
    preference_level: int
    is_active: bool
    effective_start_date: date | None
    effective_end_date: date | None

    model_config = ConfigDict(from_attributes=True)


class ProviderShiftTypePreferenceRead(TimestampedSchema):
    provider_id: UUID
    shift_type: str
    preference_level: int
    is_active: bool
    effective_start_date: date | None
    effective_end_date: date | None

    model_config = ConfigDict(from_attributes=True)


class ManagerProviderCenterPreferenceRead(TimestampedSchema):
    provider_id: UUID
    center_id: UUID
    preference_level: int
    is_active: bool
    effective_start_date: date | None
    effective_end_date: date | None
    manager_note: str | None

    model_config = ConfigDict(from_attributes=True)


class ProviderPreferencesRead(BaseModel):
    provider_id: UUID
    center_preferences: list[ProviderCenterPreferenceRead]
    shift_type_preferences: list[ProviderShiftTypePreferenceRead]


class ProviderPreferencesReplace(BaseModel):
    center_preferences: list[ProviderCenterPreferenceUpsert] = Field(default_factory=list)
    shift_type_preferences: list[ProviderShiftTypePreferenceUpsert] = Field(default_factory=list)


class ManagerProviderPreferencesRead(BaseModel):
    provider_id: UUID
    center_preferences: list[ManagerProviderCenterPreferenceRead]


class ManagerProviderPreferencesReplace(BaseModel):
    center_preferences: list[ManagerProviderCenterPreferenceUpsert] = Field(default_factory=list)
