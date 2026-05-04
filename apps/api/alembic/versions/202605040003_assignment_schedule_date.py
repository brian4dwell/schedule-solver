"""add assignment schedule date

Revision ID: 202605040003
Revises: 202605040002
Create Date: 2026-05-04 11:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "202605040003"
down_revision: str | None = "202605040002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assignments",
        sa.Column("schedule_date", sa.Date(), nullable=True),
    )
    op.execute(
        """
        UPDATE assignments
        SET schedule_date = source.schedule_date
        FROM (
            SELECT DISTINCT ON (
                assignments.organization_id,
                assignments.schedule_period_id,
                assignments.room_slot_id
            )
                assignments.organization_id,
                assignments.schedule_period_id,
                assignments.room_slot_id,
                DATE(assignments.start_time AT TIME ZONE 'UTC') AS schedule_date
            FROM assignments
            JOIN schedule_versions
                ON schedule_versions.id = assignments.schedule_version_id
            ORDER BY
                assignments.organization_id,
                assignments.schedule_period_id,
                assignments.room_slot_id,
                schedule_versions.version_number,
                assignments.created_at,
                assignments.id
        ) AS source
        WHERE assignments.organization_id = source.organization_id
            AND assignments.schedule_period_id = source.schedule_period_id
            AND assignments.room_slot_id = source.room_slot_id
        """
    )
    op.alter_column(
        "assignments",
        "schedule_date",
        existing_type=sa.Date(),
        nullable=False,
    )


def downgrade() -> None:
    op.drop_column("assignments", "schedule_date")
