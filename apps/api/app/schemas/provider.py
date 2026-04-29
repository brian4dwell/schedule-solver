from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import EmailStr

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


class ProviderRead(TimestampedSchema, ProviderBase):
    is_active: bool

    model_config = ConfigDict(from_attributes=True)
