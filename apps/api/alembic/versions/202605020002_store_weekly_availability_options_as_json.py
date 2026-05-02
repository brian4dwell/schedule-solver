"""store weekly availability options as json

Revision ID: 202605020002
Revises: 202605020001
Create Date: 2026-05-02 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "202605020002"
down_revision = "202605020001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "provider_schedule_week_availability",
        "availability_option",
        new_column_name="availability_options",
        existing_type=sa.String(length=40),
        existing_nullable=False,
    )
    op.alter_column(
        "provider_schedule_week_availability",
        "availability_options",
        existing_type=sa.String(length=40),
        type_=postgresql.JSONB(),
        existing_nullable=False,
        postgresql_using="to_jsonb(string_to_array(availability_options, ','))",
    )


def downgrade() -> None:
    op.alter_column(
        "provider_schedule_week_availability",
        "availability_options",
        existing_type=postgresql.JSONB(),
        type_=sa.String(length=40),
        existing_nullable=False,
        postgresql_using="replace(replace(trim(both '[]' from availability_options::text), '\"', ''), ', ', ',')",
    )
    op.alter_column(
        "provider_schedule_week_availability",
        "availability_options",
        new_column_name="availability_option",
        existing_type=sa.String(length=40),
        existing_nullable=False,
    )
