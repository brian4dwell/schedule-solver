from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm import selectinload

from app.db.models import Assignment
from app.db.models import Center
from app.db.models import Provider
from app.db.models import ProviderCenterCredential
from app.db.models import ProviderRoomTypeSkill
from app.db.models import RoomType
from app.db.session import get_db
from app.dependencies import get_current_organization_id
from app.schemas.provider import ProviderCreate
from app.schemas.provider import ProviderRead
from app.schemas.provider import ProviderUpdate

router = APIRouter(prefix="/providers", tags=["providers"])


def find_provider(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> Provider:
    statement = select(Provider).where(Provider.id == provider_id)
    statement = statement.where(Provider.organization_id == organization_id)
    statement = statement.options(selectinload(Provider.center_credentials))
    statement = statement.options(selectinload(Provider.room_type_skills))
    provider = session.scalar(statement)

    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found")

    return provider


def distinct_ids(ids: list[UUID]) -> list[UUID]:
    seen_ids: set[UUID] = set()
    distinct_ids: list[UUID] = []

    for id_value in ids:
        if id_value in seen_ids:
            continue

        seen_ids.add(id_value)
        distinct_ids.append(id_value)

    return distinct_ids


def validate_centers(
    center_ids: list[UUID],
    organization_id: UUID,
    session: Session,
) -> list[UUID]:
    credentialed_center_ids = distinct_ids(center_ids)

    if len(credentialed_center_ids) == 0:
        return credentialed_center_ids

    statement = select(Center.id).where(Center.organization_id == organization_id)
    statement = statement.where(Center.id.in_(credentialed_center_ids))
    valid_center_ids = list(session.scalars(statement))

    if len(valid_center_ids) != len(credentialed_center_ids):
        raise HTTPException(status_code=400, detail="Credentialed center not found")

    return credentialed_center_ids


def validate_room_types(
    room_type_ids: list[UUID],
    organization_id: UUID,
    session: Session,
) -> list[UUID]:
    skill_room_type_ids = distinct_ids(room_type_ids)

    if len(skill_room_type_ids) == 0:
        return skill_room_type_ids

    statement = select(RoomType).where(RoomType.organization_id == organization_id)
    statement = statement.where(RoomType.id.in_(skill_room_type_ids))
    room_types = list(session.scalars(statement))

    if len(room_types) != len(skill_room_type_ids):
        raise HTTPException(status_code=400, detail="Skill room type not found")

    for room_type in room_types:
        if room_type.is_active:
            continue

        raise HTTPException(status_code=400, detail="Skill room type is inactive")

    return skill_room_type_ids


def provider_has_assignments_for_center(
    provider: Provider,
    center_id: UUID,
    organization_id: UUID,
    session: Session,
) -> bool:
    statement = select(Assignment.id).where(Assignment.organization_id == organization_id)
    statement = statement.where(Assignment.provider_id == provider.id)
    statement = statement.where(Assignment.center_id == center_id)
    statement = statement.limit(1)
    assignment_id = session.scalar(statement)
    has_assignment = assignment_id is not None
    return has_assignment


def replace_provider_center_credentials(
    provider: Provider,
    center_ids: list[UUID],
    organization_id: UUID,
    session: Session,
) -> None:
    credentialed_center_ids = validate_centers(center_ids, organization_id, session)
    current_center_ids = [
        credential.center_id
        for credential in provider.center_credentials
    ]
    removed_center_ids = [
        center_id
        for center_id in current_center_ids
        if center_id not in credentialed_center_ids
    ]
    added_center_ids = [
        center_id
        for center_id in credentialed_center_ids
        if center_id not in current_center_ids
    ]

    for removed_center_id in removed_center_ids:
        has_assignment = provider_has_assignments_for_center(
            provider,
            removed_center_id,
            organization_id,
            session,
        )

        if has_assignment:
            raise HTTPException(
                status_code=409,
                detail="Provider has existing assignments at a removed credentialed center",
            )

    remaining_credentials = [
        credential
        for credential in provider.center_credentials
        if credential.center_id not in removed_center_ids
    ]
    provider.center_credentials = remaining_credentials

    for center_id in added_center_ids:
        credential = ProviderCenterCredential(
            organization_id=organization_id,
            provider_id=provider.id,
            center_id=center_id,
        )
        provider.center_credentials.append(credential)


def replace_provider_room_type_skills(
    provider: Provider,
    room_type_ids: list[UUID],
    organization_id: UUID,
    session: Session,
) -> None:
    skill_room_type_ids = validate_room_types(room_type_ids, organization_id, session)
    current_room_type_ids = [
        skill.room_type_id
        for skill in provider.room_type_skills
    ]
    removed_room_type_ids = [
        room_type_id
        for room_type_id in current_room_type_ids
        if room_type_id not in skill_room_type_ids
    ]
    added_room_type_ids = [
        room_type_id
        for room_type_id in skill_room_type_ids
        if room_type_id not in current_room_type_ids
    ]
    remaining_skills = [
        skill
        for skill in provider.room_type_skills
        if skill.room_type_id not in removed_room_type_ids
    ]
    provider.room_type_skills = remaining_skills

    for room_type_id in added_room_type_ids:
        skill = ProviderRoomTypeSkill(
            organization_id=organization_id,
            provider_id=provider.id,
            room_type_id=room_type_id,
        )
        provider.room_type_skills.append(skill)


@router.get("", response_model=list[ProviderRead])
def list_providers(
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> list[Provider]:
    statement = select(Provider).where(Provider.organization_id == organization_id)
    statement = statement.order_by(Provider.display_name)
    statement = statement.options(selectinload(Provider.center_credentials))
    statement = statement.options(selectinload(Provider.room_type_skills))
    providers = list(session.scalars(statement))
    return providers


@router.post("", response_model=ProviderRead, status_code=201)
def create_provider(
    request: ProviderCreate,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> Provider:
    provider = Provider(
        organization_id=organization_id,
        first_name=request.first_name,
        last_name=request.last_name,
        display_name=request.display_name,
        email=request.email,
        phone=request.phone,
        provider_type=request.provider_type,
        employment_type=request.employment_type,
        notes=request.notes,
    )
    session.add(provider)
    session.flush()
    replace_provider_center_credentials(
        provider,
        request.credentialed_center_ids,
        organization_id,
        session,
    )
    replace_provider_room_type_skills(
        provider,
        request.skill_room_type_ids,
        organization_id,
        session,
    )
    session.commit()
    session.refresh(provider)
    return provider


@router.get("/{provider_id}", response_model=ProviderRead)
def read_provider(
    provider_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> Provider:
    provider = find_provider(provider_id, organization_id, session)
    return provider


@router.patch("/{provider_id}", response_model=ProviderRead)
def update_provider(
    provider_id: UUID,
    request: ProviderUpdate,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> Provider:
    provider = find_provider(provider_id, organization_id, session)

    if request.first_name is not None:
        provider.first_name = request.first_name

    if request.last_name is not None:
        provider.last_name = request.last_name

    if request.display_name is not None:
        provider.display_name = request.display_name

    if request.email is not None:
        provider.email = request.email

    if request.phone is not None:
        provider.phone = request.phone

    if request.provider_type is not None:
        provider.provider_type = request.provider_type

    if request.employment_type is not None:
        provider.employment_type = request.employment_type

    if request.notes is not None:
        provider.notes = request.notes

    if request.credentialed_center_ids is not None:
        replace_provider_center_credentials(
            provider,
            request.credentialed_center_ids,
            organization_id,
            session,
        )

    if request.skill_room_type_ids is not None:
        replace_provider_room_type_skills(
            provider,
            request.skill_room_type_ids,
            organization_id,
            session,
        )

    session.commit()
    session.refresh(provider)
    return provider


@router.delete("/{provider_id}", response_model=ProviderRead)
def deactivate_provider(
    provider_id: UUID,
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> Provider:
    provider = find_provider(provider_id, organization_id, session)
    provider.is_active = False
    session.commit()
    session.refresh(provider)
    return provider
