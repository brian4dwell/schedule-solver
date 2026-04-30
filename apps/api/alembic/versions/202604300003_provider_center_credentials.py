"""provider center credentials

Revision ID: 202604300003
Revises: 202604300002
Create Date: 2026-04-30 00:03:00.000000
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202604300003"
down_revision: str | None = "202604300002"
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
        "provider_center_credentials",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("organization_id", uuid_type, nullable=False),
        sa.Column("provider_id", uuid_type, nullable=False),
        sa.Column("center_id", uuid_type, nullable=False),
        *create_timestamp_columns(),
        sa.ForeignKeyConstraint(["center_id"], ["centers.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["provider_id"], ["providers.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "provider_id", "center_id"),
    )
    op.create_foreign_key(
        "fk_assignments_provider_center_credential",
        "assignments",
        "provider_center_credentials",
        ["organization_id", "provider_id", "center_id"],
        ["organization_id", "provider_id", "center_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_assignments_provider_center_credential",
        "assignments",
        type_="foreignkey",
    )
    op.drop_table("provider_center_credentials")
