from dataclasses import dataclass
from datetime import UTC
from datetime import date
from datetime import datetime
from datetime import time
from uuid import UUID
from zoneinfo import ZoneInfo


class ScheduleTimeError(ValueError):
    pass


@dataclass(frozen=True)
class SlotInstants:
    start: datetime
    end: datetime


def local_datetime(schedule_date: date, clock: time, timezone: str) -> datetime:
    zone = ZoneInfo(timezone)
    naive_value = datetime.combine(schedule_date, clock)
    local_value = naive_value.replace(tzinfo=zone)
    alternate_value = local_value.replace(fold=1)
    utc_value = local_value.astimezone(UTC)
    round_trip = utc_value.astimezone(zone)
    round_trip_clock = round_trip.replace(tzinfo=None)
    ambiguous = local_value.utcoffset() != alternate_value.utcoffset()
    nonexistent = round_trip_clock != naive_value

    if ambiguous or nonexistent:
        raise ScheduleTimeError("Slot time is ambiguous or nonexistent in the center timezone.")

    return local_value


def slot_instants(schedule_date: date, start: time, end: time, timezone: str) -> SlotInstants:
    if end <= start:
        raise ScheduleTimeError("Slot end time must be after start time on the same schedule date.")

    start_value = local_datetime(schedule_date, start, timezone)
    end_value = local_datetime(schedule_date, end, timezone)
    instants = SlotInstants(start=start_value, end=end_value)
    return instants


def ranges_overlap(first_start: datetime, first_end: datetime, second_start: datetime, second_end: datetime) -> bool:
    first_start_utc = first_start.astimezone(UTC)
    first_end_utc = first_end.astimezone(UTC)
    second_start_utc = second_start.astimezone(UTC)
    second_end_utc = second_end.astimezone(UTC)
    starts_before_end = first_start_utc < second_end_utc
    ends_after_start = first_end_utc > second_start_utc
    overlaps = starts_before_end and ends_after_start
    return overlaps


def split_day_pair_is_allowed(first_center: UUID, first_type: str, second_center: UUID, second_type: str) -> bool:
    centers_match = first_center == second_center
    shift_types = {first_type, second_type}
    is_split_pair = shift_types == {"first_half", "second_half"}
    allowed = centers_match and is_split_pair
    return allowed
