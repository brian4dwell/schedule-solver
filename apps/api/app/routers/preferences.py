from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import delete as sqlalchemy_delete
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Center
from app.db.models import ManagerProviderCenterPreference
from app.db.models import Provider
from app.db.models import ProviderCenterPreference
from app.db.models import ProviderShiftTypePreference
from app.db.session import get_db
from app.dependencies import get_current_organization_id
from app.dependencies import require_admin_user
from app.schemas.preferences import ManagerProviderCenterPreferenceRead
from app.schemas.preferences import ManagerProviderPreferencesRead
from app.schemas.preferences import ManagerProviderPreferencesReplace
from app.schemas.preferences import ProviderCenterPreferenceRead
from app.schemas.preferences import ProviderPreferencesRead
from app.schemas.preferences import ProviderPreferencesReplace
from app.schemas.preferences import ProviderShiftTypePreferenceRead

router = APIRouter(tags=["preferences"], dependencies=[Depends(require_admin_user)])


def find_active_provider(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> Provider:
    statement = select(Provider)
    statement = statement.where(Provider.organization_id == organization_id)
    statement = statement.where(Provider.id == provider_id)
    statement = statement.where(Provider.is_active.is_(True))
    provider = session.scalar(statement)

    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found")

    return provider


def distinct_ids(ids: list[UUID]) -> list[UUID]:
    seen_ids: set[UUID] = set()
    distinct_ids: list[UUID] = []

    for id_value in ids:
        id_was_seen = id_value in seen_ids

        if id_was_seen:
            continue

        seen_ids.add(id_value)
        distinct_ids.append(id_value)

    return distinct_ids


def validate_no_duplicate_ids(
    ids: list[UUID],
    detail: str,
) -> None:
    distinct_id_values = distinct_ids(ids)
    has_duplicates = len(distinct_id_values) != len(ids)

    if has_duplicates:
        raise HTTPException(status_code=400, detail=detail)


def validate_no_duplicate_values(
    values: list[str],
    detail: str,
) -> None:
    seen_values: set[str] = set()

    for value in values:
        value_was_seen = value in seen_values

        if value_was_seen:
            raise HTTPException(status_code=400, detail=detail)

        seen_values.add(value)


def validate_center_ids(
    center_ids: list[UUID],
    organization_id: UUID,
    session: Session,
) -> list[UUID]:
    distinct_center_ids = distinct_ids(center_ids)

    if len(distinct_center_ids) == 0:
        return distinct_center_ids

    statement = select(Center.id)
    statement = statement.where(Center.organization_id == organization_id)
    statement = statement.where(Center.is_active.is_(True))
    statement = statement.where(Center.id.in_(distinct_center_ids))
    valid_center_ids = list(session.scalars(statement))

    if len(valid_center_ids) != len(distinct_center_ids):
        raise HTTPException(status_code=400, detail="Preference center not found")

    return distinct_center_ids


def visible_center_preferences(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> list[ProviderCenterPreference]:
    statement = select(ProviderCenterPreference)
    statement = statement.where(ProviderCenterPreference.organization_id == organization_id)
    statement = statement.where(ProviderCenterPreference.provider_id == provider_id)
    statement = statement.where(ProviderCenterPreference.is_active.is_(True))
    statement = statement.order_by(ProviderCenterPreference.center_id)
    preferences = list(session.scalars(statement))
    return preferences


def visible_shift_type_preferences(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> list[ProviderShiftTypePreference]:
    statement = select(ProviderShiftTypePreference)
    statement = statement.where(ProviderShiftTypePreference.organization_id == organization_id)
    statement = statement.where(ProviderShiftTypePreference.provider_id == provider_id)
    statement = statement.where(ProviderShiftTypePreference.is_active.is_(True))
    statement = statement.order_by(ProviderShiftTypePreference.shift_type)
    preferences = list(session.scalars(statement))
    return preferences


def manager_center_preferences(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> list[ManagerProviderCenterPreference]:
    statement = select(ManagerProviderCenterPreference)
    statement = statement.where(ManagerProviderCenterPreference.organization_id == organization_id)
    statement = statement.where(ManagerProviderCenterPreference.provider_id == provider_id)
    statement = statement.where(ManagerProviderCenterPreference.is_active.is_(True))
    statement = statement.order_by(ManagerProviderCenterPreference.center_id)
    preferences = list(session.scalars(statement))
    return preferences


def provider_preferences_response(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> ProviderPreferencesRead:
    center_preferences = visible_center_preferences(provider_id, organization_id, session)
    shift_type_preferences = visible_shift_type_preferences(provider_id, organization_id, session)
    center_reads = [
        ProviderCenterPreferenceRead.model_validate(preference)
        for preference in center_preferences
    ]
    shift_type_reads = [
        ProviderShiftTypePreferenceRead.model_validate(preference)
        for preference in shift_type_preferences
    ]
    response = ProviderPreferencesRead(
        provider_id=provider_id,
        center_preferences=center_reads,
        shift_type_preferences=shift_type_reads,
    )
    return response


def manager_preferences_response(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> ManagerProviderPreferencesRead:
    center_preferences = manager_center_preferences(provider_id, organization_id, session)
    center_reads = [
        ManagerProviderCenterPreferenceRead.model_validate(preference)
        for preference in center_preferences
    ]
    response = ManagerProviderPreferencesRead(
        provider_id=provider_id,
        center_preferences=center_reads,
    )
    return response


def delete_visible_preferences(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> None:
    center_statement = sqlalchemy_delete(ProviderCenterPreference)
    center_statement = center_statement.where(ProviderCenterPreference.organization_id == organization_id)
    center_statement = center_statement.where(ProviderCenterPreference.provider_id == provider_id)
    session.execute(center_statement)
    shift_type_statement = sqlalchemy_delete(ProviderShiftTypePreference)
    shift_type_statement = shift_type_statement.where(ProviderShiftTypePreference.organization_id == organization_id)
    shift_type_statement = shift_type_statement.where(ProviderShiftTypePreference.provider_id == provider_id)
    session.execute(shift_type_statement)


def delete_manager_preferences(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> None:
    statement = sqlalchemy_delete(ManagerProviderCenterPreference)
    statement = statement.where(ManagerProviderCenterPreference.organization_id == organization_id)
    statement = statement.where(ManagerProviderCenterPreference.provider_id == provider_id)
    session.execute(statement)


@router.get("/providers/{provider_id}/preferences", response_model=ProviderPreferencesRead)
def read_provider_preferences(
    provider_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> ProviderPreferencesRead:
    find_active_provider(provider_id, organization_id, session)
    response = provider_preferences_response(provider_id, organization_id, session)
    return response


@router.put("/providers/{provider_id}/preferences", response_model=ProviderPreferencesRead)
def replace_provider_preferences(
    provider_id: UUID,
    request: ProviderPreferencesReplace,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> ProviderPreferencesRead:
    find_active_provider(provider_id, organization_id, session)
    requested_center_ids = [
        preference.center_id
        for preference in request.center_preferences
    ]
    validate_center_ids(requested_center_ids, organization_id, session)
    validate_no_duplicate_ids(requested_center_ids, "Duplicate center preference")
    requested_shift_types = [
        preference.shift_type
        for preference in request.shift_type_preferences
    ]
    validate_no_duplicate_values(requested_shift_types, "Duplicate shift type preference")

    delete_visible_preferences(provider_id, organization_id, session)

    for preference in request.center_preferences:
        row = ProviderCenterPreference(
            organization_id=organization_id,
            provider_id=provider_id,
            center_id=preference.center_id,
            preference_level=preference.preference_level,
            is_active=True,
        )
        session.add(row)

    for preference in request.shift_type_preferences:
        row = ProviderShiftTypePreference(
            organization_id=organization_id,
            provider_id=provider_id,
            shift_type=preference.shift_type,
            preference_level=preference.preference_level,
            is_active=True,
        )
        session.add(row)

    session.commit()
    response = provider_preferences_response(provider_id, organization_id, session)
    return response


@router.get("/manager/providers/{provider_id}/preferences", response_model=ManagerProviderPreferencesRead)
def read_manager_provider_preferences(
    provider_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> ManagerProviderPreferencesRead:
    find_active_provider(provider_id, organization_id, session)
    response = manager_preferences_response(provider_id, organization_id, session)
    return response


@router.put("/manager/providers/{provider_id}/preferences", response_model=ManagerProviderPreferencesRead)
def replace_manager_provider_preferences(
    provider_id: UUID,
    request: ManagerProviderPreferencesReplace,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> ManagerProviderPreferencesRead:
    find_active_provider(provider_id, organization_id, session)
    requested_center_ids = [
        preference.center_id
        for preference in request.center_preferences
    ]
    validate_center_ids(requested_center_ids, organization_id, session)
    validate_no_duplicate_ids(requested_center_ids, "Duplicate manager center preference")

    delete_manager_preferences(provider_id, organization_id, session)

    for preference in request.center_preferences:
        row = ManagerProviderCenterPreference(
            organization_id=organization_id,
            provider_id=provider_id,
            center_id=preference.center_id,
            preference_level=preference.preference_level,
            is_active=True,
            manager_note=preference.manager_note,
        )
        session.add(row)

    session.commit()
    response = manager_preferences_response(provider_id, organization_id, session)
    return response
