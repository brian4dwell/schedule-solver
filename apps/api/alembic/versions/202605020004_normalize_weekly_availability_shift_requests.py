"""normalize weekly availability shift requests

Revision ID: 202605020004
Revises: 202605020003
Create Date: 2026-05-02 00:00:00.000000
"""

from alembic import op

revision = "202605020004"
down_revision = "202605020003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        WITH request_limits AS (
            SELECT
                organization_id,
                schedule_week_id,
                provider_id,
                COUNT(*) FILTER (
                    WHERE availability_options ?| array[
                        'full_shift',
                        'first_half',
                        'second_half',
                        'short_shift'
                    ]
                )::integer AS available_day_count
            FROM provider_schedule_week_availability
            GROUP BY organization_id, schedule_week_id, provider_id
        ),
        normalized_requests AS (
            SELECT
                target.id,
                LEAST(target.max_shifts_requested, request_limits.available_day_count) AS normalized_max
            FROM provider_schedule_week_availability AS target
            JOIN request_limits
            ON target.organization_id = request_limits.organization_id
            AND target.schedule_week_id = request_limits.schedule_week_id
            AND target.provider_id = request_limits.provider_id
        )
        UPDATE provider_schedule_week_availability AS target
        SET
            max_shifts_requested = normalized_requests.normalized_max,
            min_shifts_requested = LEAST(target.min_shifts_requested, normalized_requests.normalized_max)
        FROM normalized_requests
        WHERE target.id = normalized_requests.id
        """
    )


def downgrade() -> None:
    pass
