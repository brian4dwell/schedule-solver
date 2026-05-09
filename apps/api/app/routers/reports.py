from calendar import monthrange
from dataclasses import dataclass
from datetime import date
from datetime import datetime
from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Assignment
from app.db.models import Center
from app.db.models import Provider
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import Room
from app.db.models import SchedulePeriod
from app.db.models import ScheduleVersion
from app.db.session import get_db
from app.dependencies import get_current_organization_id
from app.schemas.provider_availability_week import WORK_AVAILABILITY_OPTION_VALUES
from app.schemas.provider_availability_week import WEEKDAY_VALUES
from app.schemas.reports import MonthlyAvailabilityDayRead
from app.schemas.reports import MonthlyAvailabilityProviderRead
from app.schemas.reports import MonthlyAvailabilityReportRead
from app.schemas.reports import MonthlyScheduleAssignmentRead
from app.schemas.reports import MonthlyScheduleCandidateGroupRead
from app.schemas.reports import MonthlyScheduleCandidateRead

router = APIRouter(prefix="/reports", tags=["reports"])
MINIMUM_YEAR = 2000
MAXIMUM_YEAR = 2100
MINIMUM_MONTH = 1
MAXIMUM_MONTH = 12


@dataclass(frozen=True)
class MonthlyAvailabilityRow:
    schedule_period_id: UUID
    schedule_period_name: str
    schedule_period_start_date: date
    schedule_period_end_date: date
    provider_id: UUID
    provider_display_name: str
    weekday: str
    availability_options: list[str]


@dataclass(frozen=True)
class LatestScheduleCandidate:
    schedule_period_id: UUID
    schedule_period_name: str
    start_date: date
    end_date: date
    latest_schedule_version_id: UUID
    latest_schedule_version_number: int
    latest_schedule_version_status: str
    latest_schedule_version_updated_at: datetime


@dataclass(frozen=True)
class SelectedSchedulePeriod:
    group_key: str
    schedule_period_id: UUID


@dataclass(frozen=True)
class MonthlyScheduleAssignmentRow:
    assignment_id: UUID
    schedule_period_id: UUID
    schedule_period_name: str
    schedule_version_id: UUID
    schedule_version_number: int
    schedule_version_status: str
    provider_id: UUID
    center_id: UUID
    center_name: str
    room_id: UUID | None
    room_name: str | None
    shift_type: str
    schedule_date: date
    start_time: datetime
    end_time: datetime


def validate_month(month: int) -> None:
    month_is_too_low = month < MINIMUM_MONTH
    month_is_too_high = month > MAXIMUM_MONTH
    month_is_invalid = month_is_too_low or month_is_too_high

    if month_is_invalid:
        raise HTTPException(status_code=400, detail="Month must be between 1 and 12")


def validate_year(year: int) -> None:
    year_is_too_low = year < MINIMUM_YEAR
    year_is_too_high = year > MAXIMUM_YEAR
    year_is_invalid = year_is_too_low or year_is_too_high

    if year_is_invalid:
        raise HTTPException(status_code=400, detail="Year must be between 2000 and 2100")


def month_start_date(year: int, month: int) -> date:
    validate_year(year)
    validate_month(month)
    start_date = date(year, month, 1)
    return start_date


def month_end_date(year: int, month: int) -> date:
    validate_year(year)
    validate_month(month)
    last_day = monthrange(year, month)[1]
    end_date = date(year, month, last_day)
    return end_date


def dates_between(start_date: date, end_date: date) -> list[date]:
    current_date = start_date
    dates: list[date] = []

    while current_date <= end_date:
        dates.append(current_date)
        next_date = current_date + timedelta(days=1)
        current_date = next_date

    return dates


def weekday_for_date(value: date) -> str:
    weekday_index = value.weekday()
    weekday = WEEKDAY_VALUES[weekday_index]
    return weekday


def date_range_group_key(start_date: date, end_date: date) -> str:
    group_key = f"{start_date.isoformat()}:{end_date.isoformat()}"
    return group_key


def work_options_from_availability_options(options: list[str]) -> list[str]:
    work_options: list[str] = []

    for option in WORK_AVAILABILITY_OPTION_VALUES:
        option_is_selected = option in options

        if option_is_selected:
            work_options.append(option)

    return work_options


def latest_schedule_candidate_from_result(
    schedule_period: SchedulePeriod,
    schedule_version: ScheduleVersion,
) -> LatestScheduleCandidate:
    candidate = LatestScheduleCandidate(
        schedule_period_id=schedule_period.id,
        schedule_period_name=schedule_period.name,
        start_date=schedule_period.start_date,
        end_date=schedule_period.end_date,
        latest_schedule_version_id=schedule_version.id,
        latest_schedule_version_number=schedule_version.version_number,
        latest_schedule_version_status=schedule_version.status,
        latest_schedule_version_updated_at=schedule_version.updated_at,
    )
    return candidate


