from dataclasses import dataclass
from datetime import UTC
from datetime import date
from datetime import datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Assignment
from app.db.models import Center
from app.db.models import Provider
from app.db.models import ProviderCenterCredential
from app.db.models import ProviderRoomTypeSkill
from app.db.models import ProviderScheduleWeekAvailability
from app.db.models import Room
from app.db.models import RoomRoomType
from app.db.models import SchedulePeriod
from app.db.models import ScheduleVersion
from app.db.models import ShiftRequirement
from app.schemas.reports import BackupReportCandidateRead
from app.schemas.reports import BackupReportCenterRead
from app.schemas.reports import BackupReportConflictRead
from app.schemas.reports import BackupReportDateRange
from app.schemas.reports import BackupReportExcludedPeriodRead
from app.schemas.reports import BackupReportOptionsRead
from app.schemas.reports import BackupReportPeriodRead
from app.schemas.reports import BackupReportRequest
from app.schemas.reports import BackupReportSelectedVersionRead
from app.schemas.reports import BackupReportShiftIdentityRead
from app.schemas.reports import BackupReportShiftRead
from app.schemas.reports import BackupReportVersionRead
from app.schemas.reports import ShiftBackupProviderReportRead
from app.services.scheduling.provider_eligibility import create_violation
from app.services.scheduling.provider_eligibility import credential_is_active_for_slot
from app.services.scheduling.provider_eligibility import evaluate_provider_slot_eligibility
from app.services.scheduling.provider_eligibility import weekday_for_start_time
from app.services.scheduling.provider_eligibility_contracts import ProviderEligibilityContext
from app.services.scheduling.provider_eligibility_contracts import ProviderEligibilityViolation
from app.services.scheduling.provider_eligibility_contracts import ProviderRoomTypeSkillSummary
from app.services.scheduling.provider_eligibility_contracts import ProviderSlotEligibilityInput
from app.services.scheduling.provider_eligibility_contracts import ProviderWeeklyAvailabilitySummary
from app.services.scheduling.provider_eligibility_contracts import RequiredRoomTypeSkill
from app.services.scheduling.shift_request_units import shift_request_units_for_shift_type
from app.services.scheduling.time_ranges import ScheduleTimeError
from app.services.scheduling.time_ranges import SlotInstants
from app.services.scheduling.time_ranges import ranges_overlap
from app.services.scheduling.time_ranges import slot_instants
from app.services.scheduling.time_ranges import split_day_pair_is_allowed


CONFLICT_CODES = {"provider_double_booked", "provider_same_day_conflict", "invalid_conflict_assignment"}
WORK_SHIFT_TYPES = {"full_shift", "first_half", "second_half", "short_shift"}


@dataclass
class BackupSelectionData:
    periods: list[SchedulePeriod]
    versions: list[ScheduleVersion]
    centers: list[Center]
    context_start_date: date
    context_end_date: date


@dataclass
class BackupEligibilityData:
    providers: list[Provider]
    credentials: list[ProviderCenterCredential]
    skills: list[ProviderRoomTypeSkill]
    availability: list[ProviderScheduleWeekAvailability]
    rooms: list[Room]
    room_types: list[RoomRoomType]
    requirements: list[ShiftRequirement]
    assignments: list[Assignment]


@dataclass
class PreparedBackupShift:
    assignment: Assignment
    identity: BackupReportShiftIdentityRead
    center: Center | None
    room: Room | None
    required_provider_type: str | None
    instants: SlotInstants | None
    blockers: list[ProviderEligibilityViolation]


def report_center(center: Center) -> BackupReportCenterRead:
    return BackupReportCenterRead(
        id=center.id,
        name=center.name,
        timezone=center.timezone,
        is_active=center.is_active,
    )


