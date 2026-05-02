"""weekly availability shift requests

Revision ID: 202605020003
Revises: 202605020002
Create Date: 2026-05-02 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "202605020003"
down_revision = "202605020002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "provider_schedule_week_availability",
        sa.Column("min_shifts_requested", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "provider_schedule_week_availability",
        sa.Column("max_shifts_requested", sa.Integer(), nullable=False, server_default="0"),
    )
    op.execute(
        """
        UPDATE provider_schedule_week_availability AS target
        SET max_shifts_requested = counts.available_day_count
        FROM (
            SELECT
                organization_id,
                schedule_week_id,
                provider_id,
                COUNT(*)::integer AS available_day_count
            FROM provider_schedule_week_availability
            WHERE availability_options ?| array[
                'full_shift',
                'first_half',
                'second_half',
                'short_shift'
            ]
            GROUP BY organization_id, schedule_week_id, provider_id
        ) AS counts
        WHERE target.organization_id = counts.organization_id
        AND target.schedule_week_id = counts.schedule_week_id
        AND target.provider_id = counts.provider_id
        """
    )
    op.alter_column(
        "provider_schedule_week_availability",
        "min_shifts_requested",
        server_default=None,
    )
    op.alter_column(
        "provider_schedule_week_availability",
        "max_shifts_requested",
        server_default=None,
    )


def downgrade() -> None:
    op.drop_column("provider_schedule_week_availability", "max_shifts_requested")
    op.drop_column("provider_schedule_week_availability", "min_shifts_requested")
