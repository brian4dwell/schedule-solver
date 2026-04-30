"""schedule version metadata

Revision ID: 202604300006
Revises: 202604300005
Create Date: 2026-04-30 13:00:00.000000
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202604300006"
down_revision: str | None = "202604300005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    uuid_type = postgresql.UUID(as_uuid=True)

    op.add_column(
        "schedule_versions",
        sa.Column("source", sa.String(length=40), nullable=False, server_default="manual"),
    )
    op.alter_column(
        "schedule_versions",
        "source",
        server_default=None,
    )
    op.add_column(
        "schedule_versions",
        sa.Column("parent_schedule_version_id", uuid_type, nullable=True),
    )
    op.add_column(
        "schedule_versions",
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "schedule_versions",
        sa.Column("published_by_user_id", uuid_type, nullable=True),
    )
    op.add_column(
        "schedule_versions",
        sa.Column("created_by_user_id", uuid_type, nullable=True),
    )
    op.create_foreign_key(
        "fk_schedule_versions_parent_schedule_version",
        "schedule_versions",
        "schedule_versions",
        ["parent_schedule_version_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_schedule_versions_published_by_user",
        "schedule_versions",
        "users",
        ["published_by_user_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_schedule_versions_created_by_user",
        "schedule_versions",
        "users",
        ["created_by_user_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_schedule_versions_created_by_user",
        "schedule_versions",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_schedule_versions_published_by_user",
        "schedule_versions",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_schedule_versions_parent_schedule_version",
        "schedule_versions",
        type_="foreignkey",
    )
    op.drop_column("schedule_versions", "created_by_user_id")
    op.drop_column("schedule_versions", "published_by_user_id")
    op.drop_column("schedule_versions", "published_at")
    op.drop_column("schedule_versions", "parent_schedule_version_id")
    op.drop_column("schedule_versions", "source")
