import uuid
from datetime import date
from datetime import datetime

from sqlalchemy import Boolean
from sqlalchemy import Date
from sqlalchemy import DateTime
from sqlalchemy import ForeignKeyConstraint
from sqlalchemy import ForeignKey
from sqlalchemy import Integer
from sqlalchemy import Numeric
from sqlalchemy import String
from sqlalchemy import Text
from sqlalchemy import UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import registry
from sqlalchemy.orm import relationship

mapper_registry = registry()


class Base(DeclarativeBase):
    registry = mapper_registry


def create_uuid() -> uuid.UUID:
    new_uuid = uuid.uuid4()
    return new_uuid


def current_utc_time() -> datetime:
    now = datetime.utcnow()
    return now


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=current_utc_time, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=current_utc_time,
        onupdate=current_utc_time,
        nullable=False,
    )


class Organization(Base, TimestampMixin):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    clerk_org_id: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("organization_id", "clerk_user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    clerk_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    first_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    role: Mapped[str] = mapped_column(String(40), nullable=False)


class Center(Base, TimestampMixin):
    __tablename__ = "centers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address_line_1: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address_line_2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    state: Mapped[str | None] = mapped_column(String(80), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    timezone: Mapped[str] = mapped_column(String(80), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Room(Base, TimestampMixin):
    __tablename__ = "rooms"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    center_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("centers.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    md_only: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class RoomType(Base, TimestampMixin):
    __tablename__ = "room_types"
    __table_args__ = (UniqueConstraint("organization_id", "name"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class RoomRoomType(Base, TimestampMixin):
    __tablename__ = "room_room_types"
    __table_args__ = (UniqueConstraint("organization_id", "room_id", "room_type_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    room_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rooms.id"), nullable=False)
    room_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("room_types.id"), nullable=False)


class Provider(Base, TimestampMixin):
    __tablename__ = "providers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    first_name: Mapped[str] = mapped_column(String(120), nullable=False)
    last_name: Mapped[str] = mapped_column(String(120), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    provider_type: Mapped[str] = mapped_column(String(40), nullable=False)
    employment_type: Mapped[str] = mapped_column(String(40), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    center_credentials: Mapped[list["ProviderCenterCredential"]] = relationship(
        back_populates="provider",
        cascade="all, delete-orphan",
    )
    room_type_skills: Mapped[list["ProviderRoomTypeSkill"]] = relationship(
        back_populates="provider",
        cascade="all, delete-orphan",
    )

    @property
    def credentialed_center_ids(self) -> list[uuid.UUID]:
        credentialed_center_ids = [
            credential.center_id
            for credential in self.center_credentials
        ]
        return credentialed_center_ids

    @property
    def skill_room_type_ids(self) -> list[uuid.UUID]:
        skill_room_type_ids = [
            skill.room_type_id
            for skill in self.room_type_skills
        ]
        return skill_room_type_ids


class ProviderCenterCredential(Base, TimestampMixin):
    __tablename__ = "provider_center_credentials"
    __table_args__ = (UniqueConstraint("organization_id", "provider_id", "center_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    provider_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("providers.id"), nullable=False)
    center_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("centers.id"), nullable=False)
    provider: Mapped[Provider] = relationship(back_populates="center_credentials")


class ProviderRoomTypeSkill(Base, TimestampMixin):
    __tablename__ = "provider_room_type_skills"
    __table_args__ = (UniqueConstraint("organization_id", "provider_id", "room_type_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    provider_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("providers.id"), nullable=False)
    room_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("room_types.id"), nullable=False)
    provider: Mapped[Provider] = relationship(back_populates="room_type_skills")


class ProviderAvailability(Base, TimestampMixin):
    __tablename__ = "provider_availability"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    provider_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("providers.id"), nullable=False)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    availability_type: Mapped[str] = mapped_column(String(40), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class ShiftRequirement(Base, TimestampMixin):
    __tablename__ = "shift_requirements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    center_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("centers.id"), nullable=False)
    room_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("rooms.id"), nullable=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    required_provider_count: Mapped[int] = mapped_column(Integer, nullable=False)
    required_provider_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class SchedulePeriod(Base, TimestampMixin):
    __tablename__ = "schedule_periods"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False)


class ScheduleJob(Base, TimestampMixin):
    __tablename__ = "schedule_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    schedule_period_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schedule_periods.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    requested_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class ScheduleVersion(Base, TimestampMixin):
    __tablename__ = "schedule_versions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    schedule_period_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schedule_periods.id"), nullable=False)
    schedule_job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("schedule_jobs.id"), nullable=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    solver_score: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class Assignment(Base, TimestampMixin):
    __tablename__ = "assignments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "provider_id", "center_id"],
            [
                "provider_center_credentials.organization_id",
                "provider_center_credentials.provider_id",
                "provider_center_credentials.center_id",
            ],
            name="fk_assignments_provider_center_credential",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    schedule_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schedule_versions.id"), nullable=False)
    schedule_period_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schedule_periods.id"), nullable=False)
    provider_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("providers.id"), nullable=False)
    center_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("centers.id"), nullable=False)
    room_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("rooms.id"), nullable=True)
    shift_requirement_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("shift_requirements.id"), nullable=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    assignment_status: Mapped[str] = mapped_column(String(40), nullable=False)
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class ConstraintViolation(Base, TimestampMixin):
    __tablename__ = "constraint_violations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=create_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    schedule_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schedule_versions.id"), nullable=False)
    assignment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("assignments.id"), nullable=True)
    severity: Mapped[str] = mapped_column(String(40), nullable=False)
    constraint_type: Mapped[str] = mapped_column(String(80), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
