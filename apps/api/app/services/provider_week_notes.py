from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ProviderScheduleWeekNote


def find_provider_week_note(
    schedule_week_id: UUID,
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> ProviderScheduleWeekNote | None:
    statement = select(ProviderScheduleWeekNote)
    statement = statement.where(ProviderScheduleWeekNote.organization_id == organization_id)
    statement = statement.where(ProviderScheduleWeekNote.provider_id == provider_id)
    statement = statement.where(ProviderScheduleWeekNote.schedule_week_id == schedule_week_id)
    note = session.scalar(statement)
    return note


def read_provider_week_notes(
    schedule_week_id: UUID,
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> str | None:
    note = find_provider_week_note(schedule_week_id, provider_id, organization_id, session)

    if note is None:
        return None

    return note.notes


def replace_provider_week_notes(
    schedule_week_id: UUID,
    provider_id: UUID,
    organization_id: UUID,
    notes: str | None,
    session: Session,
) -> None:
    note = find_provider_week_note(schedule_week_id, provider_id, organization_id, session)

    if notes is None:
        if note is not None:
            session.delete(note)
        return

    if note is None:
        note = ProviderScheduleWeekNote(
            organization_id=organization_id,
            provider_id=provider_id,
            schedule_week_id=schedule_week_id,
            notes=notes,
        )
        session.add(note)
        return

    note.notes = notes
