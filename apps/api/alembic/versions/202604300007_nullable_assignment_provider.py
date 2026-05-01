"""nullable assignment provider

Revision ID: 202604300007
Revises: 202604300006
Create Date: 2026-04-30 15:10:00.000000
"""
from typing import Sequence

from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "202604300007"
down_revision: str | None = "202604300006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    uuid_type = postgresql.UUID(as_uuid=True)

    op.alter_column(
        "assignments",
        "provider_id",
        existing_type=uuid_type,
        nullable=True,
    )


def downgrade() -> None:
    uuid_type = postgresql.UUID(as_uuid=True)

    op.alter_column(
        "assignments",
        "provider_id",
        existing_type=uuid_type,
        nullable=False,
    )
