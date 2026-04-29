"""initial schema

Revision ID: 202604290001
Revises:
Create Date: 2026-04-29 00:01:00.000000
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202604290001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def create_timestamp_columns() -> list[sa.Column]:
    created_at = sa.Column("created_at", sa.DateTime(), nullable=False)
    updated_at = sa.Column("updated_at", sa.DateTime(), nullable=False)
    columns = [created_at, updated_at]
    return columns


def upgrade() -> None:
    uuid_type = postgresql.UUID(as_uuid=True)

    op.create_table(
        "organizations",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("clerk_org_id", sa.String(length=255), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        *create_timestamp_columns(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("clerk_org_id"),
    )
    op.create_table(
        "users",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("clerk_user_id", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("first_name", sa.String(length=120), nullable=True),
        sa.Column("last_name", sa.String(length=120), nullable=True),
        sa.Column("role", sa.String(length=40), nullable=False),
        *create_timestamp_columns(),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "clerk_user_id"),
    )
    op.create_table(
        "centers",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("address_line_1", sa.String(length=255), nullable=True),
        sa.Column("address_line_2", sa.String(length=255), nullable=True),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column("state", sa.String(length=80), nullable=True),
        sa.Column("postal_code", sa.String(length=20), nullable=True),
        sa.Column("timezone", sa.String(length=80), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        *create_timestamp_columns(),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "rooms",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("center_id", uuid_type, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        *create_timestamp_columns(),
        sa.ForeignKeyConstraint(["center_id"], ["centers.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "providers",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("first_name", sa.String(length=120), nullable=False),
        sa.Column("last_name", sa.String(length=120), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=40), nullable=True),
        sa.Column("provider_type", sa.String(length=40), nullable=False),
        sa.Column("employment_type", sa.String(length=40), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        *create_timestamp_columns(),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "provider_availability",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("provider_id", uuid_type, nullable=False),
        sa.Column("start_time", sa.DateTime(), nullable=False),
        sa.Column("end_time", sa.DateTime(), nullable=False),
        sa.Column("availability_type", sa.String(length=40), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        *create_timestamp_columns(),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["provider_id"], ["providers.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "shift_requirements",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("center_id", uuid_type, nullable=False),
        sa.Column("room_id", uuid_type, nullable=True),
        sa.Column("start_time", sa.DateTime(), nullable=False),
        sa.Column("end_time", sa.DateTime(), nullable=False),
        sa.Column("required_provider_count", sa.Integer(), nullable=False),
        sa.Column("required_provider_type", sa.String(length=40), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        *create_timestamp_columns(),
        sa.ForeignKeyConstraint(["center_id"], ["centers.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "schedule_periods",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        *create_timestamp_columns(),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "schedule_jobs",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("schedule_period_id", uuid_type, nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("requested_by_user_id", uuid_type, nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        *create_timestamp_columns(),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["schedule_period_id"], ["schedule_periods.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "schedule_versions",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("schedule_period_id", uuid_type, nullable=False),
        sa.Column("schedule_job_id", uuid_type, nullable=True),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("solver_score", sa.Numeric(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        *create_timestamp_columns(),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["schedule_job_id"], ["schedule_jobs.id"]),
        sa.ForeignKeyConstraint(["schedule_period_id"], ["schedule_periods.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "assignments",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("schedule_version_id", uuid_type, nullable=False),
        sa.Column("schedule_period_id", uuid_type, nullable=False),
        sa.Column("provider_id", uuid_type, nullable=False),
        sa.Column("center_id", uuid_type, nullable=False),
        sa.Column("room_id", uuid_type, nullable=True),
        sa.Column("shift_requirement_id", uuid_type, nullable=True),
        sa.Column("start_time", sa.DateTime(), nullable=False),
        sa.Column("end_time", sa.DateTime(), nullable=False),
        sa.Column("assignment_status", sa.String(length=40), nullable=False),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        *create_timestamp_columns(),
        sa.ForeignKeyConstraint(["center_id"], ["centers.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["provider_id"], ["providers.id"]),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"]),
        sa.ForeignKeyConstraint(["schedule_period_id"], ["schedule_periods.id"]),
        sa.ForeignKeyConstraint(["schedule_version_id"], ["schedule_versions.id"]),
        sa.ForeignKeyConstraint(["shift_requirement_id"], ["shift_requirements.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "constraint_violations",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("schedule_version_id", uuid_type, nullable=False),
        sa.Column("assignment_id", uuid_type, nullable=True),
        sa.Column("severity", sa.String(length=40), nullable=False),
        sa.Column("constraint_type", sa.String(length=80), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("metadata_json", postgresql.JSONB(), nullable=True),
        *create_timestamp_columns(),
        sa.ForeignKeyConstraint(["assignment_id"], ["assignments.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["schedule_version_id"], ["schedule_versions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("constraint_violations")
    op.drop_table("assignments")
    op.drop_table("schedule_versions")
    op.drop_table("schedule_jobs")
    op.drop_table("schedule_periods")
    op.drop_table("shift_requirements")
    op.drop_table("provider_availability")
    op.drop_table("providers")
    op.drop_table("rooms")
    op.drop_table("centers")
    op.drop_table("users")
    op.drop_table("organizations")
