from dataclasses import dataclass
from datetime import datetime
from uuid import UUID
from uuid import uuid5

from ortools.sat.python import cp_model

from app.services.scheduling.provider_eligibility import credential_is_active_for_slot
from app.services.scheduling.provider_eligibility import evaluate_provider_slot_eligibility
from app.services.scheduling.provider_eligibility import full_shift_availability_accommodates_shift_type
from app.services.scheduling.provider_eligibility import overlapping_assignment_is_allowed
from app.services.scheduling.provider_eligibility import weekday_for_start_time
from app.services.scheduling.provider_eligibility_contracts import ProviderEligibilityContext
from app.services.scheduling.provider_eligibility_contracts import ProviderRoomTypeSkillSummary
from app.services.scheduling.provider_eligibility_contracts import ProviderSlotEligibilityInput
from app.services.scheduling.provider_eligibility_contracts import ProviderWeeklyAvailabilitySummary
from app.services.scheduling.provider_eligibility_contracts import RequiredRoomTypeSkill
from app.services.scheduling.solver_contracts import SolverAssignment
from app.services.scheduling.solver_contracts import SolverCenterCredential
from app.services.scheduling.solver_contracts import SolverGenerationMode
from app.services.scheduling.solver_contracts import SolverInput
from app.services.scheduling.solver_contracts import SolverPreferenceWeights
from app.services.scheduling.solver_contracts import SolverProvider
from app.services.scheduling.solver_contracts import SolverProviderRoomTypeSkill
from app.services.scheduling.solver_contracts import SolverResult
from app.services.scheduling.solver_contracts import SolverRoom
from app.services.scheduling.solver_contracts import SolverShiftRequirement
from app.services.scheduling.solver_contracts import SolverViolation
from app.services.scheduling.shift_request_units import shift_request_units_for_shift_type

BELOW_MIN_SHIFT_REQUEST_UNIT_PENALTY = 10
ABOVE_MAX_SHIFT_REQUEST_UNIT_PENALTY = 15
ASSIGNMENT_IMBALANCE_PENALTY = 3
FAIRNESS_PRESSURE_SCALE = 10
MAX_SOLVE_SECONDS = 30.0
UNFILLED_SHIFT_ASSIGNMENT_PENALTY = 100_000


@dataclass
class SolverCandidate:
    provider: SolverProvider
    shift_requirement: SolverShiftRequirement


@dataclass
class ProviderCandidateRejection:
    provider_id: UUID
    provider_display_name: str
    constraint_types: list[str]
    messages: list[str]


@dataclass
class ShiftCandidateAnalysis:
    candidates: list[SolverCandidate]
    rejections: list[ProviderCandidateRejection]


@dataclass
class CandidateDecision:
    candidate: SolverCandidate
    variable: cp_model.IntVar


@dataclass
class ProviderAssignmentTotal:
    provider: SolverProvider
    variable: cp_model.IntVar


@dataclass
class CandidatePreferenceScore:
    center_score: int
    shift_type_score: int
    manager_hidden_score: int

    @property
    def total_score(self) -> int:
        total_score = self.center_score + self.shift_type_score + self.manager_hidden_score
        return total_score


@dataclass
class ShiftAssignmentCount:
    shift_requirement_id: UUID
    assignment_count: int


@dataclass
class ShiftUnfilledCount:
    shift_requirement: SolverShiftRequirement
    variable: cp_model.IntVar


def time_ranges_overlap(
    first_start: datetime,
    first_end: datetime,
    second_start: datetime,
    second_end: datetime,
) -> bool:
    starts_before_second_ends = first_start < second_end
    ends_after_second_starts = first_end > second_start
    overlaps = starts_before_second_ends and ends_after_second_starts
    return overlaps


def room_for_shift(
    shift_requirement: SolverShiftRequirement,
    rooms: list[SolverRoom],
) -> SolverRoom | None:
    if shift_requirement.room_id is None:
        return None

    for room in rooms:
        room_matches_shift = room.id == shift_requirement.room_id

        if room_matches_shift:
            return room

    return None


def credential_for_provider_center(
    provider: SolverProvider,
    solver_input: SolverInput,
    center_id: UUID,
) -> SolverCenterCredential | None:
    for credential in solver_input.center_credentials:
        credential_matches_provider = credential.provider_id == provider.id
        credential_matches_center = credential.center_id == center_id
        credential_matches = credential_matches_provider and credential_matches_center

        if credential_matches:
            return credential

    return None


def provider_skill_summaries(
    provider_skills: list[SolverProviderRoomTypeSkill],
) -> list[ProviderRoomTypeSkillSummary]:
    skill_summaries: list[ProviderRoomTypeSkillSummary] = []

    for provider_skill in provider_skills:
        skill_summary = ProviderRoomTypeSkillSummary(
            room_type_id=provider_skill.room_type_id,
            proficiency_level=provider_skill.proficiency_level,
        )
        skill_summaries.append(skill_summary)

    return skill_summaries


def required_skill_summaries(
    room: SolverRoom | None,
) -> list[RequiredRoomTypeSkill]:
    if room is None:
        return []

    required_skills: list[RequiredRoomTypeSkill] = []

    for room_skill in room.required_room_type_skills:
        required_skill = RequiredRoomTypeSkill(
            room_type_id=room_skill.room_type_id,
            required_proficiency_level=room_skill.required_proficiency_level,
        )
        required_skills.append(required_skill)

    return required_skills