def latest_schedule_candidates(
    organization_id: UUID,
    start_date: date,
    end_date: date,
    session: Session,
) -> list[LatestScheduleCandidate]:
    statement = select(SchedulePeriod, ScheduleVersion)
    statement = statement.join(
        ScheduleVersion,
        ScheduleVersion.schedule_period_id == SchedulePeriod.id,
    )
    statement = statement.where(SchedulePeriod.organization_id == organization_id)
    statement = statement.where(ScheduleVersion.organization_id == organization_id)
    statement = statement.where(SchedulePeriod.start_date <= end_date)
    statement = statement.where(SchedulePeriod.end_date >= start_date)
    statement = statement.order_by(SchedulePeriod.start_date)
    statement = statement.order_by(SchedulePeriod.id)
    statement = statement.order_by(ScheduleVersion.version_number.desc())
    results = session.execute(statement).all()
    seen_schedule_period_ids: set[UUID] = set()
    candidates: list[LatestScheduleCandidate] = []

    for schedule_period, schedule_version in results:
        already_seen = schedule_period.id in seen_schedule_period_ids

        if already_seen:
            continue

        seen_schedule_period_ids.add(schedule_period.id)
        candidate = latest_schedule_candidate_from_result(schedule_period, schedule_version)
        candidates.append(candidate)

    return candidates


def candidates_for_group(
    group_key: str,
    candidates: list[LatestScheduleCandidate],
) -> list[LatestScheduleCandidate]:
    matching_candidates: list[LatestScheduleCandidate] = []

    for candidate in candidates:
        candidate_group_key = date_range_group_key(candidate.start_date, candidate.end_date)
        candidate_matches = candidate_group_key == group_key

        if candidate_matches:
            matching_candidates.append(candidate)

    return matching_candidates


def sorted_schedule_candidates(
    candidates: list[LatestScheduleCandidate],
) -> list[LatestScheduleCandidate]:
    sorted_candidates = sorted(
        candidates,
        key=lambda candidate: (
            candidate.latest_schedule_version_updated_at,
            candidate.latest_schedule_version_number,
            candidate.schedule_period_name,
        ),
        reverse=True,
    )
    return sorted_candidates


def selected_schedule_period_for_group(
    group_candidates: list[LatestScheduleCandidate],
    requested_schedule_period_ids: list[UUID],
) -> UUID:
    requested_schedule_period_id_set = set(requested_schedule_period_ids)

    for candidate in group_candidates:
        candidate_was_requested = candidate.schedule_period_id in requested_schedule_period_id_set

        if candidate_was_requested:
            return candidate.schedule_period_id

    sorted_candidates = sorted_schedule_candidates(group_candidates)
    selected_candidate = sorted_candidates[0]
    selected_schedule_period_id = selected_candidate.schedule_period_id
    return selected_schedule_period_id


def selected_schedule_periods(
    candidates: list[LatestScheduleCandidate],
    requested_schedule_period_ids: list[UUID],
) -> list[SelectedSchedulePeriod]:
    group_keys = [
        date_range_group_key(candidate.start_date, candidate.end_date)
        for candidate in candidates
    ]
    unique_group_keys = sorted(set(group_keys))
    selections: list[SelectedSchedulePeriod] = []

    for group_key in unique_group_keys:
        group_candidates = candidates_for_group(group_key, candidates)
        selected_schedule_period_id = selected_schedule_period_for_group(
            group_candidates,
            requested_schedule_period_ids,
        )
        selection = SelectedSchedulePeriod(
            group_key=group_key,
            schedule_period_id=selected_schedule_period_id,
        )
        selections.append(selection)

    return selections


def selected_schedule_period_ids(
    selections: list[SelectedSchedulePeriod],
) -> list[UUID]:
    ids = [
        selection.schedule_period_id
        for selection in selections
    ]
    return ids


def selected_schedule_period_id_for_date(
    value: date,
    candidates: list[LatestScheduleCandidate],
    selections: list[SelectedSchedulePeriod],
) -> UUID | None:
    for candidate in candidates:
        date_is_after_start = value >= candidate.start_date
        date_is_before_end = value <= candidate.end_date
        date_is_inside_period = date_is_after_start and date_is_before_end

        if not date_is_inside_period:
            continue

        group_key = date_range_group_key(candidate.start_date, candidate.end_date)

        for selection in selections:
            selection_matches = selection.group_key == group_key

            if selection_matches:
                return selection.schedule_period_id

    return None


