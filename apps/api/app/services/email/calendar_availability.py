from datetime import date
from datetime import datetime
from email.message import EmailMessage
from html import escape

from pydantic import AnyUrl
from pydantic import BaseModel
from pydantic import EmailStr

from app.db.models import Provider
from app.db.models import SchedulePeriod
from app.db.models.scheduling import current_utc_time


class CalendarAvailabilityEmailMessage(BaseModel):
    recipient_email: EmailStr
    sender_email: EmailStr
    provider_display_name: str
    schedule_week_name: str
    schedule_week_start_date: date
    schedule_week_end_date: date
    provider_portal_url: AnyUrl
    subject: str
    plain_text_body: str
    html_body: str


class CalendarAvailabilityEmailSendResult(BaseModel):
    gmail_message_id: str
    sent_at: datetime


def provider_portal_url(provider_portal_base_url: str) -> str:
    normalized_base_url = provider_portal_base_url.rstrip("/")
    portal_url = f"{normalized_base_url}/provider-portal"
    return portal_url


def schedule_week_date_range(schedule_week: SchedulePeriod) -> str:
    start_date_text = schedule_week.start_date.isoformat()
    end_date_text = schedule_week.end_date.isoformat()
    date_range = f"{start_date_text} through {end_date_text}"
    return date_range


def calendar_availability_subject(schedule_week: SchedulePeriod) -> str:
    subject = f"New availability request: {schedule_week.name}"
    return subject


def calendar_availability_plain_text_body(
    provider: Provider,
    schedule_week: SchedulePeriod,
    portal_url: str,
) -> str:
    greeting = f"Hello {provider.display_name},"
    week_date_range = schedule_week_date_range(schedule_week)
    intro = f"A new schedule week is open for {schedule_week.name}."
    request = f"Please submit your calendar availability for {week_date_range}."
    action_label = "Open the Provider Portal:"
    timing_note = "Submitting availability helps the scheduling team build the draft schedule."
    closing = "Thank you,"
    signature = "Schedule Solver Team"
    body_lines = [
        greeting,
        "",
        intro,
        request,
        "",
        action_label,
        portal_url,
        "",
        timing_note,
        "",
        closing,
        signature,
    ]
    body = "\n".join(body_lines)
    return body


def calendar_availability_html_body(
    provider: Provider,
    schedule_week: SchedulePeriod,
    portal_url: str,
) -> str:
    escaped_display_name = escape(provider.display_name)
    escaped_schedule_week_name = escape(schedule_week.name)
    escaped_week_date_range = escape(schedule_week_date_range(schedule_week))
    escaped_portal_url = escape(portal_url, quote=True)
    greeting = f"<p>Hello {escaped_display_name},</p>"
    intro = f"<p>A new schedule week is open for {escaped_schedule_week_name}.</p>"
    request = f"<p>Please submit your calendar availability for {escaped_week_date_range}.</p>"
    action = f'<p><a href="{escaped_portal_url}">Open the Provider Portal</a></p>'
    timing_note = "<p>Submitting availability helps the scheduling team build the draft schedule.</p>"
    closing = "<p>Thank you,<br>Schedule Solver Team</p>"
    body_parts = [
        greeting,
        intro,
        request,
        action,
        timing_note,
        closing,
    ]
    body = "".join(body_parts)
    return body


def calendar_availability_email_message(
    provider: Provider,
    schedule_week: SchedulePeriod,
    provider_portal_base_url: str,
    sender_email: str,
) -> CalendarAvailabilityEmailMessage:
    portal_url = provider_portal_url(provider_portal_base_url)
    subject = calendar_availability_subject(schedule_week)
    plain_text_body = calendar_availability_plain_text_body(provider, schedule_week, portal_url)
    html_body = calendar_availability_html_body(provider, schedule_week, portal_url)
    recipient_email = provider.email

    if recipient_email is None:
        raise ValueError("Provider email is required")

    message = CalendarAvailabilityEmailMessage(
        recipient_email=recipient_email,
        sender_email=sender_email,
        provider_display_name=provider.display_name,
        schedule_week_name=schedule_week.name,
        schedule_week_start_date=schedule_week.start_date,
        schedule_week_end_date=schedule_week.end_date,
        provider_portal_url=portal_url,
        subject=subject,
        plain_text_body=plain_text_body,
        html_body=html_body,
    )
    return message


def calendar_availability_mime_message(message: CalendarAvailabilityEmailMessage) -> EmailMessage:
    mime_message = EmailMessage()
    mime_message["To"] = str(message.recipient_email)
    mime_message["From"] = str(message.sender_email)
    mime_message["Subject"] = message.subject
    mime_message.set_content(message.plain_text_body)
    mime_message.add_alternative(message.html_body, subtype="html")
    return mime_message


def sent_calendar_availability_result(gmail_message_id: str) -> CalendarAvailabilityEmailSendResult:
    sent_at = current_utc_time()
    result = CalendarAvailabilityEmailSendResult(
        gmail_message_id=gmail_message_id,
        sent_at=sent_at,
    )
    return result