def weekly_availability_for_shift(
    provider: SolverProvider,
    shift_requirement: SolverShiftRequirement,
) -> ProviderWeeklyAvailabilitySummary:
    weekday = weekday_for_start_time(shift_requirement.start_time)

    for day in provider.week_availability.days:
        day_matches_weekday = day.weekday == weekday

        if not day_matches_weekday:
            continue

        summary = ProviderWeeklyAvailabilitySummary(
            has_row=True,
            weekday=day.weekday,
            options=day.options,
            min_shifts_requested=provider.week_availability.min_shifts_requested,
            max_shifts_requested=provider.week_availability.max_shifts_requested,
            min_shifts_requested_units=provider.week_availability.min_shifts_requested_units,
            max_shifts_requested_units=provider.week_availability.max_shifts_requested_units,
        )
        return summary

    summary = ProviderWeeklyAvailabilitySummary(
        has_row=False,
        weekday=weekday,
        options=["unset"],
        min_shifts_requested=provider.week_availability.min_shifts_requested,
        max_shifts_requested=provider.week_availability.max_shifts_requested,
        min_shifts_requested_units=provider.week_availability.min_shifts_requested_units,
        max_shifts_requested_units=provider.week_availability.max_shifts_requested_units,
    )
    return summary


def provider_eligibility_request(
    solver_input: SolverInput,
    provider: SolverProvider,
    shift_requirement: SolverShiftRequirement,
) -> ProviderSlotEligibilityInput:
    request = ProviderSlotEligibilityInput(
        organization_id=solver_input.organization_id,
        schedule_period_id=solver_input.schedule_period_id,
        schedule_version_id=None,
        assignment_id=shift_requirement.assignment_id,
        provider_id=provider.id,
        center_id=shift_requirement.center_id,
        room_id=shift_requirement.room_id,
        required_provider_type=shift_requirement.required_provider_type,
        shift_type=shift_requirement.shift_type,
        start_time=shift_requirement.start_time,
        end_time=shift_requirement.end_time,
    )
    return request


def provider_eligibility_context(
    solver_input: SolverInput,
    provider: SolverProvider,
    shift_requirement: SolverShiftRequirement,
    room: SolverRoom | None,
) -> ProviderEligibilityContext:
    credential = credential_for_provider_center(
        provider,
        solver_input,
        shift_requirement.center_id,
    )
    credential_exists = credential is not None
    credential_is_active = False

    if credential is not None:
        credential_is_active = credential_is_active_for_slot(
            credential,
            shift_requirement.start_time,
            shift_requirement.end_time,
        )

    room_md_only = False

    if room is not None:
        room_md_only = room.md_only

    required_skills = required_skill_summaries(room)
    provider_skills = provider_skill_summaries(provider.provider_room_type_skills)
    weekly_availability = weekly_availability_for_shift(provider, shift_requirement)
    context = ProviderEligibilityContext(
        provider_id=provider.id,
        provider_is_active=provider.is_active,
        provider_type=provider.provider_type,
        credential_exists=credential_exists,
        credential_is_active_for_slot=credential_is_active,
        room_md_only=room_md_only,
        required_room_type_skills=required_skills,
        provider_room_type_skills=provider_skills,
        weekly_availability=weekly_availability,
        schedule_week_assignment_count=0,
        has_double_booking=False,
    )
    return context


def room_is_available_for_shift(room: SolverRoom | None) -> bool:
    if room is None:
        return True

    room_is_active = room.is_active
    return room_is_active


def provider_candidate_rejection(
    solver_input: SolverInput,
    provider: SolverProvider,
    shift_requirement: SolverShiftRequirement,
    room: SolverRoom | None,
) -> ProviderCandidateRejection | None:
    locked_provider_id = shift_requirement.locked_provider_id

    if locked_provider_id is not None:
        provider_matches_locked_assignment = provider.id == locked_provider_id

        if not provider_matches_locked_assignment:
            rejection = ProviderCandidateRejection(
                provider_id=provider.id,
                provider_display_name=provider.display_name,
                constraint_types=["locked_provider_mismatch"],
                messages=["Provider does not match the locked assignment provider."],
            )
            return rejection

    room_is_available = room_is_available_for_shift(room)

    if not room_is_available:
        rejection = ProviderCandidateRejection(
            provider_id=provider.id,
            provider_display_name=provider.display_name,
            constraint_types=["room_inactive"],
            messages=["Room is inactive."],
        )
        return rejection

    request = provider_eligibility_request(
        solver_input,
        provider,
        shift_requirement,
    )
    context = provider_eligibility_context(
        solver_input,
        provider,
        shift_requirement,
        room,
    )
    result = evaluate_provider_slot_eligibility(request, context)
    hard_violations = [
        violation
        for violation in result.violations
        if violation.severity == "hard_violation"
    ]
    is_candidate = len(hard_violations) == 0

    if is_candidate:
        return None

    constraint_types = [
        violation.constraint_type
        for violation in hard_violations
    ]
    messages = [
        violation.message
        for violation in hard_violations
    ]
    rejection = ProviderCandidateRejection(
        provider_id=provider.id,
        provider_display_name=provider.display_name,
        constraint_types=constraint_types,
        messages=messages,
    )
    return rejection


def candidate_analysis_for_shift(
    shift_requirement: SolverShiftRequirement,
    solver_input: SolverInput,
) -> ShiftCandidateAnalysis:
    room = room_for_shift(shift_requirement, solver_input.rooms)
    candidates: list[SolverCandidate] = []
    rejections: list[ProviderCandidateRejection] = []
    requires_known_room = shift_requirement.room_id is not None
    room_is_missing = room is None

    if requires_known_room and room_is_missing:
        for provider in solver_input.providers:
            rejection = ProviderCandidateRejection(
                provider_id=provider.id,
                provider_display_name=provider.display_name,
                constraint_types=["room_not_found"],
                messages=["Shift requirement room was not found in the solver input."],
            )
            rejections.append(rejection)

        analysis = ShiftCandidateAnalysis(
            candidates=candidates,
            rejections=rejections,
        )
        return analysis

    for provider in solver_input.providers:
        rejection = provider_candidate_rejection(
            solver_input,
            provider,
            shift_requirement,
            room,
        )
        is_candidate = rejection is None

        if not is_candidate:
            if rejection is None:
                continue

            rejections.append(rejection)
            continue

        candidate = SolverCandidate(
            provider=provider,
            shift_requirement=shift_requirement,
        )
        candidates.append(candidate)

    analysis = ShiftCandidateAnalysis(
        candidates=candidates,
        rejections=rejections,
    )
    return analysis