def candidate_read(candidate: LatestScheduleCandidate) -> MonthlyScheduleCandidateRead:
    read_model = MonthlyScheduleCandidateRead(
        schedule_period_id=candidate.schedule_period_id,
        schedule_period_name=candidate.schedule_period_name,
        start_date=candidate.start_date,
        end_date=candidate.end_date,
        latest_schedule_version_id=candidate.latest_schedule_version_id,
        latest_schedule_version_number=candidate.latest_schedule_version_number,
        latest_schedule_version_status=candidate.latest_schedule_version_status,
        latest_schedule_version_updated_at=candidate.latest_schedule_version_updated_at.isoformat(),
    )
    return read_model


def candidate_group_read(
    group_key: str,
    candidates: list[LatestScheduleCandidate],
    selections: list[SelectedSchedulePeriod],
) -> MonthlyScheduleCandidateGroupRead:
    group_candidates = candidates_for_group(group_key, candidates)
    sorted_candidates = sorted_schedule_candidates(group_candidates)
    selected_schedule_period_id = selected_schedule_period_for_group(
        group_candidates,
        selected_schedule_period_ids(selections),
    )
    candidate_reads = [
        candidate_read(candidate)
        for candidate in sorted_candidates
    ]
    first_candidate = sorted_candidates[0]
    read_model = MonthlyScheduleCandidateGroupRead(
        group_key=group_key,
        start_date=first_candidate.start_date,
        end_date=first_candidate.end_date,
        selected_schedule_period_id=selected_schedule_period_id,
        candidates=candidate_reads,
    )
    return read_model


def schedule_candidate_groups(
    candidates: list[LatestScheduleCandidate],
    selections: list[SelectedSchedulePeriod],
) -> list[MonthlyScheduleCandidateGroupRead]:
    group_keys = [
        date_range_group_key(candidate.start_date, candidate.end_date)
        for candidate in candidates
    ]
    unique_group_keys = sorted(set(group_keys))
    groups: list[MonthlyScheduleCandidateGroupRead] = []

    for group_key in unique_group_keys:
        group = candidate_group_read(group_key, candidates, selections)
        groups.append(group)

    return groups


def monthly_availability_row_from_result(
    schedule_period: SchedulePeriod,
    provider: Provider,
    availability: ProviderScheduleWeekAvailability,
) -> MonthlyAvailabilityRow:
    row = MonthlyAvailabilityRow(
        schedule_period_id=schedule_period.id,
        schedule_period_name=schedule_period.name,
        schedule_period_start_date=schedule_period.start_date,
        schedule_period_end_date=schedule_period.end_date,
        provider_id=provider.id,
        provider_display_name=provider.display_name,
        weekday=availability.weekday,
        availability_options=availability.availability_options,
    )
    return row


def monthly_availability_rows(
    organization_id: UUID,
    start_date: date,
    end_date: date,
    selected_period_ids: list[UUID] | None,
    session: Session,
) -> list[MonthlyAvailabilityRow]:
    statement = select(SchedulePeriod, Provider, ProviderScheduleWeekAvailability)
    statement = statement.join(
        ProviderScheduleWeekAvailability,
        ProviderScheduleWeekAvailability.schedule_week_id == SchedulePeriod.id,
    )
    statement = statement.join(
        Provider,
        Provider.id == ProviderScheduleWeekAvailability.provider_id,
    )
    statement = statement.where(SchedulePeriod.organization_id == organization_id)
    statement = statement.where(ProviderScheduleWeekAvailability.organization_id == organization_id)
    statement = statement.where(Provider.organization_id == organization_id)
    statement = statement.where(Provider.is_active.is_(True))
    statement = statement.where(SchedulePeriod.start_date <= end_date)
    statement = statement.where(SchedulePeriod.end_date >= start_date)

    if selected_period_ids is not None:
        statement = statement.where(SchedulePeriod.id.in_(selected_period_ids))

    statement = statement.order_by(SchedulePeriod.start_date)
    statement = statement.order_by(Provider.display_name)
    results = session.execute(statement).all()
    rows: list[MonthlyAvailabilityRow] = []

    for schedule_period, provider, availability in results:
        row = monthly_availability_row_from_result(
            schedule_period,
            provider,
            availability,
        )
        rows.append(row)

    return rows


