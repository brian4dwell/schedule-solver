from secrets import token_urlsafe
from datetime import UTC
from datetime import timedelta
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import AuthenticatedUser
from app.db.models import Provider
from app.db.models import ProviderIdentityLink
from app.db.models import ProviderInvite
from app.db.models.scheduling import current_utc_time
from app.schemas.provider_portal import ProviderInviteAcceptanceRequest
from app.schemas.provider_portal import ProviderInviteCreate
from app.schemas.provider_portal import ProviderPortalInviteAcceptanceRead
from app.schemas.provider_portal import ProviderPortalProfileRead
from app.services.clerk_identity import require_verified_invite_email

INVITE_TOKEN_BYTE_COUNT = 32
INVITE_STATUS_INVITED = "invited"
INVITE_STATUS_ACCEPTED = "accepted"
INVITE_LIFETIME = timedelta(days=7)


def provider_profile(provider: Provider) -> ProviderPortalProfileRead:
    profile = ProviderPortalProfileRead(
        provider_id=provider.id,
        display_name=provider.display_name,
        email=provider.email,
    )
    return profile


def require_active_provider(provider_id: UUID, organization_id: UUID, session: Session) -> Provider:
    statement = select(Provider)
    statement = statement.where(Provider.id == provider_id)
    statement = statement.where(Provider.organization_id == organization_id)
    statement = statement.where(Provider.is_active.is_(True))
    provider = session.scalar(statement)

    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found")

    return provider


def provider_invite_email(provider: Provider, request: ProviderInviteCreate) -> str:
    requested_email = request.email

    if requested_email is not None:
        return str(requested_email)

    provider_email = provider.email

    if provider_email is None:
        raise HTTPException(status_code=400, detail="Provider email is required before inviting")

    return provider_email


def existing_provider_invite(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> ProviderInvite | None:
    statement = select(ProviderInvite)
    statement = statement.where(ProviderInvite.provider_id == provider_id)
    statement = statement.where(ProviderInvite.organization_id == organization_id)
    statement = statement.with_for_update()
    statement = statement.execution_options(populate_existing=True)
    invite = session.scalar(statement)
    return invite


def provider_identity_link(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> ProviderIdentityLink | None:
    statement = select(ProviderIdentityLink)
    statement = statement.where(ProviderIdentityLink.provider_id == provider_id)
    statement = statement.where(ProviderIdentityLink.organization_id == organization_id)
    identity_link = session.scalar(statement)
    return identity_link


def user_identity_link(
    clerk_user_id: str,
    organization_id: UUID,
    session: Session,
) -> ProviderIdentityLink | None:
    statement = select(ProviderIdentityLink)
    statement = statement.where(ProviderIdentityLink.clerk_user_id == clerk_user_id)
    statement = statement.where(ProviderIdentityLink.organization_id == organization_id)
    identity_link = session.scalar(statement)
    return identity_link


def provider_for_identity_link(
    identity_link: ProviderIdentityLink,
    organization_id: UUID,
    session: Session,
) -> Provider | None:
    statement = select(Provider)
    statement = statement.where(Provider.id == identity_link.provider_id)
    statement = statement.where(Provider.organization_id == organization_id)
    provider = session.scalar(statement)
    return provider


def require_provider_is_unlinked(
    provider_id: UUID,
    organization_id: UUID,
    session: Session,
) -> None:
    existing_link = provider_identity_link(provider_id, organization_id, session)

    if existing_link is not None:
        raise HTTPException(status_code=409, detail="Provider is already linked")


def create_or_reset_provider_invite(
    provider: Provider,
    request: ProviderInviteCreate,
    organization_id: UUID,
    session: Session,
) -> ProviderInvite:
    invite_email = provider_invite_email(provider, request)
    invite = existing_provider_invite(provider.id, organization_id, session)
    require_provider_is_unlinked(provider.id, organization_id, session)
    invite_token = token_urlsafe(INVITE_TOKEN_BYTE_COUNT)
    expires_at = current_utc_time() + INVITE_LIFETIME

    if invite is None:
        invite = ProviderInvite(
            organization_id=organization_id,
            provider_id=provider.id,
            email=invite_email,
            invite_token=invite_token,
            expires_at=expires_at,
            status=INVITE_STATUS_INVITED,
            accepted_by_clerk_user_id=None,
            accepted_at=None,
        )
        session.add(invite)
    else:
        invite.invite_token = invite_token
        invite.expires_at = expires_at
        invite.email = invite_email
        invite.status = INVITE_STATUS_INVITED
        invite.accepted_by_clerk_user_id = None
        invite.accepted_at = None

    return invite


def provider_invite_has_expired(invite: ProviderInvite) -> bool:
    expires_at = invite.expires_at

    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)

    invite_has_expired = expires_at <= current_utc_time()
    return invite_has_expired


def invite_for_acceptance(
    invite_token: str,
    organization_id: UUID,
    session: Session,
) -> ProviderInvite:
    statement = select(ProviderInvite)
    statement = statement.where(ProviderInvite.organization_id == organization_id)
    statement = statement.where(ProviderInvite.invite_token == invite_token)
    statement = statement.with_for_update()
    statement = statement.execution_options(populate_existing=True)
    invite = session.scalar(statement)

    if invite is None:
        raise HTTPException(status_code=404, detail="Provider invite not found")

    if invite.status != INVITE_STATUS_INVITED:
        raise HTTPException(status_code=409, detail="Provider invite has already been used")

    invite_has_expired = provider_invite_has_expired(invite)

    if invite_has_expired:
        raise HTTPException(status_code=410, detail="Provider invite has expired; request a new invite")

    return invite


def accept_provider_invite_request(
    request: ProviderInviteAcceptanceRequest,
    current_user: AuthenticatedUser,
    organization_id: UUID,
    session: Session,
) -> ProviderPortalInviteAcceptanceRead:
    invite = invite_for_acceptance(request.invite_token, organization_id, session)
    require_verified_invite_email(current_user.user_id, invite.email)
    provider = require_active_provider(invite.provider_id, organization_id, session)
    existing_provider_link = provider_identity_link(provider.id, organization_id, session)
    existing_user_link = user_identity_link(current_user.user_id, organization_id, session)
    provider_link_conflicts = (
        existing_provider_link is not None
        and existing_provider_link.clerk_user_id != current_user.user_id
    )

    if provider_link_conflicts:
        raise HTTPException(status_code=409, detail="Provider is already linked to another user")

    if existing_user_link is None:
        identity_link = ProviderIdentityLink(
            organization_id=organization_id,
            provider_id=provider.id,
            clerk_user_id=current_user.user_id,
        )
        session.add(identity_link)
    else:
        user_is_linked_to_invited_provider = existing_user_link.provider_id == provider.id

        if not user_is_linked_to_invited_provider:
            linked_provider = provider_for_identity_link(existing_user_link, organization_id, session)
            inactive_provider_link_can_move = (
                linked_provider is not None
                and not linked_provider.is_active
            )

            if not inactive_provider_link_can_move:
                raise HTTPException(status_code=409, detail="User is already linked to another Provider")

            existing_user_link.provider_id = provider.id

    invite.status = INVITE_STATUS_ACCEPTED
    invite.accepted_by_clerk_user_id = current_user.user_id
    invite.accepted_at = current_utc_time()
    session.commit()
    profile = provider_profile(provider)
    response = ProviderPortalInviteAcceptanceRead(provider=profile)
    return response
