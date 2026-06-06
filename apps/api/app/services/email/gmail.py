import smtplib
from email.message import EmailMessage
from email.utils import make_msgid

from app.services.email.provider_invites import ProviderInviteEmailMessage
from app.services.email.provider_invites import ProviderInviteEmailSendResult
from app.services.email.provider_invites import provider_invite_mime_message
from app.services.email.provider_invites import sent_provider_invite_result

GMAIL_SMTP_HOST = "smtp.gmail.com"
GMAIL_SMTP_PORT = 587
GMAIL_SMTP_TIMEOUT_SECONDS = 20


class GmailSendError(Exception):
    pass


class GmailProviderInviteEmailSender:
    def __init__(
        self,
        app_password: str,
        sender_email: str,
    ) -> None:
        self.app_password = app_password
        self.sender_email = sender_email

    def send_provider_invite(
        self,
        message: ProviderInviteEmailMessage,
    ) -> ProviderInviteEmailSendResult:
        gmail_message_id = self.message_id()
        mime_message = self.mime_message(message, gmail_message_id)
        self.deliver_mime_message(mime_message)
        result = sent_provider_invite_result(gmail_message_id)
        return result

    def message_id(self) -> str:
        sender_domain = self.sender_email_domain()
        gmail_message_id = make_msgid(domain=sender_domain)
        return gmail_message_id

    def sender_email_domain(self) -> str:
        sender_email_parts = self.sender_email.rsplit("@", 1)
        sender_domain = sender_email_parts[1]
        return sender_domain

    def mime_message(
        self,
        message: ProviderInviteEmailMessage,
        gmail_message_id: str,
    ) -> EmailMessage:
        mime_message = provider_invite_mime_message(message)
        mime_message["Message-ID"] = gmail_message_id
        return mime_message

    def deliver_mime_message(self, mime_message: EmailMessage) -> None:
        try:
            with smtplib.SMTP(
                GMAIL_SMTP_HOST,
                GMAIL_SMTP_PORT,
                timeout=GMAIL_SMTP_TIMEOUT_SECONDS,
            ) as smtp_client:
                smtp_client.starttls()
                smtp_client.login(self.sender_email, self.app_password)
                smtp_client.send_message(mime_message)
        except (OSError, smtplib.SMTPException) as error:
            error_message = str(error)
            raise GmailSendError(error_message) from error
