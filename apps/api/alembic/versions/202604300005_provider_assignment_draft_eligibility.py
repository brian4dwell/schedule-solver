"""provider assignment draft eligibility

Revision ID: 202604300005
Revises: 202604300004
Create Date: 2026-04-30 12:00:00.000000
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202604300005"
down_revision: str | None = "202604300004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        "fk_assignments_provider_center_credential",
        "assignments",
        type_="foreignkey",
    )

    op.add_column(
        "provider_center_credentials",
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "provider_center_credentials",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "provider_center_credentials",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.alter_column(
        "provider_center_credentials",
        "is_active",
        server_default=None,
    )
    op.add_column(
        "provider_room_type_skills",
        sa.Column("proficiency_level", sa.Integer(), nullable=False, server_default="1"),
    )
    op.alter_column(
        "provider_room_type_skills",
        "proficiency_level",
        server_default=None,
    )
    op.add_column(
        "room_room_types",
        sa.Column("required_proficiency_level", sa.Integer(), nullable=False, server_default="1"),
    )
    op.alter_column(
        "room_room_types",
        "required_proficiency_level",
        server_default=None,
    )
    op.add_column(
        "assignments",
        sa.Column("required_provider_type", sa.String(length=40), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("assignments", "required_provider_type")
    op.drop_column("room_room_types", "required_proficiency_level")
    op.drop_column("provider_room_type_skills", "proficiency_level")
    op.drop_column("provider_center_credentials", "is_active")
    op.drop_column("provider_center_credentials", "expires_at")
    op.drop_column("provider_center_credentials", "starts_at")
    op.create_foreign_key(
        "fk_assignments_provider_center_credential",
        "assignments",
        "provider_center_credentials",
        ["organization_id", "provider_id", "center_id"],
        ["organization_id", "provider_id", "center_id"],
    )
