from typing import Annotated
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from fastapi import Cookie
from fastapi import Depends
from fastapi import Header
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.auth import AuthenticatedUser
from app.core.auth import local_development_user
from app.core.auth import session_token_from_request
from app.core.auth import user_has_admin_role
from app.core.auth import verify_clerk_session_token
from app.core.config import get_settings
from app.db.models import Organization
from app.db.models import Provider
from app.db.models import ProviderIdentityLink
from app.db.session import get_db


LOCAL_ORGANIZATION_ID = UUID("00000000-0000-4000-8000-000000000001")


@dataclass(frozen=True)
class CurrentProvider:
    user: AuthenticatedUser
    provider: Provider


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


def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    session_cookie: Annotated[str | None, Cookie(alias="__session")] = None,
) -> AuthenticatedUser:
    settings = get_settings()
    is_development_environment = settings.environment == "development"
    uses_local_auth = settings.auth_mode == "local"
    should_block_local_auth = not is_development_environment and uses_local_auth

    if should_block_local_auth:
        raise RuntimeError("Local auth_mode is only allowed in development environment")

    if uses_local_auth:
        user = local_development_user()
        return user

    token = session_token_from_request(authorization, session_cookie)
    user = verify_clerk_session_token(token, settings)
    return user


def require_admin_user(
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    has_admin_role = user_has_admin_role(current_user)

    if not has_admin_role:
        raise HTTPException(status_code=403, detail="Admin role required")

    return current_user


def get_current_organization_id(
    current_user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> UUID:
    organization = get_default_organization(session)
    organization_id = organization.id
    return organization_id


def require_current_provider(
    current_user: AuthenticatedUser = Depends(get_current_user),
    organization_id: UUID = Depends(get_current_organization_id),
    session: Session = Depends(get_db),
) -> CurrentProvider:
    statement = select(ProviderIdentityLink)
    statement = statement.where(ProviderIdentityLink.organization_id == organization_id)
    statement = statement.where(ProviderIdentityLink.clerk_user_id == current_user.user_id)
    identity_link = session.scalar(statement)

    if identity_link is None:
        raise HTTPException(status_code=403, detail="Provider account link required")

    provider_statement = select(Provider)
    provider_statement = provider_statement.where(Provider.organization_id == organization_id)
    provider_statement = provider_statement.where(Provider.id == identity_link.provider_id)
    provider = session.scalar(provider_statement)

    if provider is None:
        raise HTTPException(status_code=403, detail="Provider profile not found")

    if not provider.is_active:
        raise HTTPException(status_code=403, detail="Provider profile is inactive")

    current_provider = CurrentProvider(user=current_user, provider=provider)
    return current_provider