def rejection_constraint_counts(
    rejections: list[ProviderCandidateRejection],
) -> dict[str, int]:
    counts: dict[str, int] = {}

    for rejection in rejections:
        for constraint_type in rejection.constraint_types:
            current_count = counts.get(constraint_type, 0)
            next_count = current_count + 1
            counts[constraint_type] = next_count

    return counts


def sorted_rejection_constraint_counts(
    counts: dict[str, int],
) -> list[tuple[str, int]]:
    sorted_counts = sorted(
        counts.items(),
        key=lambda count: (-count[1], count[0]),
    )
    return sorted_counts


def formatted_time_text(value: datetime) -> str:
    time_text = value.strftime("%I:%M %p")
    formatted_text = time_text.lstrip("0")
    return formatted_text


def formatted_shift_type(shift_type: str) -> str:
    formatted_text = shift_type.replace("_", " ")
    return formatted_text


def formatted_shift_date_time(
    shift_requirement: SolverShiftRequirement,
) -> str:
    date_text = shift_requirement.start_time.strftime("%A, %B %d, %Y")
    start_text = formatted_time_text(shift_requirement.start_time)
    end_text = formatted_time_text(shift_requirement.end_time)
    formatted_text = f"{date_text} from {start_text} to {end_text}"
    return formatted_text


def formatted_shift_location(
    shift_requirement: SolverShiftRequirement,
) -> str:
    center_name = shift_requirement.center_name
    room_name = shift_requirement.room_name

    if room_name is None:
        return center_name

    location = f"{center_name} / {room_name}"
    return location


def formatted_required_provider_type(
    shift_requirement: SolverShiftRequirement,
) -> str:
    if shift_requirement.required_provider_type is None:
        return "provider"

    provider_type = shift_requirement.required_provider_type
    return provider_type


def formatted_required_assignment_text(
    shift_requirement: SolverShiftRequirement,
) -> str:
    required_count = shift_requirement.required_provider_count
    required_provider_type = formatted_required_provider_type(shift_requirement)
    formatted_text = f"{required_count} {required_provider_type}"
    return formatted_text


def formatted_shift_requirement_summary(
    shift_requirement: SolverShiftRequirement,
) -> str:
    shift_type = formatted_shift_type(shift_requirement.shift_type)
    date_time = formatted_shift_date_time(shift_requirement)
    location = formatted_shift_location(shift_requirement)
    summary = f"{shift_type} on {date_time} at {location}"
    return summary


def formatted_rejection_summary(
    counts: dict[str, int],
) -> str:
    sorted_counts = sorted_rejection_constraint_counts(counts)
    top_counts = sorted_counts[:5]
    formatted_counts = [
        f"{constraint_type} ({count})"
        for constraint_type, count in top_counts
    ]
    summary = ", ".join(formatted_counts)
    return summary


def unfillable_shift_metadata(
    shift_requirement: SolverShiftRequirement,
    candidate_count: int,
    rejections: list[ProviderCandidateRejection],
) -> dict[str, object]:
    counts = rejection_constraint_counts(rejections)
    source_shift_requirement_id: str | None = None

    if shift_requirement.source_shift_requirement_id is not None:
        source_id = shift_requirement.source_shift_requirement_id
        source_shift_requirement_id = str(source_id)

    room_id: str | None = None

    if shift_requirement.room_id is not None:
        room_id = str(shift_requirement.room_id)

    provider_rejections = [
        {
            "provider_id": str(rejection.provider_id),
            "provider_display_name": rejection.provider_display_name,
            "constraint_types": rejection.constraint_types,
            "messages": rejection.messages,
        }
        for rejection in rejections
    ]
    metadata = {
        "shift_requirement_id": str(shift_requirement.id),
        "room_slot_id": str(shift_requirement.room_slot_id),
        "source_shift_requirement_id": source_shift_requirement_id,
        "center_id": str(shift_requirement.center_id),
        "center_name": shift_requirement.center_name,
        "room_id": room_id,
        "room_name": shift_requirement.room_name,
        "shift_type": shift_requirement.shift_type,
        "start_time": shift_requirement.start_time.isoformat(),
        "end_time": shift_requirement.end_time.isoformat(),
        "required_provider_count": shift_requirement.required_provider_count,
        "required_provider_type": shift_requirement.required_provider_type,
        "candidate_count": candidate_count,
        "evaluated_provider_count": len(rejections) + candidate_count,
        "rejection_constraint_counts": counts,
        "provider_rejections": provider_rejections,
    }
    return metadata


def unfillable_shift_violation(
    shift_requirement: SolverShiftRequirement,
    candidate_count: int,
    rejections: list[ProviderCandidateRejection],
) -> SolverViolation:
    shift_summary = formatted_shift_requirement_summary(shift_requirement)
    required_assignment_text = formatted_required_assignment_text(shift_requirement)
    counts = rejection_constraint_counts(rejections)
    rejection_summary = formatted_rejection_summary(counts)
    metadata = unfillable_shift_metadata(
        shift_requirement,
        candidate_count,
        rejections,
    )
    message = (
        f"The {shift_summary} has {candidate_count} valid provider candidates, "
        f"but needs {required_assignment_text}."
    )

    if candidate_count == 0:
        message = f"The {shift_summary} needs {required_assignment_text} and has no valid provider candidates."

    if rejection_summary != "":
        message = f"{message} Top blockers: {rejection_summary}."

    violation = SolverViolation(
        severity="hard_violation",
        constraint_type="unfillable_shift_requirement",
        message=message,
        metadata_json=metadata,
    )
    return violation


