from uuid import UUID

from pydantic import BaseModel
from pydantic import Field
from pydantic import model_validator

WEEKDAY_VALUES = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]

AVAILABILITY_OPTION_VALUES = [
    "full_shift",
    "first_half",
    "second_half",
    "short_shift",
    "none",
    "unset",
]


class ProviderAvailabilityDayInput(BaseModel):
    weekday: str
    option: str

    @model_validator(mode="after")
    def validate_fields(self) -> "ProviderAvailabilityDayInput":
        weekday_is_valid = self.weekday in WEEKDAY_VALUES
        option_is_valid = self.option in AVAILABILITY_OPTION_VALUES

        if not weekday_is_valid:
            raise ValueError("Invalid weekday")

        if not option_is_valid:
            raise ValueError("Invalid availability option")

        return self


class ProviderWeeklyAvailabilityReplaceRequest(BaseModel):
    days: list[ProviderAvailabilityDayInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_days(self) -> "ProviderWeeklyAvailabilityReplaceRequest":
        day_count = len(self.days)

        if day_count != 7:
            raise ValueError("Exactly seven day rows are required")

        weekdays = [day.weekday for day in self.days]
        unique_weekday_count = len(set(weekdays))

        if unique_weekday_count != 7:
            raise ValueError("Each weekday must appear exactly once")

        return self


class ProviderAvailabilityDayRead(BaseModel):
    weekday: str
    option: str


class ProviderWeeklyAvailabilityRead(BaseModel):
    schedule_week_id: UUID
    provider_id: UUID
    is_locked: bool
    days: list[ProviderAvailabilityDayRead]
