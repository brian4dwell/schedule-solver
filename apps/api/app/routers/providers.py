from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Provider
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
    provider = session.scalar(statement)

    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found")

    return provider


@router.get("", response_model=list[ProviderRead])
def list_providers(
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> list[Provider]:
    statement = select(Provider).where(Provider.organization_id == organization_id)
    statement = statement.order_by(Provider.display_name)
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
