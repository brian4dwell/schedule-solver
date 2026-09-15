"""Persist organization tuning and solver run snapshots."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "202609140003"
down_revision = "202609140002"
branch_labels = None
depends_on = None

BASELINE = '{"center_weight":4,"shift_type_weight":6,"manager_hidden_weight":5,"below_minimum_weight":10,"above_maximum_weight":15,"balance_weight":3,"fairness_weight":10,"unfilled_weight":100000}'


def upgrade() -> None:
    op.add_column(
        "organizations", sa.Column("solver_weights", postgresql.JSONB(), nullable=True)
    )
    op.add_column(
        "organizations",
        sa.Column("solver_weights_revision", sa.Integer(), nullable=True),
    )
    organizations = sa.table(
        "organizations",
        sa.column("solver_weights", postgresql.JSONB()),
        sa.column("solver_weights_revision", sa.Integer()),
    )
    baseline = sa.cast(sa.literal(BASELINE), postgresql.JSONB())
    backfill = organizations.update().values(
        solver_weights=baseline, solver_weights_revision=1
    )
    op.execute(backfill)
    op.alter_column("organizations", "solver_weights", nullable=False)
    op.alter_column("organizations", "solver_weights_revision", nullable=False)
    op.add_column(
        "schedule_jobs",
        sa.Column("requested_by_subject", sa.String(255), nullable=True),
    )
    op.add_column(
        "schedule_jobs", sa.Column("solver_snapshot", postgresql.JSONB(), nullable=True)
    )
    op.create_index(
        "ix_schedule_jobs_organization_period_created",
        "schedule_jobs",
        ["organization_id", "schedule_period_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_schedule_jobs_organization_period_created", table_name="schedule_jobs"
    )
    op.drop_column("schedule_jobs", "solver_snapshot")
    op.drop_column("schedule_jobs", "requested_by_subject")
    op.drop_column("organizations", "solver_weights_revision")
    op.drop_column("organizations", "solver_weights")