def load_backup_selection(
    dates: BackupReportDateRange,
    organization_id: UUID,
    session: Session,
) -> BackupSelectionData:
    # UTC+14 and UTC-12 can put simultaneous work two local calendar dates apart.
    context_start_ordinal = max(date.min.toordinal(), dates.start_date.toordinal() - 2)
    context_end_ordinal = min(date.max.toordinal(), dates.end_date.toordinal() + 2)
    context_start = date.fromordinal(context_start_ordinal)
    context_end = date.fromordinal(context_end_ordinal)
    statement = select(SchedulePeriod)
    statement = statement.where(SchedulePeriod.organization_id == organization_id)
    statement = statement.where(SchedulePeriod.start_date <= context_end)
    statement = statement.where(SchedulePeriod.end_date >= context_start)
    statement = statement.order_by(SchedulePeriod.start_date, SchedulePeriod.name, SchedulePeriod.id)
    periods = list(session.scalars(statement))
    period_ids = [period.id for period in periods]
    statement = select(ScheduleVersion)
    statement = statement.where(ScheduleVersion.organization_id == organization_id)
    statement = statement.where(ScheduleVersion.schedule_period_id.in_(period_ids))
    statement = statement.where(ScheduleVersion.status.in_(["draft", "published"]))
    statement = statement.order_by(ScheduleVersion.version_number.desc(), ScheduleVersion.id)
    versions = list(session.scalars(statement))
    statement = select(Center)
    statement = statement.where(Center.organization_id == organization_id)
    statement = statement.order_by(Center.name, Center.id)
    centers = list(session.scalars(statement))
    return BackupSelectionData(periods, versions, centers, context_start, context_end)


def backup_report_options(
    dates: BackupReportDateRange,
    organization_id: UUID,
    session: Session,
) -> BackupReportOptionsRead:
    data = load_backup_selection(dates, organization_id, session)
    periods: list[BackupReportPeriodRead] = []
    for period in data.periods:
        versions = [
            BackupReportVersionRead(id=version.id, version_number=version.version_number, status=version.status)
            for version in data.versions
            if version.schedule_period_id == period.id
        ]
        period_read = BackupReportPeriodRead(
            id=period.id,
            name=period.name,
            start_date=period.start_date,
            end_date=period.end_date,
            versions=versions,
        )
        periods.append(period_read)
    centers = [report_center(center) for center in data.centers]
    return BackupReportOptionsRead(
        start_date=dates.start_date,
        end_date=dates.end_date,
        context_start_date=data.context_start_date,
        context_end_date=data.context_end_date,
        periods=periods,
        centers=centers,
    )


def selected_backup_versions(request: BackupReportRequest, data: BackupSelectionData) -> list[ScheduleVersion]:
    requested_ids = set(request.selected_version_ids)
    excluded_ids = set(request.excluded_period_ids)
    duplicate_versions = len(requested_ids) != len(request.selected_version_ids)
    duplicate_exclusions = len(excluded_ids) != len(request.excluded_period_ids)
    if duplicate_versions or duplicate_exclusions:
        raise HTTPException(status_code=400, detail="Duplicate schedule selections are not allowed.")
    selected = [version for version in data.versions if version.id in requested_ids]
    period_ids = {period.id for period in data.periods}
    if len(selected) != len(requested_ids) or not excluded_ids.issubset(period_ids):
        raise HTTPException(status_code=404, detail="Selected schedule version or period is unavailable for this date range.")
    selected_period_ids = {version.schedule_period_id for version in selected}
    multiple_versions = len(selected_period_ids) != len(selected)
    included_and_excluded = bool(selected_period_ids & excluded_ids)
    if multiple_versions or included_and_excluded:
        raise HTTPException(status_code=400, detail="Choose exactly one version or explicitly exclude each period.")
    resolved_ids = selected_period_ids | excluded_ids
    if resolved_ids != period_ids:
        raise HTTPException(status_code=400, detail="Resolve every period, including overlapping and neighboring periods, before generating the report.")
    return selected


def load_backup_eligibility(organization_id: UUID, version_ids: list[UUID], session: Session) -> BackupEligibilityData:
    statement = select(Assignment)
    statement = statement.where(Assignment.organization_id == organization_id)
    statement = statement.where(Assignment.schedule_version_id.in_(version_ids))
    assignments = list(session.scalars(statement))
    statement = select(Provider).where(Provider.organization_id == organization_id)
    statement = statement.order_by(Provider.display_name, Provider.id)
    providers = list(session.scalars(statement))
    statement = select(ProviderCenterCredential).where(ProviderCenterCredential.organization_id == organization_id)
    credentials = list(session.scalars(statement))
    statement = select(ProviderRoomTypeSkill).where(ProviderRoomTypeSkill.organization_id == organization_id)
    skills = list(session.scalars(statement))
    statement = select(ProviderScheduleWeekAvailability)
    statement = statement.where(ProviderScheduleWeekAvailability.organization_id == organization_id)
    period_ids = {assignment.schedule_period_id for assignment in assignments}
    statement = statement.where(ProviderScheduleWeekAvailability.schedule_week_id.in_(period_ids))
    availability = list(session.scalars(statement))
    statement = select(Room).where(Room.organization_id == organization_id)
    rooms = list(session.scalars(statement))
    statement = select(RoomRoomType).where(RoomRoomType.organization_id == organization_id)
    room_types = list(session.scalars(statement))
    statement = select(ShiftRequirement).where(ShiftRequirement.organization_id == organization_id)
    requirement_ids = {assignment.shift_requirement_id for assignment in assignments if assignment.shift_requirement_id is not None}
    statement = statement.where(ShiftRequirement.id.in_(requirement_ids))
    requirements = list(session.scalars(statement))
    return BackupEligibilityData(providers, credentials, skills, availability, rooms, room_types, requirements, assignments)