def build_solver_candidates(
    solver_input: SolverInput,
) -> tuple[list[SolverCandidate], list[SolverViolation]]:
    candidates: list[SolverCandidate] = []
    violations: list[SolverViolation] = []

    for shift_requirement in solver_input.shift_requirements:
        analysis = candidate_analysis_for_shift(shift_requirement, solver_input)
        shift_candidates = analysis.candidates
        candidate_count = len(shift_candidates)
        has_enough_candidates = candidate_count >= shift_requirement.required_provider_count

        if not has_enough_candidates:
            violation = unfillable_shift_violation(
                shift_requirement,
                candidate_count,
                analysis.rejections,
            )
            violations.append(violation)

        candidates.extend(shift_candidates)

    return candidates, violations


def decisions_for_shift(
    shift_requirement: SolverShiftRequirement,
    decisions: list[CandidateDecision],
) -> list[CandidateDecision]:
    matching_decisions: list[CandidateDecision] = []

    for decision in decisions:
        decision_shift_id = decision.candidate.shift_requirement.id
        shift_matches = decision_shift_id == shift_requirement.id

        if shift_matches:
            matching_decisions.append(decision)

    return matching_decisions


def decisions_for_provider(
    provider: SolverProvider,
    decisions: list[CandidateDecision],
) -> list[CandidateDecision]:
    matching_decisions: list[CandidateDecision] = []

    for decision in decisions:
        decision_provider_id = decision.candidate.provider.id
        provider_matches = decision_provider_id == provider.id

        if provider_matches:
            matching_decisions.append(decision)

    return matching_decisions


def create_candidate_decisions(
    model: cp_model.CpModel,
    candidates: list[SolverCandidate],
) -> list[CandidateDecision]:
    decisions: list[CandidateDecision] = []

    for candidate_index, candidate in enumerate(candidates):
        variable_name = f"assign_{candidate_index}"
        variable = model.NewBoolVar(variable_name)
        decision = CandidateDecision(
            candidate=candidate,
            variable=variable,
        )
        decisions.append(decision)

    return decisions


def add_shift_coverage_constraints(
    model: cp_model.CpModel,
    solver_input: SolverInput,
    decisions: list[CandidateDecision],
) -> None:
    for shift_requirement in solver_input.shift_requirements:
        shift_decisions = decisions_for_shift(shift_requirement, decisions)
        shift_variables = [
            decision.variable
            for decision in shift_decisions
        ]
        required_provider_count = shift_requirement.required_provider_count
        model.Add(sum(shift_variables) == required_provider_count)


def add_best_effort_shift_coverage_constraints(
    model: cp_model.CpModel,
    solver_input: SolverInput,
    decisions: list[CandidateDecision],
) -> list[ShiftUnfilledCount]:
    unfilled_counts: list[ShiftUnfilledCount] = []

    for shift_requirement in solver_input.shift_requirements:
        shift_decisions = decisions_for_shift(shift_requirement, decisions)
        shift_variables = [
            decision.variable
            for decision in shift_decisions
        ]
        required_provider_count = shift_requirement.required_provider_count
        variable_name = f"unfilled_{shift_requirement.id}"
        unfilled_count = model.NewIntVar(0, required_provider_count, variable_name)
        model.Add(sum(shift_variables) + unfilled_count == required_provider_count)
        coverage_count = ShiftUnfilledCount(
            shift_requirement=shift_requirement,
            variable=unfilled_count,
        )
        unfilled_counts.append(coverage_count)

    return unfilled_counts


def add_provider_overlap_constraints(
    model: cp_model.CpModel,
    solver_input: SolverInput,
    decisions: list[CandidateDecision],
) -> None:
    for provider in solver_input.providers:
        provider_decisions = decisions_for_provider(provider, decisions)

        for first_index, first_decision in enumerate(provider_decisions):
            remaining_decisions = provider_decisions[first_index + 1 :]

            for second_decision in remaining_decisions:
                first_shift = first_decision.candidate.shift_requirement
                second_shift = second_decision.candidate.shift_requirement
                shifts_overlap = time_ranges_overlap(
                    first_shift.start_time,
                    first_shift.end_time,
                    second_shift.start_time,
                    second_shift.end_time,
                )

                if not shifts_overlap:
                    continue

                overlap_is_allowed = overlapping_assignment_is_allowed(
                    first_shift.center_id,
                    first_shift.shift_type,
                    second_shift.center_id,
                    second_shift.shift_type,
                )

                if overlap_is_allowed:
                    continue

                model.Add(first_decision.variable + second_decision.variable <= 1)


def create_provider_assignment_totals(
    model: cp_model.CpModel,
    solver_input: SolverInput,
    decisions: list[CandidateDecision],
) -> list[ProviderAssignmentTotal]:
    provider_assignment_totals: list[ProviderAssignmentTotal] = []
    shift_requirement_units = [
        shift_request_units_for_shift_type(shift_requirement.shift_type)
        for shift_requirement in solver_input.shift_requirements
    ]
    assignment_total_upper_bound = sum(shift_requirement_units)

    for provider in solver_input.providers:
        provider_decisions = decisions_for_provider(provider, decisions)
        provider_unit_terms = [
            decision.variable * shift_request_units_for_shift_type(
                decision.candidate.shift_requirement.shift_type,
            )
            for decision in provider_decisions
        ]
        variable_name = f"total_{provider.id}"
        assignment_total = model.NewIntVar(0, assignment_total_upper_bound, variable_name)
        model.Add(assignment_total == sum(provider_unit_terms))
        provider_assignment_total = ProviderAssignmentTotal(
            provider=provider,
            variable=assignment_total,
        )
        provider_assignment_totals.append(provider_assignment_total)

    return provider_assignment_totals


