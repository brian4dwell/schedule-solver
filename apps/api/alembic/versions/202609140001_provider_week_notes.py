"""Store Provider notes once per schedule week.

Revision ID: 202609140001
Revises: 202609130002
Create Date: 2026-09-14
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202609140001"
down_revision: str | Sequence[str] | None = "202609130002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    uuid_type = postgresql.UUID(as_uuid=True)
    op.create_table(
        "provider_schedule_week_notes",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("schedule_week_id", uuid_type, nullable=False),
        sa.Column("provider_id", uuid_type, nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["schedule_week_id"], ["schedule_periods.id"]),
        sa.ForeignKeyConstraint(["provider_id"], ["providers.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id", "provider_id", "schedule_week_id",
            name="uq_provider_schedule_week_notes_scope",
        ),
        sa.CheckConstraint("length(notes) <= 2000", name="ck_provider_schedule_week_notes_length"),
    )


def downgrade() -> None:
    op.drop_table("provider_schedule_week_notes")
