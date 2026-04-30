"""room types

Revision ID: 202604300001
Revises: 202604290001
Create Date: 2026-04-30 00:01:00.000000
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202604300001"
down_revision: str | None = "202604290001"
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
        "room_types",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        *create_timestamp_columns(),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "name"),
    )
    op.create_table(
        "room_room_types",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("room_id", uuid_type, nullable=False),
        sa.Column("room_type_id", uuid_type, nullable=False),
        *create_timestamp_columns(),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"]),
        sa.ForeignKeyConstraint(["room_type_id"], ["room_types.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "room_id", "room_type_id"),
    )


def downgrade() -> None:
    op.drop_table("room_room_types")
    op.drop_table("room_types")
