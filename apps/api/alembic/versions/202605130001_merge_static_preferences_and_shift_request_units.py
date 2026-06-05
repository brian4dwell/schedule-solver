"""merge static preferences and shift request units

Revision ID: 202605130001
Revises: 202605050001, 202605110001
Create Date: 2026-05-13 15:45:00.000000
"""

from collections.abc import Sequence


revision: str = "202605130001"
down_revision: str | Sequence[str] | None = ("202605050001", "202605110001")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
