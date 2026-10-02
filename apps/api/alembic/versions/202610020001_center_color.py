"""Add optional configured colors to centers.

Revision ID: 202610020001
Revises: 202609140003
Create Date: 2026-10-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202610020001"
down_revision: str | None = "202609140003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    color_column = sa.Column("color", sa.String(length=7), nullable=True)
    op.add_column("centers", color_column)
    op.create_check_constraint(
        "ck_centers_color_format",
        "centers",
        "color IS NULL OR (length(color) = 7 AND substr(color, 1, 1) = '#')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_centers_color_format", "centers", type_="check")
    op.drop_column("centers", "color")
