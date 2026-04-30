"""provider room type skills

Revision ID: 202604300004
Revises: 202604300003
Create Date: 2026-04-30 00:04:00.000000
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202604300004"
down_revision: str | None = "202604300003"
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
        "provider_room_type_skills",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("provider_id", uuid_type, nullable=False),
        sa.Column("room_type_id", uuid_type, nullable=False),
        *create_timestamp_columns(),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["provider_id"], ["providers.id"]),
        sa.ForeignKeyConstraint(["room_type_id"], ["room_types.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "provider_id", "room_type_id"),
    )


def downgrade() -> None:
    op.drop_table("provider_room_type_skills")
