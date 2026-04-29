from uuid import UUID

from sqlalchemy import select
from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Organization
from app.db.session import get_db


LOCAL_ORGANIZATION_ID = UUID("00000000-0000-4000-8000-000000000001")


def get_default_organization(session: Session) -> Organization:
    statement = select(Organization).where(Organization.id == LOCAL_ORGANIZATION_ID)
    organization = session.scalar(statement)

    if organization is not None:
        return organization

    settings = get_settings()
    new_organization = Organization(
        id=LOCAL_ORGANIZATION_ID,
        name=settings.local_organization_name,
    )
    session.add(new_organization)
    session.commit()
    session.refresh(new_organization)

    return new_organization


def get_current_organization_id(session: Session = Depends(get_db)) -> UUID:
    organization = get_default_organization(session)
    organization_id = organization.id
    return organization_id
