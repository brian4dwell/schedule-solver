"""add assignment shift type

Revision ID: 202605020005
Revises: 202605020004
Create Date: 2026-05-02 00:05:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "202605020005"
down_revision: str | None = "202605020004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assignments",
        sa.Column(
            "shift_type",
            sa.String(length=40),
            nullable=False,
            server_default="full_shift",
        ),
    )
    op.alter_column(
        "assignments",
        "shift_type",
        server_default=None,
    )


def downgrade() -> None:
    op.drop_column("assignments", "shift_type")
