from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from ortools.sat.python import cp_model

from app.services.scheduling.provider_eligibility import credential_is_active_for_slot
from app.services.scheduling.provider_eligibility import evaluate_provider_slot_eligibility
from app.services.scheduling.provider_eligibility import weekday_for_start_time
from app.services.scheduling.provider_eligibility_contracts import ProviderEligibilityContext
from app.services.scheduling.provider_eligibility_contracts import ProviderRoomTypeSkillSummary
from app.services.scheduling.provider_eligibility_contracts import ProviderSlotEligibilityInput
from app.services.scheduling.provider_eligibility_contracts import ProviderWeeklyAvailabilitySummary
from app.services.scheduling.provider_eligibility_contracts import RequiredRoomTypeSkill
from app.services.scheduling.solver_contracts import SolverAssignment
from app.services.scheduling.solver_contracts import SolverCenterCredential
from app.services.scheduling.solver_contracts import SolverInput
from app.services.scheduling.solver_contracts import SolverProvider
from app.services.scheduling.solver_contracts import SolverProviderRoomTypeSkill
from app.services.scheduling.solver_contracts import SolverResult
from app.services.scheduling.solver_contracts import SolverRoom
from app.services.scheduling.solver_contracts import SolverShiftRequirement
from app.services.scheduling.solver_contracts import SolverViolation

BELOW_MIN_SHIFT_REQUEST_PENALTY = 20
ABOVE_MAX_SHIFT_REQUEST_PENALTY = 30
ASSIGNMENT_IMBALANCE_PENALTY = 3
MAX_SOLVE_SECONDS = 30.0


@dataclass
class SolverCandidate:
    provider: SolverProvider
    shift_requirement: SolverShiftRequirement


@dataclass
class CandidateDecision:
    candidate: SolverCandidate
    variable: cp_model.IntVar


