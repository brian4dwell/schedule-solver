from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import EmailStr
from pydantic import Field

from app.schemas.common import TimestampedSchema

ProviderType = Literal["crna", "doctor", "staff", "contractor", "other"]
EmploymentType = Literal["employee", "contractor", "locum", "other"]


class ProviderBase(BaseModel):
    first_name: str
    last_name: str
    display_name: str
    email: EmailStr | None = None
    phone: str | None = None
    provider_type: ProviderType
    employment_type: EmploymentType
    notes: str | None = None
    credentialed_center_ids: list[UUID] = Field(default_factory=list)
    skill_room_type_ids: list[UUID] = Field(default_factory=list)


class ProviderCreate(ProviderBase):
    pass


class ProviderUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    display_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    provider_type: ProviderType | None = None
    employment_type: EmploymentType | None = None
    notes: str | None = None
    credentialed_center_ids: list[UUID] | None = None
    skill_room_type_ids: list[UUID] | None = None


class ProviderRead(TimestampedSchema, ProviderBase):
    is_active: bool

    model_config = ConfigDict(from_attributes=True)
