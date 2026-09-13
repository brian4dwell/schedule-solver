"""Expire provider invitations and invalidate legacy links without an expiry."""

from alembic import op
import sqlalchemy as sa

revision: str = "202609130001"
down_revision: str | None = "202607050001"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    expiry_column = sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True)
    op.add_column("provider_invites", expiry_column)
    op.execute("UPDATE provider_invites SET expires_at = CURRENT_TIMESTAMP")
    op.alter_column("provider_invites", "expires_at", nullable=False)


def downgrade() -> None:
    op.drop_column("provider_invites", "expires_at")
