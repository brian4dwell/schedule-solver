"""Constrain Manager Preferences to the eleven-point scale.

Revision ID: 202609140002
Revises: 202609140001
Create Date: 2026-09-14
"""

from collections.abc import Sequence

from alembic import op

revision: str = "202609140002"
down_revision: str | None = "202609140001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_check_constraint(
        "ck_manager_center_preference_level",
        "manager_provider_center_preferences",
        "preference_level BETWEEN -5 AND 5",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_manager_center_preference_level",
        "manager_provider_center_preferences",
        type_="check",
    )