def prepare_backup_shift(
    assignment: Assignment,
    selection: BackupSelectionData,
    data: BackupEligibilityData,
) -> PreparedBackupShift:
    center = next((center for center in selection.centers if center.id == assignment.center_id), None)
    room = next((room for room in data.rooms if room.id == assignment.room_id), None)
    version = next(version for version in selection.versions if version.id == assignment.schedule_version_id)
    period = next(period for period in selection.periods if period.id == version.schedule_period_id)
    blockers: list[ProviderEligibilityViolation] = []

    def block(code: str, message: str) -> None:
        violation = create_violation(code, "other_hard_constraint", message)
        blockers.append(violation)

    instants = None
    if assignment.schedule_period_id != period.id:
        block("assignment_period_mismatch", "Assignment does not belong to its version's schedule period.")
    if not period.start_date <= assignment.schedule_date <= period.end_date:
        block("assignment_outside_period", "Shift date falls outside its schedule period.")
    if assignment.shift_type not in WORK_SHIFT_TYPES:
        block("invalid_shift_type", "Shift type is not supported.")
    if center is None:
        block("missing_center", "Center is unavailable in this organization.")
    else:
        if not center.is_active:
            block("inactive_center", "Center is inactive.")
        try:
            instants = slot_instants(assignment.schedule_date, assignment.start_time, assignment.end_time, center.timezone)
        except ScheduleTimeError as error:
            block("invalid_shift_time", str(error))
    if assignment.room_id is not None and room is None:
        block("missing_room", "Room is unavailable in this organization.")
    if room is not None:
        if not room.is_active:
            block("inactive_room", "Room is inactive.")
        if room.center_id != assignment.center_id:
            block("room_center_mismatch", "Room does not belong to the assignment center.")
    assigned_provider_exists = any(provider.id == assignment.provider_id for provider in data.providers)
    if assignment.provider_id is not None and not assigned_provider_exists:
        block("missing_assigned_provider", "Assigned Provider is unavailable in this organization.")
    required_type = assignment.required_provider_type
    if assignment.shift_requirement_id is not None:
        requirement = next((item for item in data.requirements if item.id == assignment.shift_requirement_id), None)
        if requirement is None:
            block("missing_shift_requirement", "Shift requirement is unavailable in this organization.")
        else:
            required_type = requirement.required_provider_type
    if required_type is not None and required_type not in {"doctor", "crna"}:
        block("invalid_required_provider_type", "Required Provider type is not supported.")
    identity = BackupReportShiftIdentityRead(
        assignment_id=assignment.id,
        schedule_period_id=period.id,
        schedule_version_id=version.id,
        schedule_date=assignment.schedule_date,
        start_time=assignment.start_time,
        end_time=assignment.end_time,
        center_id=assignment.center_id,
        center_name=center.name if center is not None else None,
        timezone=center.timezone if center is not None else None,
        room_id=assignment.room_id,
        room_name=room.name if room is not None else None,
        shift_type=assignment.shift_type,
    )
    return PreparedBackupShift(assignment, identity, center, room, required_type, instants, blockers)


