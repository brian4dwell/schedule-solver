from pydantic import BaseModel
from pydantic import ConfigDict

from app.schemas.common import TimestampedSchema


class CenterBase(BaseModel):
    name: str
    address_line_1: str | None = None
    address_line_2: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    timezone: str = "America/New_York"


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


class CenterRead(TimestampedSchema, CenterBase):
    is_active: bool

    model_config = ConfigDict(from_attributes=True)
