from zoneinfo import ZoneInfo
from zoneinfo import ZoneInfoNotFoundError


def require_timezone(value: str) -> ZoneInfo:
    try:
        zone = ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ValueError("Center timezone must be a valid IANA timezone.") from error

    return zone
