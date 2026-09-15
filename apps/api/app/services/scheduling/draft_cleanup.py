from uuid import UUID

from pydantic import BaseModel
from pydantic import Field
from sqlalchemy import delete
from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db.models import Assignment
from app.db.models import ConstraintViolation
from app.db.models import ProviderFairnessEvent
from app.db.models import ProviderFairnessSnapshot
from app.db.models import ProviderFairnessState
from app.db.models import ScheduleJob
from app.db.models import ScheduleVersion


class DraftCleanupSelection(BaseModel):
    organization_id: UUID
    version_ids: list[UUID] = Field(min_length=1)


class DraftCleanupPreview(BaseModel):
    version_count: int
    assignment_count: int
    violation_count: int
    fairness_event_count: int
    fairness_snapshot_count: int
    job_count: int


def preview_draft_cleanup(selection: DraftCleanupSelection, session: Session) -> DraftCleanupPreview:
    selected_ids = set(selection.version_ids)

    if len(selected_ids) != len(selection.version_ids):
        raise ValueError("Cleanup selection contains duplicate version IDs.")

    statement = select(ScheduleVersion)
    statement = statement.where(ScheduleVersion.organization_id == selection.organization_id)
    statement = statement.where(ScheduleVersion.id.in_(selection.version_ids))
    statement = statement.with_for_update()
    versions = list(session.scalars(statement))

    if len(versions) != len(selected_ids):
        raise ValueError("Selected draft versions are missing or belong to another organization.")

    for version in versions:
        if version.status != "draft" or version.published_at is not None:
            raise ValueError("Cleanup only accepts unpublished draft versions.")

    parent_statement = select(ScheduleVersion.id)
    parent_statement = parent_statement.where(ScheduleVersion.parent_schedule_version_id.in_(selection.version_ids))
    parent_statement = parent_statement.where(ScheduleVersion.id.not_in(selection.version_ids))
    dependent_version = session.scalar(parent_statement)

    if dependent_version is not None:
        raise ValueError("An unselected version depends on a selected draft.")

    state_statement = select(ProviderFairnessState.id)
    state_statement = state_statement.where(ProviderFairnessState.last_applied_schedule_version_id.in_(selection.version_ids))
    state_link = session.scalar(state_statement)

    if state_link is not None:
        raise ValueError("Selected drafts are referenced by published fairness state.")

    job_ids = [version.schedule_job_id for version in versions if version.schedule_job_id is not None]
    unique_job_ids = set(job_ids)
    jobs_statement = select(ScheduleJob)
    jobs_statement = jobs_statement.where(ScheduleJob.id.in_(unique_job_ids))
    jobs_statement = jobs_statement.with_for_update()
    jobs = list(session.scalars(jobs_statement))

    for job in jobs:
        owned_job = job.organization_id == selection.organization_id
        finished_job = job.status in {"completed", "failed"}

        if not owned_job or not finished_job:
            raise ValueError("Selected drafts have an active or unscoped job.")

    legacy_job_ids = [job.id for job in jobs if job.solver_snapshot is None]
    references_statement = select(ScheduleVersion.id)
    references_statement = references_statement.where(ScheduleVersion.schedule_job_id.in_(legacy_job_ids))
    references_statement = references_statement.where(ScheduleVersion.id.not_in(selected_ids))
    external_job_reference = session.scalar(references_statement)

    if external_job_reference is not None:
        raise ValueError("A selected draft job is shared with an unselected version.")

    def count_rows(model: type[Assignment] | type[ConstraintViolation] | type[ProviderFairnessEvent] | type[ProviderFairnessSnapshot]) -> int:
        count_statement = select(func.count()).select_from(model)
        count_statement = count_statement.where(model.organization_id == selection.organization_id)
        count_statement = count_statement.where(model.schedule_version_id.in_(selected_ids))
        count = session.scalar(count_statement)
        return int(count)

    preview = DraftCleanupPreview(
        version_count=len(versions),
        assignment_count=count_rows(Assignment),
        violation_count=count_rows(ConstraintViolation),
        fairness_event_count=count_rows(ProviderFairnessEvent),
        fairness_snapshot_count=count_rows(ProviderFairnessSnapshot),
        job_count=sum(job.solver_snapshot is None for job in jobs),
    )
    return preview


def apply_draft_cleanup(selection: DraftCleanupSelection, session: Session) -> DraftCleanupPreview:
    preview = preview_draft_cleanup(selection, session)
    jobs_statement = select(ScheduleVersion.schedule_job_id)
    jobs_statement = jobs_statement.where(ScheduleVersion.id.in_(selection.version_ids))
    jobs_statement = jobs_statement.where(ScheduleVersion.organization_id == selection.organization_id)
    job_ids = list(session.scalars(jobs_statement))

    for model in (ConstraintViolation, ProviderFairnessEvent, ProviderFairnessSnapshot, Assignment):
        statement = delete(model)
        statement = statement.where(model.organization_id == selection.organization_id)
        statement = statement.where(model.schedule_version_id.in_(selection.version_ids))
        session.execute(statement)

    parent_statement = update(ScheduleVersion)
    parent_statement = parent_statement.where(ScheduleVersion.organization_id == selection.organization_id)
    parent_statement = parent_statement.where(ScheduleVersion.id.in_(selection.version_ids))
    parent_statement = parent_statement.values(parent_schedule_version_id=None)
    session.execute(parent_statement)
    version_statement = delete(ScheduleVersion)
    version_statement = version_statement.where(ScheduleVersion.organization_id == selection.organization_id)
    version_statement = version_statement.where(ScheduleVersion.id.in_(selection.version_ids))
    session.execute(version_statement)
    job_statement = delete(ScheduleJob)
    job_statement = job_statement.where(ScheduleJob.organization_id == selection.organization_id)
    job_statement = job_statement.where(ScheduleJob.id.in_(job_ids))
    job_statement = job_statement.where(ScheduleJob.solver_snapshot.is_(None))
    session.execute(job_statement)
    session.flush()
    return preview
