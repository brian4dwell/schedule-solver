"""provider schedule week availability

Revision ID: 202605020001
Revises: 202604300007
Create Date: 2026-05-02 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "202605020001"
down_revision = "202604300007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "provider_schedule_week_availability",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("schedule_week_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("weekday", sa.String(length=20), nullable=False),
        sa.Column("availability_option", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["provider_id"], ["providers.id"]),
        sa.ForeignKeyConstraint(["schedule_week_id"], ["schedule_periods.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "schedule_week_id",
            "provider_id",
            "weekday",
            name="uq_provider_schedule_week_day",
        ),
    )


def downgrade() -> None:
    op.drop_table("provider_schedule_week_availability")