def backup_candidate_conflicts(
    target: PreparedBackupShift,
    existing: list[PreparedBackupShift],
) -> list[BackupReportConflictRead]:
    conflicts: list[BackupReportConflictRead] = []
    same_day_assignments = [item for item in existing if item.assignment.schedule_date == target.assignment.schedule_date]
    too_many_same_day = len(same_day_assignments) > 1
    for item in existing:
        date_distance = abs((item.assignment.schedule_date - target.assignment.schedule_date).days)
        if date_distance > 2:
            continue
        violations: list[ProviderEligibilityViolation] = []
        same_day = item.assignment.schedule_date == target.assignment.schedule_date
        if item.instants is None:
            violation = create_violation("invalid_conflict_assignment", "other_hard_constraint", "An existing assignment has invalid time or Center data; availability cannot be confirmed.")
            violations.append(violation)
        else:
            assert target.instants is not None
            overlap = ranges_overlap(target.instants.start, target.instants.end, item.instants.start, item.instants.end)
            allowed_pair = split_day_pair_is_allowed(target.assignment.center_id, target.assignment.shift_type, item.assignment.center_id, item.assignment.shift_type)
            invalid_same_day = same_day and (not allowed_pair or overlap or too_many_same_day)
            if overlap:
                violation = create_violation("provider_double_booked", "other_hard_constraint", "Provider is already assigned to an overlapping slot.")
                violations.append(violation)
            if invalid_same_day:
                violation = create_violation("provider_same_day_conflict", "other_hard_constraint", "Same-day assignments must be a non-overlapping first-half/second-half pair at one center.")
                violations.append(violation)
        if violations:
            conflict = BackupReportConflictRead(shift=item.identity, violations=violations)
            conflicts.append(conflict)
    return conflicts


def evaluate_backup_candidate(
    provider: Provider,
    target: PreparedBackupShift,
    shifts: list[PreparedBackupShift],
    data: BackupEligibilityData,
) -> BackupReportCandidateRead | None:
    assignment = target.assignment
    assert target.center is not None
    assert target.instants is not None
    existing = [item for item in shifts if item.assignment.provider_id == provider.id if item.assignment.id != assignment.id]
    conflicts = backup_candidate_conflicts(target, existing)
    conflict_codes = {violation.constraint_type for conflict in conflicts for violation in conflict.violations}
    credential = next((item for item in data.credentials if item.provider_id == provider.id if item.center_id == assignment.center_id), None)
    credential_active = False
    if credential is not None:
        credential_active = credential_is_active_for_slot(credential, target.instants.start, target.instants.end)
    weekday = weekday_for_start_time(assignment.schedule_date)
    availability = next((item for item in data.availability if item.provider_id == provider.id if item.schedule_week_id == assignment.schedule_period_id if item.weekday == weekday), None)
    weekly = ProviderWeeklyAvailabilitySummary(has_row=False, weekday=weekday, options=["unset"])
    if availability is not None:
        weekly = ProviderWeeklyAvailabilitySummary(
            has_row=True,
            weekday=weekday,
            options=availability.availability_options,
            min_shifts_requested_units=availability.min_shifts_requested_units,
            max_shifts_requested_units=availability.max_shifts_requested_units,
        )
    required_skills = [
        RequiredRoomTypeSkill(room_type_id=item.room_type_id, required_proficiency_level=item.required_proficiency_level)
        for item in data.room_types
        if item.room_id == assignment.room_id
    ]
    provider_skills = [
        ProviderRoomTypeSkillSummary(room_type_id=item.room_type_id, proficiency_level=item.proficiency_level)
        for item in data.skills
        if item.provider_id == provider.id
    ]
    weekly_units = shift_request_units_for_shift_type(assignment.shift_type)
    for item in existing:
        if item.assignment.schedule_version_id == assignment.schedule_version_id:
            units = shift_request_units_for_shift_type(item.assignment.shift_type)
            weekly_units = weekly_units + units
    request = ProviderSlotEligibilityInput(
        organization_id=assignment.organization_id,
        schedule_period_id=assignment.schedule_period_id,
        schedule_version_id=assignment.schedule_version_id,
        assignment_id=assignment.id,
        provider_id=provider.id,
        center_id=assignment.center_id,
        room_id=assignment.room_id,
        required_provider_type=target.required_provider_type,
        shift_type=assignment.shift_type,
        schedule_date=assignment.schedule_date,
        start_time=assignment.start_time,
        end_time=assignment.end_time,
    )
    context = ProviderEligibilityContext(
        provider_id=provider.id,
        provider_is_active=provider.is_active,
        provider_type=provider.provider_type,
        credential_exists=credential is not None,
        credential_is_active_for_slot=credential_active,
        room_md_only=target.room.md_only if target.room is not None else False,
        center_is_active=target.center.is_active,
        room_is_active=target.room is None or target.room.is_active,
        room_matches_center=target.room is None or target.room.center_id == assignment.center_id,
        required_room_type_skills=required_skills,
        provider_room_type_skills=provider_skills,
        weekly_availability=weekly,
        schedule_week_assignment_units=weekly_units,
        schedule_week_assignment_count=weekly_units // 2,
        has_double_booking="provider_double_booked" in conflict_codes,
        has_same_day_conflict="provider_same_day_conflict" in conflict_codes,
    )
    result = evaluate_provider_slot_eligibility(request, context)
    qualification_blockers = [
        violation for violation in result.violations
        if violation.severity == "hard_violation"
        if violation.constraint_type not in CONFLICT_CODES
    ]
    if qualification_blockers:
        return None
    warnings = [violation for violation in result.violations if violation.severity == "warning"]
    return BackupReportCandidateRead(provider_id=provider.id, display_name=provider.display_name, warnings=warnings, conflicts=conflicts)


