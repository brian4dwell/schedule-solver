from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import field_validator

from app.core.timezones import require_timezone
from app.schemas.common import TimestampedSchema


class CenterBase(BaseModel):
    name: str
    address_line_1: str | None = None
    address_line_2: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    timezone: str = "America/New_York"

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        require_timezone(value)
        return value


class CenterCreate(CenterBase):
    pass


class CenterUpdate(BaseModel):
    name: str | None = None
    address_line_1: str | None = None
    address_line_2: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    timezone: str | None = None

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("Center timezone cannot be null.")

        require_timezone(value)
        return value


class CenterRead(TimestampedSchema, CenterBase):
    is_active: bool

    model_config = ConfigDict(from_attributes=True)