def add_shift_request_objective_terms(
    model: cp_model.CpModel,
    solver_input: SolverInput,
    provider_assignment_totals: list[ProviderAssignmentTotal],
    objective_terms: list[cp_model.LinearExpr],
) -> None:
    shift_requirement_units = [
        shift_request_units_for_shift_type(shift_requirement.shift_type)
        for shift_requirement in solver_input.shift_requirements
    ]
    assignment_total_upper_bound = sum(shift_requirement_units)

    for provider_assignment_total in provider_assignment_totals:
        provider = provider_assignment_total.provider
        assignment_total = provider_assignment_total.variable
        min_shifts_requested_units = provider.week_availability.min_shifts_requested_units
        max_shifts_requested_units = provider.week_availability.max_shifts_requested_units

        if min_shifts_requested_units > 0:
            shortfall_name = f"below_min_{provider.id}"
            shortfall = model.NewIntVar(0, min_shifts_requested_units, shortfall_name)
            minimum_difference = min_shifts_requested_units - assignment_total
            model.Add(shortfall >= minimum_difference)
            objective_term = shortfall * -BELOW_MIN_SHIFT_REQUEST_UNIT_PENALTY
            objective_terms.append(objective_term)

        if max_shifts_requested_units >= 0:
            excess_name = f"above_max_{provider.id}"
            excess = model.NewIntVar(0, assignment_total_upper_bound, excess_name)
            maximum_difference = assignment_total - max_shifts_requested_units
            model.Add(excess >= maximum_difference)
            objective_term = excess * -ABOVE_MAX_SHIFT_REQUEST_UNIT_PENALTY
            objective_terms.append(objective_term)


def add_assignment_balance_objective_terms(
    model: cp_model.CpModel,
    solver_input: SolverInput,
    provider_assignment_totals: list[ProviderAssignmentTotal],
    objective_terms: list[cp_model.LinearExpr],
) -> None:
    shift_requirement_units = [
        shift_request_units_for_shift_type(shift_requirement.shift_type)
        for shift_requirement in solver_input.shift_requirements
    ]
    assignment_total_upper_bound = sum(shift_requirement_units)

    for first_index, first_total in enumerate(provider_assignment_totals):
        remaining_totals = provider_assignment_totals[first_index + 1 :]

        for second_index, second_total in enumerate(remaining_totals):
            difference_name = f"imbalance_{first_index}_{second_index}"
            difference = model.NewIntVar(0, assignment_total_upper_bound, difference_name)
            first_variable = first_total.variable
            second_variable = second_total.variable
            model.AddAbsEquality(difference, first_variable - second_variable)
            objective_term = difference * -ASSIGNMENT_IMBALANCE_PENALTY
            objective_terms.append(objective_term)


def fairness_pressure_for_provider(provider: SolverProvider) -> float:
    fairness_debt = provider.fairness_debt
    favor_credit = provider.favor_credit
    priority_multiplier = provider.fairness_priority_multiplier
    pressure_without_tier = fairness_debt - favor_credit
    scaled_pressure = pressure_without_tier * priority_multiplier
    return scaled_pressure


def add_fairness_objective_terms(
    solver_input: SolverInput,
    provider_assignment_totals: list[ProviderAssignmentTotal],
    objective_terms: list[cp_model.LinearExpr],
) -> None:
    for provider_assignment_total in provider_assignment_totals:
        provider = provider_assignment_total.provider
        assignment_total = provider_assignment_total.variable
        fairness_pressure = fairness_pressure_for_provider(provider)
        fairness_penalty = int(round(fairness_pressure * FAIRNESS_PRESSURE_SCALE))
        objective_term = assignment_total * -fairness_penalty
        objective_terms.append(objective_term)


def provider_center_preference_level(
    provider: SolverProvider,
    center_id: UUID,
) -> int:
    for preference in provider.center_preferences:
        center_matches = preference.center_id == center_id

        if not center_matches:
            continue

        preference_level = preference.preference_level
        return preference_level

    return 0


def provider_shift_type_preference_level(
    provider: SolverProvider,
    shift_type: str,
) -> int:
    for preference in provider.shift_type_preferences:
        shift_type_matches = preference.shift_type == shift_type

        if not shift_type_matches:
            continue

        preference_level = preference.preference_level
        return preference_level

    return 0


def manager_center_preference_level(
    provider: SolverProvider,
    center_id: UUID,
) -> int:
    for preference in provider.manager_center_preferences:
        center_matches = preference.center_id == center_id

        if not center_matches:
            continue

        preference_level = preference.preference_level
        return preference_level

    return 0


def candidate_preference_score(
    candidate: SolverCandidate,
    weights: SolverPreferenceWeights,
) -> CandidatePreferenceScore:
    provider = candidate.provider
    shift_requirement = candidate.shift_requirement
    center_points = provider_center_preference_level(provider, shift_requirement.center_id)
    shift_type_points = provider_shift_type_preference_level(provider, shift_requirement.shift_type)
    manager_points = manager_center_preference_level(provider, shift_requirement.center_id)
    center_score = center_points * weights.center_weight
    shift_type_score = shift_type_points * weights.shift_type_weight
    manager_hidden_score = manager_points * weights.manager_hidden_weight
    score = CandidatePreferenceScore(
        center_score=center_score,
        shift_type_score=shift_type_score,
        manager_hidden_score=manager_hidden_score,
    )
    return score


