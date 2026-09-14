from datetime import date
from datetime import datetime
from datetime import time
from typing import Annotated
from typing import Self
import re

from pydantic import BaseModel
from pydantic import BeforeValidator
from pydantic import PlainSerializer
from pydantic import WithJsonSchema
from pydantic import model_validator


CLOCK_PATTERN = r"(?:[01][0-9]|2[0-3]):[0-5][0-9]"


def parse_clock(value: object) -> time:
    if isinstance(value, str):
        matches = re.fullmatch(CLOCK_PATTERN, value)

        if matches is None:
            raise ValueError("Schedule times must use HH:mm without a date or timezone. Reload an outdated schedule page.")

        value = time.fromisoformat(value)

    if not isinstance(value, time):
        raise ValueError("Schedule times must use HH:mm.")

    has_timezone = value.tzinfo is not None
    has_seconds = value.second != 0 or value.microsecond != 0

    if has_timezone or has_seconds:
        raise ValueError("Schedule times must have minute precision and no timezone.")

    return value


def format_clock(value: time) -> str:
    label = value.isoformat(timespec="minutes")
    return label


def parse_schedule_date(value: object) -> date:
    if isinstance(value, str):
        matches = re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value)

        if matches is None:
            raise ValueError("Schedule dates must use YYYY-MM-DD.")

        value = date.fromisoformat(value)

    if isinstance(value, datetime) or not isinstance(value, date):
        raise ValueError("Schedule dates must use YYYY-MM-DD.")

    return value


ScheduleDate = Annotated[date, BeforeValidator(parse_schedule_date)]
WallClock = Annotated[
    time,
    BeforeValidator(parse_clock),
    PlainSerializer(format_clock, return_type=str),
    WithJsonSchema({"type": "string", "pattern": f"^{CLOCK_PATTERN}$"}),
]


class ClockRange(BaseModel):
    start_time: WallClock
    end_time: WallClock

    @model_validator(mode="after")
    def validate_range(self) -> Self:
        end_is_after_start = self.end_time > self.start_time

        if not end_is_after_start:
            raise ValueError("Slot end time must be after start time on the same schedule date.")

        return self


class ScheduleTimeRange(ClockRange):
    schedule_date: ScheduleDate
