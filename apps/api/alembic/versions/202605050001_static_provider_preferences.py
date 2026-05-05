"""make provider preferences stable

Revision ID: 202605050001
Revises: 202605040003
Create Date: 2026-05-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "202605050001"
down_revision: str | None = "202605040003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


preference_table_names = [
    "provider_center_preferences",
    "provider_shift_type_preferences",
    "manager_provider_center_preferences",
]


def upgrade() -> None:
    for table_name in preference_table_names:
        op.drop_column(table_name, "effective_start_date")
        op.drop_column(table_name, "effective_end_date")


def downgrade() -> None:
    for table_name in preference_table_names:
        start_column = sa.Column("effective_start_date", sa.Date(), nullable=True)
        end_column = sa.Column("effective_end_date", sa.Date(), nullable=True)
        op.add_column(table_name, start_column)
        op.add_column(table_name, end_column)
