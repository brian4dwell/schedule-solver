"""add shift request unit columns

Revision ID: 202605110001
Revises: 202605020004
Create Date: 2026-05-11
"""

from alembic import op
import sqlalchemy as sa

revision = "202605110001"
down_revision = "202605020004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "provider_schedule_week_availability",
        sa.Column("min_shifts_requested_units", sa.Integer(), nullable=True),
    )
    op.add_column(
        "provider_schedule_week_availability",
        sa.Column("max_shifts_requested_units", sa.Integer(), nullable=True),
    )
    op.execute(
        """
        UPDATE provider_schedule_week_availability
        SET min_shifts_requested_units = min_shifts_requested * 2,
            max_shifts_requested_units = max_shifts_requested * 2
        """
    )
    op.alter_column("provider_schedule_week_availability", "min_shifts_requested_units", nullable=False)
    op.alter_column("provider_schedule_week_availability", "max_shifts_requested_units", nullable=False)


def downgrade() -> None:
    op.drop_column("provider_schedule_week_availability", "max_shifts_requested_units")
    op.drop_column("provider_schedule_week_availability", "min_shifts_requested_units")
