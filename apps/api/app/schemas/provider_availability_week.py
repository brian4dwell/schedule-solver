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

WORK_AVAILABILITY_OPTION_VALUES = [
    "full_shift",
    "first_half",
    "second_half",
    "short_shift",
]


def options_include_work_availability(options: list[str]) -> bool:
    has_work_option = any(option in WORK_AVAILABILITY_OPTION_VALUES for option in options)
    return has_work_option


def day_has_work_availability(day: "ProviderAvailabilityDayInput") -> bool:
    has_work_option = options_include_work_availability(day.options)
    return has_work_option


def count_work_available_days(days: list["ProviderAvailabilityDayInput"]) -> int:
    work_available_days = [day for day in days if day_has_work_availability(day)]
    work_available_day_count = len(work_available_days)
    return work_available_day_count


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
    min_shifts_requested: int = Field(ge=0, le=14)
    max_shifts_requested: int = Field(ge=0, le=14)
    days: list[ProviderAvailabilityDayInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_days(self) -> "ProviderWeeklyAvailabilityReplaceRequest":
        minimum = self.min_shifts_requested
        maximum = self.max_shifts_requested
        range_is_valid = minimum <= maximum
        work_available_day_count = count_work_available_days(self.days)
        minimum_fits_available_days = minimum <= work_available_day_count
        maximum_fits_available_days = maximum <= work_available_day_count
        day_count = len(self.days)

        if not range_is_valid:
            raise ValueError("Minimum shifts requested must be less than or equal to maximum shifts requested")

        if not minimum_fits_available_days:
            raise ValueError("Minimum shifts requested cannot exceed available work days")

        if not maximum_fits_available_days:
            raise ValueError("Maximum shifts requested cannot exceed available work days")

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
    min_shifts_requested: int
    max_shifts_requested: int
    days: list[ProviderAvailabilityDayRead]