def assignment_row_from_result(
    assignment: Assignment,
    schedule_period: SchedulePeriod,
    schedule_version: ScheduleVersion,
    center: Center,
    room: Room | None,
) -> MonthlyScheduleAssignmentRow:
    room_name = None

    if room is not None:
        room_name = room.name

    row = MonthlyScheduleAssignmentRow(
        assignment_id=assignment.id,
        schedule_period_id=schedule_period.id,
        schedule_period_name=schedule_period.name,
        schedule_version_id=schedule_version.id,
        schedule_version_number=schedule_version.version_number,
        schedule_version_status=schedule_version.status,
        provider_id=assignment.provider_id,
        center_id=center.id,
        center_name=center.name,
        room_id=assignment.room_id,
        room_name=room_name,
        shift_type=assignment.shift_type,
        schedule_date=assignment.schedule_date,
        start_time=assignment.start_time,
        end_time=assignment.end_time,
    )
    return row


def monthly_schedule_assignment_rows(
    organization_id: UUID,
    start_date: date,
    end_date: date,
    candidates: list[LatestScheduleCandidate],
    selections: list[SelectedSchedulePeriod],
    session: Session,
) -> list[MonthlyScheduleAssignmentRow]:
    selected_period_ids = selected_schedule_period_ids(selections)
    selected_version_ids = [
        candidate.latest_schedule_version_id
        for candidate in candidates
        if candidate.schedule_period_id in selected_period_ids
    ]

    if len(selected_version_ids) == 0:
        return []

    statement = select(Assignment, SchedulePeriod, ScheduleVersion, Center, Room)
    statement = statement.join(
        ScheduleVersion,
        ScheduleVersion.id == Assignment.schedule_version_id,
    )
    statement = statement.join(
        SchedulePeriod,
        SchedulePeriod.id == Assignment.schedule_period_id,
    )
    statement = statement.join(Center, Center.id == Assignment.center_id)
    statement = statement.outerjoin(Room, Room.id == Assignment.room_id)
    statement = statement.where(Assignment.organization_id == organization_id)
    statement = statement.where(SchedulePeriod.organization_id == organization_id)
    statement = statement.where(ScheduleVersion.organization_id == organization_id)
    statement = statement.where(Center.organization_id == organization_id)
    statement = statement.where(Assignment.provider_id.is_not(None))
    statement = statement.where(Assignment.schedule_version_id.in_(selected_version_ids))
    statement = statement.where(Assignment.schedule_date >= start_date)
    statement = statement.where(Assignment.schedule_date <= end_date)
    statement = statement.order_by(Assignment.start_time)
    results = session.execute(statement).all()
    rows: list[MonthlyScheduleAssignmentRow] = []

    for assignment, schedule_period, schedule_version, center, room in results:
        row = assignment_row_from_result(
            assignment,
            schedule_period,
            schedule_version,
            center,
            room,
        )
        rows.append(row)

    return rows


def row_applies_to_date(row: MonthlyAvailabilityRow, value: date) -> bool:
    date_is_after_start = value >= row.schedule_period_start_date
    date_is_before_end = value <= row.schedule_period_end_date
    date_is_inside_period = date_is_after_start and date_is_before_end
    weekday = weekday_for_date(value)
    weekday_matches = weekday == row.weekday
    applies_to_date = date_is_inside_period and weekday_matches
    return applies_to_date


def assignment_read_for_row(
    row: MonthlyScheduleAssignmentRow,
) -> MonthlyScheduleAssignmentRead:
    read_model = MonthlyScheduleAssignmentRead(
        assignment_id=row.assignment_id,
        schedule_period_id=row.schedule_period_id,
        schedule_period_name=row.schedule_period_name,
        schedule_version_id=row.schedule_version_id,
        schedule_version_number=row.schedule_version_number,
        schedule_version_status=row.schedule_version_status,
        center_id=row.center_id,
        center_name=row.center_name,
        room_id=row.room_id,
        room_name=row.room_name,
        shift_type=row.shift_type,
        start_time=row.start_time.isoformat(),
        end_time=row.end_time.isoformat(),
    )
    return read_model


def scheduled_assignments_for_provider_date(
    provider_id: UUID,
    value: date,
    schedule_period_id: UUID,
    assignment_rows: list[MonthlyScheduleAssignmentRow],
) -> list[MonthlyScheduleAssignmentRead]:
    assignments: list[MonthlyScheduleAssignmentRead] = []

    for assignment_row in assignment_rows:
        provider_matches = assignment_row.provider_id == provider_id
        date_matches = assignment_row.schedule_date == value
        period_matches = assignment_row.schedule_period_id == schedule_period_id
        assignment_matches = provider_matches and date_matches and period_matches

        if not assignment_matches:
            continue

        assignment = assignment_read_for_row(assignment_row)
        assignments.append(assignment)

    return assignments


