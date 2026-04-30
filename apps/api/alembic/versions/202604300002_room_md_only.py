"""room md only

Revision ID: 202604300002
Revises: 202604300001
Create Date: 2026-04-30 00:02:00.000000
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202604300002"
down_revision: str | None = "202604300001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    md_only_column = sa.Column(
        "md_only",
        sa.Boolean(),
        nullable=False,
        server_default=sa.false(),
    )
    op.add_column("rooms", md_only_column)
    op.alter_column("rooms", "md_only", server_default=None)


def downgrade() -> None:
    op.drop_column("rooms", "md_only")
