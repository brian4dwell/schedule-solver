from urllib.error import URLError
from urllib.parse import quote
from urllib.request import Request
from urllib.request import urlopen

from fastapi import HTTPException
from pydantic import BaseModel
from pydantic import EmailStr
from pydantic import ValidationError

from app.core.config import get_settings


class ClerkEmailVerification(BaseModel):
    status: str


class ClerkEmailAddress(BaseModel):
    email_address: EmailStr
    verification: ClerkEmailVerification | None


class ClerkUserIdentity(BaseModel):
    id: str
    email_addresses: list[ClerkEmailAddress]


def load_clerk_user_identity(user_id: str) -> ClerkUserIdentity:
    settings = get_settings()
    secret_key = settings.clerk_secret_key

    if secret_key is None:
        raise HTTPException(status_code=503, detail="Clerk identity verification is not configured")

    encoded_user_id = quote(user_id, safe="")
    url = f"https://api.clerk.com/v1/users/{encoded_user_id}"
    authorization = f"Bearer {secret_key.get_secret_value()}"
    request = Request(url, headers={"Authorization": authorization, "Accept": "application/json"})

    try:
        with urlopen(request, timeout=10) as response:
            response_body = response.read()
        identity = ClerkUserIdentity.model_validate_json(response_body)
    except (URLError, TimeoutError, ValidationError) as error:
        raise HTTPException(status_code=503, detail="Clerk identity verification failed") from error

    if identity.id != user_id:
        raise HTTPException(status_code=503, detail="Clerk identity verification failed")

    return identity


def require_verified_invite_email(user_id: str, invited_email: str) -> None:
    identity = load_clerk_user_identity(user_id)
    normalized_invited_email = invited_email.casefold()

    for email in identity.email_addresses:
        email_matches = str(email.email_address).casefold() == normalized_invited_email
        email_is_verified = email.verification is not None and email.verification.status == "verified"

        if email_matches and email_is_verified:
            return

    raise HTTPException(status_code=403, detail="Sign in with the verified email address that received this invite")