def provider_read_for_row(
    row: MonthlyAvailabilityRow,
    value: date,
    assignment_rows: list[MonthlyScheduleAssignmentRow],
) -> MonthlyAvailabilityProviderRead | None:
    work_options = work_options_from_availability_options(row.availability_options)
    has_work_options = len(work_options) > 0

    if not has_work_options:
        return None

    scheduled_assignments = scheduled_assignments_for_provider_date(
        row.provider_id,
        value,
        row.schedule_period_id,
        assignment_rows,
    )
    provider = MonthlyAvailabilityProviderRead(
        provider_id=row.provider_id,
        provider_display_name=row.provider_display_name,
        schedule_period_id=row.schedule_period_id,
        schedule_period_name=row.schedule_period_name,
        options=work_options,
        scheduled_assignments=scheduled_assignments,
    )
    return provider


def providers_for_date(
    value: date,
    rows: list[MonthlyAvailabilityRow],
    assignment_rows: list[MonthlyScheduleAssignmentRow],
    candidates: list[LatestScheduleCandidate],
    selections: list[SelectedSchedulePeriod],
) -> list[MonthlyAvailabilityProviderRead]:
    providers: list[MonthlyAvailabilityProviderRead] = []
    selected_schedule_period_id = selected_schedule_period_id_for_date(
        value,
        candidates,
        selections,
    )
    has_schedule_candidates = len(candidates) > 0

    for row in rows:
        row_applies = row_applies_to_date(row, value)
        period_matches = row.schedule_period_id == selected_schedule_period_id

        if not has_schedule_candidates:
            period_matches = True

        row_matches = row_applies and period_matches

        if not row_matches:
            continue

        provider = provider_read_for_row(row, value, assignment_rows)

        if provider is None:
            continue

        providers.append(provider)

    return providers


def monthly_availability_days(
    start_date: date,
    end_date: date,
    rows: list[MonthlyAvailabilityRow],
    assignment_rows: list[MonthlyScheduleAssignmentRow] | None = None,
    candidates: list[LatestScheduleCandidate] | None = None,
    selections: list[SelectedSchedulePeriod] | None = None,
) -> list[MonthlyAvailabilityDayRead]:
    month_dates = dates_between(start_date, end_date)
    days: list[MonthlyAvailabilityDayRead] = []
    schedule_assignment_rows = assignment_rows or []
    schedule_candidates = candidates or []

    if selections is None:
        schedule_selections = selected_schedule_periods(schedule_candidates, [])
    else:
        schedule_selections = selections

    for month_date in month_dates:
        providers = providers_for_date(
            month_date,
            rows,
            schedule_assignment_rows,
            schedule_candidates,
            schedule_selections,
        )
        day = MonthlyAvailabilityDayRead(date=month_date, providers=providers)
        days.append(day)

    return days


def build_monthly_availability_report(
    organization_id: UUID,
    year: int,
    month: int,
    selected_schedule_period_ids_request: list[UUID],
    session: Session,
) -> MonthlyAvailabilityReportRead:
    start_date = month_start_date(year, month)
    end_date = month_end_date(year, month)
    candidates = latest_schedule_candidates(organization_id, start_date, end_date, session)
    selections = selected_schedule_periods(candidates, selected_schedule_period_ids_request)
    selected_period_ids = selected_schedule_period_ids(selections)
    availability_period_ids = selected_period_ids if len(candidates) > 0 else None
    rows = monthly_availability_rows(
        organization_id,
        start_date,
        end_date,
        availability_period_ids,
        session,
    )
    assignment_rows = monthly_schedule_assignment_rows(
        organization_id,
        start_date,
        end_date,
        candidates,
        selections,
        session,
    )
    days = monthly_availability_days(
        start_date,
        end_date,
        rows,
        assignment_rows,
        candidates,
        selections,
    )
    candidate_groups = schedule_candidate_groups(candidates, selections)
    report = MonthlyAvailabilityReportRead(
        year=year,
        month=month,
        start_date=start_date,
        end_date=end_date,
        schedule_candidate_groups=candidate_groups,
        days=days,
    )
    return report


@router.get("/monthly-availability", response_model=MonthlyAvailabilityReportRead)
def read_monthly_availability_report(
    year: int,
    month: int,
    schedule_period_id: list[UUID] | None = Query(default=None),
    session: Session = Depends(get_db),
    organization_id: UUID = Depends(get_current_organization_id),
) -> MonthlyAvailabilityReportRead:
    selected_schedule_period_ids_request = schedule_period_id or []
    report = build_monthly_availability_report(
        organization_id,
        year,
        month,
        selected_schedule_period_ids_request,
        session,
    )
    return report
