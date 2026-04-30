from uuid import UUID

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from app.schemas.common import TimestampedSchema


class RoomTypeBase(BaseModel):
    name: str
    display_order: int = 0


class RoomTypeCreate(RoomTypeBase):
    pass


class RoomTypeUpdate(BaseModel):
    name: str | None = None
    display_order: int | None = None


class RoomTypeRead(TimestampedSchema, RoomTypeBase):
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class RoomBase(BaseModel):
    name: str
    display_order: int = 0
    md_only: bool = False


class RoomCreate(RoomBase):
    room_type_ids: list[UUID] = Field(default_factory=list)


class RoomUpdate(BaseModel):
    name: str | None = None
    display_order: int | None = None
    md_only: bool | None = None
    room_type_ids: list[UUID] | None = None


class RoomRead(TimestampedSchema, RoomBase):
    center_id: UUID
    is_active: bool
    room_types: list[RoomTypeRead] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)