def add_preference_objective_terms(
    solver_input: SolverInput,
    decisions: list[CandidateDecision],
    objective_terms: list[cp_model.LinearExpr],
) -> None:
    weights = solver_input.preference_weights

    for decision in decisions:
        score = candidate_preference_score(decision.candidate, weights)
        preference_score = score.total_score

        if preference_score == 0:
            continue

        objective_term = decision.variable * preference_score
        objective_terms.append(objective_term)


def add_unfilled_shift_objective_terms(
    unfilled_counts: list[ShiftUnfilledCount],
    objective_terms: list[cp_model.LinearExpr],
) -> None:
    for unfilled_count in unfilled_counts:
        objective_term = unfilled_count.variable * -UNFILLED_SHIFT_ASSIGNMENT_PENALTY
        objective_terms.append(objective_term)


def add_objective(
    model: cp_model.CpModel,
    solver_input: SolverInput,
    decisions: list[CandidateDecision],
    unfilled_counts: list[ShiftUnfilledCount] | None = None,
) -> None:
    objective_terms: list[cp_model.LinearExpr] = []
    active_unfilled_counts = unfilled_counts or []
    provider_assignment_totals = create_provider_assignment_totals(
        model,
        solver_input,
        decisions,
    )
    add_shift_request_objective_terms(
        model,
        solver_input,
        provider_assignment_totals,
        objective_terms,
    )
    add_assignment_balance_objective_terms(
        model,
        solver_input,
        provider_assignment_totals,
        objective_terms,
    )
    add_fairness_objective_terms(
        solver_input,
        provider_assignment_totals,
        objective_terms,
    )
    add_preference_objective_terms(
        solver_input,
        decisions,
        objective_terms,
    )
    add_unfilled_shift_objective_terms(
        active_unfilled_counts,
        objective_terms,
    )

    model.Maximize(sum(objective_terms))


def selected_decision_sort_key(decision: CandidateDecision) -> tuple[datetime, str, str]:
    shift_requirement = decision.candidate.shift_requirement
    provider = decision.candidate.provider
    shift_id = str(shift_requirement.id)
    provider_id = str(provider.id)
    sort_key = (shift_requirement.start_time, shift_id, provider_id)
    return sort_key


def next_assignment_index_for_shift(
    shift_requirement: SolverShiftRequirement,
    assignment_counts: list[ShiftAssignmentCount],
) -> int:
    for assignment_count in assignment_counts:
        shift_matches = assignment_count.shift_requirement_id == shift_requirement.id

        if not shift_matches:
            continue

        next_index = assignment_count.assignment_count
        assignment_count.assignment_count = assignment_count.assignment_count + 1
        return next_index

    assignment_count = ShiftAssignmentCount(
        shift_requirement_id=shift_requirement.id,
        assignment_count=1,
    )
    assignment_counts.append(assignment_count)
    return 0


def room_slot_id_for_assignment(
    shift_requirement: SolverShiftRequirement,
    assignment_index: int,
) -> UUID:
    has_single_required_provider = shift_requirement.required_provider_count == 1

    if has_single_required_provider:
        room_slot_id = shift_requirement.room_slot_id
        return room_slot_id

    assignment_index_name = str(assignment_index)
    room_slot_id = uuid5(shift_requirement.room_slot_id, assignment_index_name)
    return room_slot_id


def assignment_from_decision(
    decision: CandidateDecision,
    room_slot_id: UUID,
) -> SolverAssignment:
    shift_requirement = decision.candidate.shift_requirement
    provider = decision.candidate.provider
    assignment = SolverAssignment(
        room_slot_id=room_slot_id,
        provider_id=provider.id,
        shift_requirement_id=shift_requirement.source_shift_requirement_id,
        center_id=shift_requirement.center_id,
        room_id=shift_requirement.room_id,
        required_provider_type=shift_requirement.required_provider_type,
        shift_type=shift_requirement.shift_type,
        start_time=shift_requirement.start_time,
        end_time=shift_requirement.end_time,
    )
    return assignment


def unassigned_assignment_from_shift(
    shift_requirement: SolverShiftRequirement,
    room_slot_id: UUID,
) -> SolverAssignment:
    assignment = SolverAssignment(
        room_slot_id=room_slot_id,
        provider_id=None,
        shift_requirement_id=shift_requirement.source_shift_requirement_id,
        center_id=shift_requirement.center_id,
        room_id=shift_requirement.room_id,
        required_provider_type=shift_requirement.required_provider_type,
        shift_type=shift_requirement.shift_type,
        start_time=shift_requirement.start_time,
        end_time=shift_requirement.end_time,
    )
    return assignment


def assignment_units_for_provider(
    provider: SolverProvider,
    assignments: list[SolverAssignment],
) -> int:
    assignment_units = 0

    for assignment in assignments:
        provider_matches = assignment.provider_id == provider.id

        if not provider_matches:
            continue

        shift_units = shift_request_units_for_shift_type(assignment.shift_type)
        assignment_units = assignment_units + shift_units

    return assignment_units


def provider_for_assignment(
    providers: list[SolverProvider],
    assignment: SolverAssignment,
) -> SolverProvider:
    for provider in providers:
        provider_matches_assignment = provider.id == assignment.provider_id

        if provider_matches_assignment:
            return provider

    raise ValueError("Provider not found for solver assignment.")


def availability_options_for_assignment(
    provider: SolverProvider,
    assignment: SolverAssignment,
) -> list[str]:
    assignment_weekday = weekday_for_start_time(assignment.start_time)

    for day in provider.week_availability.days:
        weekday_matches = day.weekday == assignment_weekday

        if not weekday_matches:
            continue

        return day.options

    return ["unset"]


