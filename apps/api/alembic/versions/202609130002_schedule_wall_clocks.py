"""Store schedule slots as dates and wall-clock times.

Revision ID: 202609130002
Revises: 202609130001
"""

from alembic import op
import sqlalchemy as sa


revision = "202609130002"
down_revision = "202609130001"
branch_labels = None
depends_on = None

TABLES = ("assignments", "shift_requirements", "schedule_structure_template_slots")
CLOCK_CHECK = (
    "start_time < TIME '24:00' AND end_time < TIME '24:00' "
    "AND EXTRACT(SECOND FROM start_time) = 0 "
    "AND EXTRACT(SECOND FROM end_time) = 0"
)


def upgrade() -> None:
    op.execute("LOCK TABLE assignments, shift_requirements, schedule_structure_template_slots IN ACCESS EXCLUSIVE MODE")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM assignments
                WHERE start_time::date <> schedule_date
                   OR end_time::date <> schedule_date
                   OR end_time <= start_time
                   OR EXTRACT(SECOND FROM start_time) <> 0
                   OR EXTRACT(SECOND FROM end_time) <> 0
            ) OR EXISTS (
                SELECT 1 FROM shift_requirements
                WHERE start_time::date <> end_time::date
                   OR end_time <= start_time
                   OR EXTRACT(SECOND FROM start_time) <> 0
                   OR EXTRACT(SECOND FROM end_time) <> 0
            ) THEN
                RAISE EXCEPTION 'Invalid schedule times remain. Run the explicitly scoped obsolete-draft cleanup before migrating.';
            END IF;
        END $$
    """)
    op.add_column("shift_requirements", sa.Column("schedule_date", sa.Date(), nullable=True))
    op.execute("UPDATE shift_requirements SET schedule_date = start_time::date")
    op.alter_column("shift_requirements", "schedule_date", nullable=False)

    for table_name in ("assignments", "shift_requirements"):
        for column_name in ("start_time", "end_time"):
            conversion = f"{column_name}::time without time zone"
            op.alter_column(
                table_name,
                column_name,
                type_=sa.Time(timezone=False),
                existing_type=sa.DateTime(timezone=False),
                postgresql_using=conversion,
            )

    for table_name in TABLES:
        op.create_check_constraint(f"ck_{table_name}_time_range", table_name, "end_time > start_time")
        op.create_check_constraint(f"ck_{table_name}_clock_precision", table_name, CLOCK_CHECK)


def downgrade() -> None:
    for table_name in TABLES:
        op.drop_constraint(f"ck_{table_name}_clock_precision", table_name, type_="check")
        op.drop_constraint(f"ck_{table_name}_time_range", table_name, type_="check")

    for table_name in ("assignments", "shift_requirements"):
        for column_name in ("start_time", "end_time"):
            conversion = f"schedule_date + {column_name}"
            op.alter_column(
                table_name,
                column_name,
                type_=sa.DateTime(timezone=False),
                existing_type=sa.Time(timezone=False),
                postgresql_using=conversion,
            )

    op.drop_column("shift_requirements", "schedule_date")
