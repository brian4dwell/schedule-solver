from email.message import EmailMessage
from types import TracebackType

from pytest import MonkeyPatch

from app.services.email.calendar_availability import CalendarAvailabilityEmailMessage
from app.services.email.gmail import GMAIL_SMTP_HOST
from app.services.email.gmail import GMAIL_SMTP_PORT
from app.services.email.gmail import GMAIL_SMTP_TIMEOUT_SECONDS
from app.services.email.gmail import GmailProviderInviteEmailSender
from app.services.email.provider_invites import ProviderInviteEmailMessage


class FakeSmtpClient:
    last_instance: "FakeSmtpClient | None" = None

    def __init__(self, host: str, port: int, timeout: int) -> None:
        self.host = host
        self.port = port
        self.timeout = timeout
        self.started_tls = False
        self.login_email: str | None = None
        self.login_password: str | None = None
        self.sent_message: EmailMessage | None = None
        FakeSmtpClient.last_instance = self

    def __enter__(self) -> "FakeSmtpClient":
        return self

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        return None

    def starttls(self) -> None:
        self.started_tls = True

    def login(self, sender_email: str, app_password: str) -> None:
        self.login_email = sender_email
        self.login_password = app_password

    def send_message(self, message: EmailMessage) -> None:
        self.sent_message = message


def provider_invite_email_message() -> ProviderInviteEmailMessage:
    message = ProviderInviteEmailMessage(
        recipient_email="provider@example.com",
        sender_email="scheduling@gmail.com",
        provider_display_name="Pat Provider",
        invite_url="https://scheduler.example/provider-portal/accept?token=token-123",
        subject="Provider Portal invite",
        plain_text_body="Accept the invite.",
        html_body="<p>Accept the invite.</p>",
    )
    return message


def test_gmail_sender_delivers_provider_invite_through_smtp_app_password(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.email.gmail.smtplib.SMTP", FakeSmtpClient)
    message = provider_invite_email_message()
    sender = GmailProviderInviteEmailSender("sixteen-digit-code", "scheduling@gmail.com")

    result = sender.send_provider_invite(message)

    smtp_client = FakeSmtpClient.last_instance
    assert smtp_client is not None
    assert smtp_client.host == GMAIL_SMTP_HOST
    assert smtp_client.port == GMAIL_SMTP_PORT
    assert smtp_client.timeout == GMAIL_SMTP_TIMEOUT_SECONDS
    assert smtp_client.started_tls is True
    assert smtp_client.login_email == "scheduling@gmail.com"
    assert smtp_client.login_password == "sixteen-digit-code"
    assert smtp_client.sent_message is not None
    assert smtp_client.sent_message["Message-ID"] == result.gmail_message_id
    assert smtp_client.sent_message["From"] == "scheduling@gmail.com"
    assert smtp_client.sent_message["To"] == "provider@example.com"


def calendar_availability_email_message() -> CalendarAvailabilityEmailMessage:
    message = CalendarAvailabilityEmailMessage(
        recipient_email="provider@example.com",
        sender_email="scheduling@gmail.com",
        provider_display_name="Pat Provider",
        schedule_week_name="Week of May 4, 2026",
        schedule_week_start_date="2026-05-04",
        schedule_week_end_date="2026-05-10",
        provider_portal_url="https://scheduler.example/provider-portal",
        subject="New availability request: Week of May 4, 2026",
        plain_text_body="Submit your availability.",
        html_body="<p>Submit your availability.</p>",
    )
    return message


def test_gmail_sender_delivers_calendar_availability_through_smtp_app_password(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.email.gmail.smtplib.SMTP", FakeSmtpClient)
    message = calendar_availability_email_message()
    sender = GmailProviderInviteEmailSender("sixteen-digit-code", "scheduling@gmail.com")

    result = sender.send_calendar_availability(message)

    smtp_client = FakeSmtpClient.last_instance
    assert smtp_client is not None
    assert smtp_client.host == GMAIL_SMTP_HOST
    assert smtp_client.port == GMAIL_SMTP_PORT
    assert smtp_client.timeout == GMAIL_SMTP_TIMEOUT_SECONDS
    assert smtp_client.started_tls is True
    assert smtp_client.login_email == "scheduling@gmail.com"
    assert smtp_client.login_password == "sixteen-digit-code"
    assert smtp_client.sent_message is not None
    assert smtp_client.sent_message["Message-ID"] == result.gmail_message_id
    assert smtp_client.sent_message["From"] == "scheduling@gmail.com"
    assert smtp_client.sent_message["To"] == "provider@example.com"