def full_shift_accommodation_warnings(
    solver_input: SolverInput,
    assignments: list[SolverAssignment],
) -> list[SolverViolation]:
    warnings: list[SolverViolation] = []

    for assignment in assignments:
        provider = provider_for_assignment(solver_input.providers, assignment)
        availability_options = availability_options_for_assignment(
            provider,
            assignment,
        )
        uses_full_shift_accommodation = full_shift_availability_accommodates_shift_type(
            assignment.shift_type,
            availability_options,
        )

        if not uses_full_shift_accommodation:
            continue

        message = f"Provider {provider.id} offered full-day availability and is accommodating a shorter shift."
        warning = SolverViolation(
            severity="warning",
            constraint_type="full_shift_availability_accommodation",
            message=message,
        )
        warnings.append(warning)

    return warnings


def shift_request_warnings(
    solver_input: SolverInput,
    assignments: list[SolverAssignment],
) -> list[SolverViolation]:
    warnings: list[SolverViolation] = []

    for provider in solver_input.providers:
        assignment_units = assignment_units_for_provider(provider, assignments)
        min_shifts_requested_units = provider.week_availability.min_shifts_requested_units
        max_shifts_requested_units = provider.week_availability.max_shifts_requested_units
        below_minimum = assignment_units < min_shifts_requested_units
        above_maximum = assignment_units > max_shifts_requested_units

        if below_minimum:
            message = f"Provider {provider.id} is below the minimum requested shifts for this schedule week."
            warning = SolverViolation(
                severity="warning",
                constraint_type="provider_min_shifts_not_met",
                message=message,
            )
            warnings.append(warning)

        if above_maximum:
            message = f"Provider {provider.id} is above the maximum requested shifts for this schedule week."
            warning = SolverViolation(
                severity="warning",
                constraint_type="provider_max_shifts_exceeded",
                message=message,
            )
            warnings.append(warning)

    return warnings


def solver_warnings(
    solver_input: SolverInput,
    assignments: list[SolverAssignment],
) -> list[SolverViolation]:
    shift_warnings = shift_request_warnings(solver_input, assignments)
    availability_warnings = full_shift_accommodation_warnings(
        solver_input,
        assignments,
    )
    warnings = [*shift_warnings, *availability_warnings]
    return warnings


def best_effort_unfilled_shift_metadata(
    shift_requirement: SolverShiftRequirement,
    assigned_count: int,
    unfilled_count: int,
) -> dict[str, object]:
    room_id: str | None = None

    if shift_requirement.room_id is not None:
        room_id = str(shift_requirement.room_id)

    source_shift_requirement_id: str | None = None

    if shift_requirement.source_shift_requirement_id is not None:
        source_shift_requirement_id = str(shift_requirement.source_shift_requirement_id)

    metadata = {
        "shift_requirement_id": str(shift_requirement.id),
        "room_slot_id": str(shift_requirement.room_slot_id),
        "source_shift_requirement_id": source_shift_requirement_id,
        "center_id": str(shift_requirement.center_id),
        "center_name": shift_requirement.center_name,
        "room_id": room_id,
        "room_name": shift_requirement.room_name,
        "shift_type": shift_requirement.shift_type,
        "start_time": shift_requirement.start_time.isoformat(),
        "end_time": shift_requirement.end_time.isoformat(),
        "required_provider_count": shift_requirement.required_provider_count,
        "required_provider_type": shift_requirement.required_provider_type,
        "assigned_provider_count": assigned_count,
        "unfilled_provider_count": unfilled_count,
    }
    return metadata


def best_effort_unfilled_shift_violation(
    shift_requirement: SolverShiftRequirement,
    assigned_count: int,
    unfilled_count: int,
) -> SolverViolation:
    shift_summary = formatted_shift_requirement_summary(shift_requirement)
    required_assignment_text = formatted_required_assignment_text(shift_requirement)
    metadata = best_effort_unfilled_shift_metadata(
        shift_requirement,
        assigned_count,
        unfilled_count,
    )
    message = (
        f"The {shift_summary} needs {required_assignment_text}; "
        f"best effort assigned {assigned_count} and left {unfilled_count} unfilled."
    )
    violation = SolverViolation(
        severity="hard_violation",
        constraint_type="unfilled_shift_requirement",
        message=message,
        metadata_json=metadata,
    )
    return violation


def selected_assignment_count_for_shift(
    shift_requirement: SolverShiftRequirement,
    assignments: list[SolverAssignment],
) -> int:
    assignment_count = 0

    for assignment in assignments:
        assignment_has_provider = assignment.provider_id is not None

        if not assignment_has_provider:
            continue

        source_shift_requirement_id = shift_requirement.source_shift_requirement_id
        shift_matches = assignment.shift_requirement_id == source_shift_requirement_id
        slot_matches = assignment.room_slot_id == shift_requirement.room_slot_id
        assignment_matches_shift = shift_matches or slot_matches

        if not assignment_matches_shift:
            continue

        assignment_count = assignment_count + 1

    return assignment_count


def best_effort_unassigned_assignments(
    solver_input: SolverInput,
    provider_assignments: list[SolverAssignment],
    assignment_counts: list[ShiftAssignmentCount],
) -> list[SolverAssignment]:
    assignments: list[SolverAssignment] = []

    for shift_requirement in solver_input.shift_requirements:
        assigned_count = selected_assignment_count_for_shift(
            shift_requirement,
            provider_assignments,
        )
        required_count = shift_requirement.required_provider_count
        unfilled_count = required_count - assigned_count

        for _index in range(unfilled_count):
            assignment_index = next_assignment_index_for_shift(
                shift_requirement,
                assignment_counts,
            )
            room_slot_id = room_slot_id_for_assignment(
                shift_requirement,
                assignment_index,
            )
            assignment = unassigned_assignment_from_shift(
                shift_requirement,
                room_slot_id,
            )
            assignments.append(assignment)

    return assignments