@dataclass
class ProviderAssignmentTotal:
    provider: SolverProvider
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
        )
        return summary

    summary = ProviderWeeklyAvailabilitySummary(
        has_row=False,
        weekday=weekday,
        options=["unset"],
        min_shifts_requested=provider.week_availability.min_shifts_requested,
        max_shifts_requested=provider.week_availability.max_shifts_requested,
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


def provider_is_candidate(
    solver_input: SolverInput,
    provider: SolverProvider,
    shift_requirement: SolverShiftRequirement,
    room: SolverRoom | None,
) -> bool:
    locked_provider_id = shift_requirement.locked_provider_id

    if locked_provider_id is not None:
        provider_matches_locked_assignment = provider.id == locked_provider_id

        if not provider_matches_locked_assignment:
            return False

    room_is_available = room_is_available_for_shift(room)

    if not room_is_available:
        return False

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
    is_candidate = result.is_eligible
    return is_candidate


def candidates_for_shift(
    shift_requirement: SolverShiftRequirement,
    solver_input: SolverInput,
) -> list[SolverCandidate]:
    room = room_for_shift(shift_requirement, solver_input.rooms)
    candidates: list[SolverCandidate] = []
    requires_known_room = shift_requirement.room_id is not None
    room_is_missing = room is None

    if requires_known_room and room_is_missing:
        return candidates

    for provider in solver_input.providers:
        is_candidate = provider_is_candidate(
            solver_input,
            provider,
            shift_requirement,
            room,
        )

        if not is_candidate:
            continue

        candidate = SolverCandidate(
            provider=provider,
            shift_requirement=shift_requirement,
        )
        candidates.append(candidate)

    return candidates


def unfillable_shift_violation(
    shift_requirement: SolverShiftRequirement,
    candidate_count: int,
) -> SolverViolation:
    message = f"Shift requirement {shift_requirement.id} has fewer valid candidates than required assignments."

    if candidate_count == 0:
        message = f"Shift requirement {shift_requirement.id} has no valid provider candidates."

    violation = SolverViolation(
        severity="hard_violation",
        constraint_type="unfillable_shift_requirement",
        message=message,
    )
    return violation


def build_solver_candidates(
    solver_input: SolverInput,
) -> tuple[list[SolverCandidate], list[SolverViolation]]:
    candidates: list[SolverCandidate] = []
    violations: list[SolverViolation] = []

    for shift_requirement in solver_input.shift_requirements:
        shift_candidates = candidates_for_shift(shift_requirement, solver_input)
        candidate_count = len(shift_candidates)
        has_enough_candidates = candidate_count >= shift_requirement.required_provider_count

        if not has_enough_candidates:
            violation = unfillable_shift_violation(shift_requirement, candidate_count)
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

                model.Add(first_decision.variable + second_decision.variable <= 1)


def create_provider_assignment_totals(
    model: cp_model.CpModel,
    solver_input: SolverInput,
    decisions: list[CandidateDecision],
) -> list[ProviderAssignmentTotal]:
    provider_assignment_totals: list[ProviderAssignmentTotal] = []
    assignment_total_upper_bound = len(solver_input.shift_requirements)

    for provider in solver_input.providers:
        provider_decisions = decisions_for_provider(provider, decisions)
        provider_variables = [
            decision.variable
            for decision in provider_decisions
        ]
        variable_name = f"total_{provider.id}"
        assignment_total = model.NewIntVar(0, assignment_total_upper_bound, variable_name)
        model.Add(assignment_total == sum(provider_variables))
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
    assignment_total_upper_bound = len(solver_input.shift_requirements)

    for provider_assignment_total in provider_assignment_totals:
        provider = provider_assignment_total.provider
        assignment_total = provider_assignment_total.variable
        min_shifts_requested = provider.week_availability.min_shifts_requested
        max_shifts_requested = provider.week_availability.max_shifts_requested

        if min_shifts_requested > 0:
            shortfall_name = f"below_min_{provider.id}"
            shortfall = model.NewIntVar(0, min_shifts_requested, shortfall_name)
            minimum_difference = min_shifts_requested - assignment_total
            model.Add(shortfall >= minimum_difference)
            objective_term = shortfall * -BELOW_MIN_SHIFT_REQUEST_PENALTY
            objective_terms.append(objective_term)

        if max_shifts_requested >= 0:
            excess_name = f"above_max_{provider.id}"
            excess = model.NewIntVar(0, assignment_total_upper_bound, excess_name)
            maximum_difference = assignment_total - max_shifts_requested
            model.Add(excess >= maximum_difference)
            objective_term = excess * -ABOVE_MAX_SHIFT_REQUEST_PENALTY
            objective_terms.append(objective_term)


def add_assignment_balance_objective_terms(
    model: cp_model.CpModel,
    solver_input: SolverInput,
    provider_assignment_totals: list[ProviderAssignmentTotal],
    objective_terms: list[cp_model.LinearExpr],
) -> None:
    assignment_total_upper_bound = len(solver_input.shift_requirements)

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


def add_objective(
    model: cp_model.CpModel,
    solver_input: SolverInput,
    decisions: list[CandidateDecision],
) -> None:
    objective_terms: list[cp_model.LinearExpr] = []
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

    model.Maximize(sum(objective_terms))


def assignment_from_decision(decision: CandidateDecision) -> SolverAssignment:
    shift_requirement = decision.candidate.shift_requirement
    provider = decision.candidate.provider
    assignment = SolverAssignment(
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


def assignment_count_for_provider(
    provider: SolverProvider,
    assignments: list[SolverAssignment],
) -> int:
    assignment_count = 0

    for assignment in assignments:
        provider_matches = assignment.provider_id == provider.id

        if not provider_matches:
            continue

        assignment_count = assignment_count + 1

    return assignment_count


def shift_request_warnings(
    solver_input: SolverInput,
    assignments: list[SolverAssignment],
) -> list[SolverViolation]:
    warnings: list[SolverViolation] = []

    for provider in solver_input.providers:
        assignment_count = assignment_count_for_provider(provider, assignments)
        min_shifts_requested = provider.week_availability.min_shifts_requested
        max_shifts_requested = provider.week_availability.max_shifts_requested
        below_minimum = assignment_count < min_shifts_requested
        above_maximum = assignment_count > max_shifts_requested

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


def solver_result_from_solution(
    solver: cp_model.CpSolver,
    solver_input: SolverInput,
    decisions: list[CandidateDecision],
) -> SolverResult:
    assignments: list[SolverAssignment] = []

    for decision in decisions:
        selected = solver.Value(decision.variable) == 1

        if not selected:
            continue

        assignment = assignment_from_decision(decision)
        assignments.append(assignment)

    objective_value = solver.ObjectiveValue()
    warnings = shift_request_warnings(solver_input, assignments)
    result = SolverResult(
        assignments=assignments,
        violations=warnings,
        solver_score=objective_value,
        is_feasible=True,
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


def solve_schedule(solver_input: SolverInput) -> SolverResult:
    has_shift_requirements = len(solver_input.shift_requirements) > 0

    if not has_shift_requirements:
        result = no_shift_requirements_result()
        return result

    candidates, candidate_violations = build_solver_candidates(solver_input)

    if len(candidate_violations) > 0:
        result = infeasible_solver_result(candidate_violations)
        return result

    model = cp_model.CpModel()
    decisions = create_candidate_decisions(model, candidates)
    add_shift_coverage_constraints(model, solver_input, decisions)
    add_provider_overlap_constraints(model, solver_input, decisions)
    add_objective(model, solver_input, decisions)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = MAX_SOLVE_SECONDS
    status = solver.Solve(model)
    solved_optimally = status == cp_model.OPTIMAL
    solved_feasibly = status == cp_model.FEASIBLE
    has_solution = solved_optimally or solved_feasibly

    if has_solution:
        result = solver_result_from_solution(solver, solver_input, decisions)
        return result

    result = infeasible_solver_result(candidate_violations)
    return result
