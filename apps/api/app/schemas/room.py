from uuid import UUID

from pydantic import BaseModel
from pydantic import ConfigDict

from app.schemas.common import TimestampedSchema


class RoomBase(BaseModel):
    name: str
    display_order: int = 0


class RoomCreate(RoomBase):
    pass


class RoomUpdate(BaseModel):
    name: str | None = None
    display_order: int | None = None


class RoomRead(TimestampedSchema, RoomBase):
    center_id: UUID
    is_active: bool

    model_config = ConfigDict(from_attributes=True)
