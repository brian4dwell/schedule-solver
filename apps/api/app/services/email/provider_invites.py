from datetime import datetime
from email.message import EmailMessage
from html import escape

from pydantic import AnyUrl
from pydantic import BaseModel
from pydantic import EmailStr

from app.db.models import Provider
from app.db.models import ProviderInvite
from app.db.models.scheduling import current_utc_time


class ProviderInviteEmailMessage(BaseModel):
    recipient_email: EmailStr
    sender_email: EmailStr
    provider_display_name: str
    invite_url: AnyUrl
    subject: str
    plain_text_body: str
    html_body: str


class ProviderInviteEmailSendResult(BaseModel):
    gmail_message_id: str
    sent_at: datetime


def provider_invite_url(provider_portal_base_url: str, invite_token: str) -> str:
    normalized_base_url = provider_portal_base_url.rstrip("/")
    invite_url = f"{normalized_base_url}/provider-portal/accept?token={invite_token}"
    return invite_url


def provider_invite_subject(provider: Provider) -> str:
    subject = f"You're invited to the Provider Portal, {provider.display_name}"
    return subject


def provider_invite_plain_text_body(provider: Provider, invite_url: str) -> str:
    greeting = f"Hello {provider.display_name},"
    intro = "You've been invited to Schedule Solver's Provider Portal."
    purpose = (
        "Use the secure link below to set up access. "
        "After you sign in, you can submit availability for open schedule weeks, "
        "review your scheduling preferences, and keep your information current."
    )
    invitation_label = "Accept your invite:"
    security_note = "For your security, this link is intended only for you."
    unexpected_note = "If you were not expecting this invitation, you can ignore this email."
    closing = "Thank you,"
    signature = "Schedule Solver Team"
    body_lines = [
        greeting,
        "",
        intro,
        purpose,
        "",
        invitation_label,
        invite_url,
        "",
        security_note,
        unexpected_note,
        "",
        closing,
        signature,
    ]
    body = "\n".join(body_lines)
    return body


def provider_invite_html_body(provider: Provider, invite_url: str) -> str:
    escaped_display_name = escape(provider.display_name)
    escaped_invite_url = escape(invite_url, quote=True)
    greeting = f"<p>Hello {escaped_display_name},</p>"
    intro = "<p>You've been invited to Schedule Solver's Provider Portal.</p>"
    purpose = (
        "<p>Use the secure link below to set up access. "
        "After you sign in, you can submit availability for open schedule weeks, "
        "review your scheduling preferences, and keep your information current.</p>"
    )
    action = f'<p><a href="{escaped_invite_url}">Accept Provider Portal invite</a></p>'
    security_note = "<p>For your security, this link is intended only for you.</p>"
    unexpected_note = "<p>If you were not expecting this invitation, you can ignore this email.</p>"
    closing = "<p>Thank you,<br>Schedule Solver Team</p>"
    body_parts = [
        greeting,
        intro,
        purpose,
        action,
        security_note,
        unexpected_note,
        closing,
    ]
    body = "".join(body_parts)
    return body


def provider_invite_email_message(
    provider: Provider,
    invite: ProviderInvite,
    provider_portal_base_url: str,
    sender_email: str,
) -> ProviderInviteEmailMessage:
    invite_url = provider_invite_url(provider_portal_base_url, invite.invite_token)
    subject = provider_invite_subject(provider)
    plain_text_body = provider_invite_plain_text_body(provider, invite_url)
    html_body = provider_invite_html_body(provider, invite_url)
    message = ProviderInviteEmailMessage(
        recipient_email=invite.email,
        sender_email=sender_email,
        provider_display_name=provider.display_name,
        invite_url=invite_url,
        subject=subject,
        plain_text_body=plain_text_body,
        html_body=html_body,
    )
    return message


def provider_invite_mime_message(message: ProviderInviteEmailMessage) -> EmailMessage:
    mime_message = EmailMessage()
    mime_message["To"] = str(message.recipient_email)
    mime_message["From"] = str(message.sender_email)
    mime_message["Subject"] = message.subject
    mime_message.set_content(message.plain_text_body)
    mime_message.add_alternative(message.html_body, subtype="html")
    return mime_message


def sent_provider_invite_result(gmail_message_id: str) -> ProviderInviteEmailSendResult:
    sent_at = current_utc_time()
    result = ProviderInviteEmailSendResult(
        gmail_message_id=gmail_message_id,
        sent_at=sent_at,
    )
    return result
