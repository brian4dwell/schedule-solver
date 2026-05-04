"""add fairness accounting

Revision ID: 202605030001
Revises: 202605020005
Create Date: 2026-05-03 20:20:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "202605030001"
down_revision: str | None = "202605020005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "fairness_config_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("decay_factor", sa.Numeric(), nullable=False),
        sa.Column("debt_weight", sa.Numeric(), nullable=False),
        sa.Column("favor_weight", sa.Numeric(), nullable=False),
        sa.Column("standard_priority_multiplier", sa.Numeric(), nullable=False),
        sa.Column("elevated_priority_multiplier", sa.Numeric(), nullable=False),
        sa.Column("critical_priority_multiplier", sa.Numeric(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "version_number"),
    )
    op.create_table(
        "provider_fairness_states",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("config_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("fairness_debt", sa.Numeric(), nullable=False),
        sa.Column("favor_credit", sa.Numeric(), nullable=False),
        sa.Column("priority_tier", sa.String(length=40), nullable=False),
        sa.Column("priority_multiplier", sa.Numeric(), nullable=False),
        sa.Column("last_applied_schedule_period_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_applied_schedule_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["config_version_id"], ["fairness_config_versions.id"]),
        sa.ForeignKeyConstraint(["last_applied_schedule_period_id"], ["schedule_periods.id"]),
        sa.ForeignKeyConstraint(["last_applied_schedule_version_id"], ["schedule_versions.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["provider_id"], ["providers.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "provider_id"),
    )
    op.create_table(
        "provider_fairness_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("schedule_period_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("schedule_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("assignment_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("category", sa.String(length=40), nullable=False),
        sa.Column("debt_delta", sa.Numeric(), nullable=False),
        sa.Column("favor_delta", sa.Numeric(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assignment_id"], ["assignments.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["provider_id"], ["providers.id"]),
        sa.ForeignKeyConstraint(["schedule_period_id"], ["schedule_periods.id"]),
        sa.ForeignKeyConstraint(["schedule_version_id"], ["schedule_versions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "provider_fairness_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("schedule_period_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("schedule_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("config_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("starting_debt", sa.Numeric(), nullable=False),
        sa.Column("starting_favor_credit", sa.Numeric(), nullable=False),
        sa.Column("weekly_debt_delta", sa.Numeric(), nullable=False),
        sa.Column("weekly_favor_delta", sa.Numeric(), nullable=False),
        sa.Column("ending_debt", sa.Numeric(), nullable=False),
        sa.Column("ending_favor_credit", sa.Numeric(), nullable=False),
        sa.Column("fairness_pressure", sa.Numeric(), nullable=False),
        sa.Column("priority_tier", sa.String(length=40), nullable=False),
        sa.Column("priority_multiplier", sa.Numeric(), nullable=False),
        sa.Column("assignment_count", sa.Integer(), nullable=False),
        sa.Column("negative_event_count", sa.Integer(), nullable=False),
        sa.Column("positive_event_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["config_version_id"], ["fairness_config_versions.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["provider_id"], ["providers.id"]),
        sa.ForeignKeyConstraint(["schedule_period_id"], ["schedule_periods.id"]),
        sa.ForeignKeyConstraint(["schedule_version_id"], ["schedule_versions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "schedule_version_id", "provider_id"),
    )


def downgrade() -> None:
    op.drop_table("provider_fairness_snapshots")
    op.drop_table("provider_fairness_events")
    op.drop_table("provider_fairness_states")
    op.drop_table("fairness_config_versions")