def build_shift_backup_report(
    request: BackupReportRequest,
    organization_id: UUID,
    session: Session,
) -> ShiftBackupProviderReportRead:
    selection = load_backup_selection(request, organization_id, session)
    versions = selected_backup_versions(request, selection)
    center = next((item for item in selection.centers if item.id == request.center_id), None)
    if request.center_id is not None and center is None:
        raise HTTPException(status_code=404, detail="Center not found.")
    version_ids = [version.id for version in versions]
    data = load_backup_eligibility(organization_id, version_ids, session)
    prepared = [prepare_backup_shift(item, selection, data) for item in data.assignments]
    prepared.sort(key=lambda item: (
        item.identity.schedule_date,
        item.identity.start_time,
        item.identity.center_name is None,
        item.identity.center_name,
        item.identity.room_name is None,
        item.identity.room_name,
        item.identity.assignment_id,
    ))
    shifts: list[BackupReportShiftRead] = []
    for target in prepared:
        assignment = target.assignment
        in_range = request.start_date <= assignment.schedule_date <= request.end_date
        matches_center = request.center_id is None or assignment.center_id == request.center_id
        if not in_range or not matches_center:
            continue
        available: list[BackupReportCandidateRead] = []
        booked: list[BackupReportCandidateRead] = []
        if not target.blockers:
            for provider in data.providers:
                if provider.id == assignment.provider_id:
                    continue
                candidate = evaluate_backup_candidate(provider, target, prepared, data)
                if candidate is None:
                    continue
                if candidate.conflicts:
                    booked.append(candidate)
                else:
                    available.append(candidate)
        assigned_provider = next((item for item in data.providers if item.id == assignment.provider_id), None)
        shift = BackupReportShiftRead(
            assignment_id=target.identity.assignment_id,
            schedule_period_id=target.identity.schedule_period_id,
            schedule_version_id=target.identity.schedule_version_id,
            schedule_date=target.identity.schedule_date,
            start_time=target.identity.start_time,
            end_time=target.identity.end_time,
            center_id=target.identity.center_id,
            center_name=target.identity.center_name,
            timezone=target.identity.timezone,
            room_id=target.identity.room_id,
            room_name=target.identity.room_name,
            shift_type=target.identity.shift_type,
            assigned_provider_id=assignment.provider_id,
            assigned_provider_name=assigned_provider.display_name if assigned_provider is not None else None,
            blockers=target.blockers,
            available_replacements=available,
            qualified_but_scheduled=booked,
        )
        shifts.append(shift)
    selected_versions: list[BackupReportSelectedVersionRead] = []
    excluded_periods: list[BackupReportExcludedPeriodRead] = []
    for period in selection.periods:
        if period.id in request.excluded_period_ids:
            excluded = BackupReportExcludedPeriodRead(id=period.id, name=period.name, start_date=period.start_date, end_date=period.end_date)
            excluded_periods.append(excluded)
            continue
        version = next(item for item in versions if item.schedule_period_id == period.id)
        selected = BackupReportSelectedVersionRead(
            id=version.id,
            version_number=version.version_number,
            status=version.status,
            schedule_period_id=period.id,
            period_name=period.name,
            start_date=period.start_date,
            end_date=period.end_date,
        )
        selected_versions.append(selected)
    generated_at = datetime.now(UTC)
    return ShiftBackupProviderReportRead(
        start_date=request.start_date,
        end_date=request.end_date,
        generated_at=generated_at,
        center=report_center(center) if center is not None else None,
        selected_versions=selected_versions,
        excluded_periods=excluded_periods,
        shifts=shifts,
    )
