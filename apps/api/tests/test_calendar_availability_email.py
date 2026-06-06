from datetime import date
from uuid import uuid4

from app.db.models import Provider
from app.db.models import SchedulePeriod
from app.services.email.calendar_availability import calendar_availability_email_message
from app.services.email.calendar_availability import provider_portal_url


def create_calendar_availability_provider() -> Provider:
    provider = Provider(
        id=uuid4(),
        organization_id=uuid4(),
        first_name="Pat",
        last_name="Provider",
        display_name="Pat Provider",
        email="pat.provider@example.com",
        phone=None,
        provider_type="doctor",
        employment_type="employee",
        is_active=True,
        notes=None,
    )
    return provider


def create_calendar_availability_schedule_period() -> SchedulePeriod:
    organization_id = uuid4()
    schedule_period = SchedulePeriod(
        id=uuid4(),
        organization_id=organization_id,
        name="Week of May 4, 2026",
        start_date=date(2026, 5, 4),
        end_date=date(2026, 5, 10),
        status="draft",
    )
    return schedule_period


def test_provider_portal_url_targets_provider_portal_workspace() -> None:
    portal_url = provider_portal_url("https://scheduler.example/")

    assert portal_url == "https://scheduler.example/provider-portal"


def test_calendar_availability_email_message_names_new_schedule_week() -> None:
    provider = create_calendar_availability_provider()
    schedule_period = create_calendar_availability_schedule_period()

    message = calendar_availability_email_message(
        provider,
        schedule_period,
        "https://scheduler.example",
        "scheduling@gmail.com",
    )

    assert message.recipient_email == "pat.provider@example.com"
    assert message.sender_email == "scheduling@gmail.com"
    assert message.subject == "New availability request: Week of May 4, 2026"
    assert "A new schedule week is open for Week of May 4, 2026." in message.plain_text_body
    assert "2026-05-04 through 2026-05-10" in message.plain_text_body
    assert "https://scheduler.example/provider-portal" in message.plain_text_body
    assert "Open the Provider Portal" in message.html_body
