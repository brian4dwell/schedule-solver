"""add provider preferences

Revision ID: 202605040001
Revises: 202605030001
Create Date: 2026-05-04 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "202605040001"
down_revision: str | None = "202605030001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def preference_table_columns() -> list[sa.Column]:
    id_column = sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False)
    organization_column = sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False)
    provider_column = sa.Column("provider_id", postgresql.UUID(as_uuid=True), nullable=False)
    preference_column = sa.Column("preference_level", sa.Integer(), nullable=False)
    active_column = sa.Column("is_active", sa.Boolean(), nullable=False)
    start_column = sa.Column("effective_start_date", sa.Date(), nullable=True)
    end_column = sa.Column("effective_end_date", sa.Date(), nullable=True)
    created_column = sa.Column("created_at", sa.DateTime(timezone=True), nullable=False)
    updated_column = sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False)
    columns = [
        id_column,
        organization_column,
        provider_column,
        preference_column,
        active_column,
        start_column,
        end_column,
        created_column,
        updated_column,
    ]
    return columns


def preference_foreign_keys() -> list[sa.ForeignKeyConstraint]:
    organization_key = sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"])
    provider_key = sa.ForeignKeyConstraint(["provider_id"], ["providers.id"])
    foreign_keys = [
        organization_key,
        provider_key,
    ]
    return foreign_keys


def upgrade() -> None:
    op.create_table(
        "provider_center_preferences",
        *preference_table_columns(),
        sa.Column("center_id", postgresql.UUID(as_uuid=True), nullable=False),
        *preference_foreign_keys(),
        sa.ForeignKeyConstraint(["center_id"], ["centers.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "provider_id", "center_id"),
    )
    op.create_table(
        "provider_shift_type_preferences",
        *preference_table_columns(),
        sa.Column("shift_type", sa.String(length=40), nullable=False),
        *preference_foreign_keys(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "provider_id", "shift_type"),
    )
    op.create_table(
        "manager_provider_center_preferences",
        *preference_table_columns(),
        sa.Column("center_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("manager_note", sa.Text(), nullable=True),
        *preference_foreign_keys(),
        sa.ForeignKeyConstraint(["center_id"], ["centers.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "provider_id", "center_id"),
    )


def downgrade() -> None:
    op.drop_table("manager_provider_center_preferences")
    op.drop_table("provider_shift_type_preferences")
    op.drop_table("provider_center_preferences")
