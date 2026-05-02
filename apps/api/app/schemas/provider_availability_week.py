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
    options: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_fields(self) -> "ProviderAvailabilityDayInput":
        weekday_is_valid = self.weekday in WEEKDAY_VALUES
        options_are_valid = all(option in AVAILABILITY_OPTION_VALUES for option in self.options)
        has_unset = "unset" in self.options
        has_none = "none" in self.options
        option_count = len(self.options)
        has_any_option = option_count > 0
        has_exclusive_unset = has_unset and option_count > 1
        has_exclusive_none = has_none and option_count > 1

        if not weekday_is_valid:
            raise ValueError("Invalid weekday")

        if not options_are_valid:
            raise ValueError("Invalid availability option")

        if not has_any_option:
            raise ValueError("At least one availability option is required")

        if has_exclusive_unset:
            raise ValueError("Unset cannot be combined with other options")

        if has_exclusive_none:
            raise ValueError("None cannot be combined with other options")

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
    options: list[str]


class ProviderWeeklyAvailabilityRead(BaseModel):
    schedule_week_id: UUID
    provider_id: UUID
    is_locked: bool
    days: list[ProviderAvailabilityDayRead]
