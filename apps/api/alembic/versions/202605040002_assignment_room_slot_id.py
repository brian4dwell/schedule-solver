"""add stable room slot id to assignments

Revision ID: 202605040002
Revises: 202605040001
Create Date: 2026-05-04 10:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "202605040002"
down_revision: str | None = "202605040001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assignments",
        sa.Column("room_slot_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute("UPDATE assignments SET room_slot_id = id")
    op.alter_column(
        "assignments",
        "room_slot_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.create_unique_constraint(
        "uq_assignments_organization_version_room_slot",
        "assignments",
        ["organization_id", "schedule_version_id", "room_slot_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_assignments_organization_version_room_slot",
        "assignments",
        type_="unique",
    )
    op.drop_column("assignments", "room_slot_id")