def best_effort_violations(
    solver_input: SolverInput,
    assignments: list[SolverAssignment],
    candidate_violations: list[SolverViolation],
) -> list[SolverViolation]:
    violations: list[SolverViolation] = []

    for shift_requirement in solver_input.shift_requirements:
        assigned_count = selected_assignment_count_for_shift(
            shift_requirement,
            assignments,
        )
        required_count = shift_requirement.required_provider_count
        unfilled_count = required_count - assigned_count
        shift_is_fully_assigned = unfilled_count == 0

        if shift_is_fully_assigned:
            continue

        candidate_violation = unfillable_violation_for_shift(
            shift_requirement,
            candidate_violations,
        )

        if candidate_violation is not None:
            violations.append(candidate_violation)
            continue

        violation = best_effort_unfilled_shift_violation(
            shift_requirement,
            assigned_count,
            unfilled_count,
        )
        violations.append(violation)

    return violations


def unfillable_violation_for_shift(
    shift_requirement: SolverShiftRequirement,
    candidate_violations: list[SolverViolation],
) -> SolverViolation | None:
    for violation in candidate_violations:
        metadata = violation.metadata_json

        if metadata is None:
            continue

        metadata_shift_id = metadata.get("shift_requirement_id")
        shift_matches = metadata_shift_id == str(shift_requirement.id)

        if shift_matches:
            return violation

    return None


def solver_result_from_solution(
    solver: cp_model.CpSolver,
    solver_input: SolverInput,
    decisions: list[CandidateDecision],
    generation_mode: SolverGenerationMode,
    candidate_violations: list[SolverViolation],
) -> SolverResult:
    provider_assignments: list[SolverAssignment] = []
    selected_decisions: list[CandidateDecision] = []

    for decision in decisions:
        selected = solver.Value(decision.variable) == 1

        if not selected:
            continue

        selected_decisions.append(decision)

    ordered_decisions = sorted(selected_decisions, key=selected_decision_sort_key)
    assignment_counts: list[ShiftAssignmentCount] = []

    for decision in ordered_decisions:
        shift_requirement = decision.candidate.shift_requirement
        assignment_index = next_assignment_index_for_shift(
            shift_requirement,
            assignment_counts,
        )
        room_slot_id = room_slot_id_for_assignment(
            shift_requirement,
            assignment_index,
        )
        assignment = assignment_from_decision(
            decision,
            room_slot_id,
        )
        provider_assignments.append(assignment)

    objective_value = solver.ObjectiveValue()
    warnings = solver_warnings(solver_input, provider_assignments)
    hard_violations: list[SolverViolation] = []
    assignments = provider_assignments

    if generation_mode == "best_effort":
        hard_violations = best_effort_violations(
            solver_input,
            provider_assignments,
            candidate_violations,
        )
        unassigned_assignments = best_effort_unassigned_assignments(
            solver_input,
            provider_assignments,
            assignment_counts,
        )
        assignments = [*provider_assignments, *unassigned_assignments]

    all_violations = [*hard_violations, *warnings]
    is_feasible = len(hard_violations) == 0
    result = SolverResult(
        assignments=assignments,
        violations=all_violations,
        solver_score=objective_value,
        is_feasible=is_feasible,
    )
    return result


def infeasible_solver_result(
    violations: list[SolverViolation],
) -> SolverResult:
    violation = SolverViolation(
        severity="hard_violation",
        constraint_type="infeasible_solver_model",
        message="Solver could not satisfy all hard constraints.",
    )
    all_violations = [*violations, violation]
    result = SolverResult(
        assignments=[],
        violations=all_violations,
        solver_score=None,
        is_feasible=False,
    )
    return result


def no_shift_requirements_result() -> SolverResult:
    violation = SolverViolation(
        severity="hard_violation",
        constraint_type="missing_shift_requirements",
        message="Schedule generation needs shift requirements before it can assign providers.",
    )
    result = infeasible_solver_result([violation])
    return result


def solve_schedule(
    solver_input: SolverInput,
    generation_mode: SolverGenerationMode = "strict",
) -> SolverResult:
    has_shift_requirements = len(solver_input.shift_requirements) > 0

    if not has_shift_requirements:
        result = no_shift_requirements_result()
        return result

    candidates, candidate_violations = build_solver_candidates(solver_input)
    uses_strict_generation = generation_mode == "strict"

    if uses_strict_generation and len(candidate_violations) > 0:
        result = infeasible_solver_result(candidate_violations)
        return result

    model = cp_model.CpModel()
    decisions = create_candidate_decisions(model, candidates)
    unfilled_counts: list[ShiftUnfilledCount] = []

    if uses_strict_generation:
        add_shift_coverage_constraints(model, solver_input, decisions)
    else:
        unfilled_counts = add_best_effort_shift_coverage_constraints(
            model,
            solver_input,
            decisions,
        )

    add_provider_overlap_constraints(model, solver_input, decisions)
    add_objective(model, solver_input, decisions, unfilled_counts)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = MAX_SOLVE_SECONDS
    status = solver.Solve(model)
    solved_optimally = status == cp_model.OPTIMAL
    solved_feasibly = status == cp_model.FEASIBLE
    has_solution = solved_optimally or solved_feasibly

    if has_solution:
        result = solver_result_from_solution(
            solver,
            solver_input,
            decisions,
            generation_mode,
            candidate_violations,
        )
        return result

    result = infeasible_solver_result(candidate_violations)
    return result
