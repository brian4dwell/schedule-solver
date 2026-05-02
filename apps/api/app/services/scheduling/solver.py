from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from ortools.sat.python import cp_model

from app.services.scheduling.solver_contracts import SolverAssignment
from app.services.scheduling.solver_contracts import SolverInput
from app.services.scheduling.solver_contracts import SolverProvider
from app.services.scheduling.solver_contracts import SolverResult
from app.services.scheduling.solver_contracts import SolverRoom
from app.services.scheduling.solver_contracts import SolverShiftRequirement
from app.services.scheduling.solver_contracts import SolverTimeBlock
from app.services.scheduling.solver_contracts import SolverViolation

PREFERRED_BLOCK_REWARD = 10
AVOID_BLOCK_PENALTY = 25
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


def block_overlaps_shift(
    block: SolverTimeBlock,
    shift_requirement: SolverShiftRequirement,
) -> bool:
    overlaps = time_ranges_overlap(
        block.start_time,
        block.end_time,
        shift_requirement.start_time,
        shift_requirement.end_time,
    )
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


def provider_has_center_credential(
    provider: SolverProvider,
    center_id: UUID,
) -> bool:
    for credentialed_center_id in provider.credentialed_center_ids:
        credential_matches_center = credentialed_center_id == center_id

        if credential_matches_center:
            return True

    return False


def provider_has_room_type_skill(
    provider: SolverProvider,
    room_type_id: UUID,
) -> bool:
    for skill_room_type_id in provider.skill_room_type_ids:
        skill_matches_room_type = skill_room_type_id == room_type_id

        if skill_matches_room_type:
            return True

    return False


def provider_can_cover_room(
    provider: SolverProvider,
    room: SolverRoom | None,
) -> bool:
    if room is None:
        return True

    if room.md_only:
        provider_is_doctor = provider.provider_type == "doctor"

        if not provider_is_doctor:
            return False

    for room_type_id in room.room_type_ids:
        provider_has_skill = provider_has_room_type_skill(provider, room_type_id)

        if not provider_has_skill:
            return False

    return True


def provider_has_unavailable_conflict(
    provider: SolverProvider,
    shift_requirement: SolverShiftRequirement,
) -> bool:
    for unavailable_block in provider.unavailable_blocks:
        overlaps_shift = block_overlaps_shift(unavailable_block, shift_requirement)

        if overlaps_shift:
            return True

    return False


def provider_type_matches_shift(
    provider: SolverProvider,
    shift_requirement: SolverShiftRequirement,
) -> bool:
    if shift_requirement.required_provider_type is None:
        return True

    provider_type_matches = provider.provider_type == shift_requirement.required_provider_type
    return provider_type_matches


def provider_is_candidate(
    provider: SolverProvider,
    shift_requirement: SolverShiftRequirement,
    room: SolverRoom | None,
) -> bool:
    type_matches = provider_type_matches_shift(provider, shift_requirement)

    if not type_matches:
        return False

    has_credential = provider_has_center_credential(provider, shift_requirement.center_id)

    if not has_credential:
        return False

    has_unavailable_conflict = provider_has_unavailable_conflict(provider, shift_requirement)

    if has_unavailable_conflict:
        return False

    can_cover_room = provider_can_cover_room(provider, room)

    if not can_cover_room:
        return False

    return True


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
        is_candidate = provider_is_candidate(provider, shift_requirement, room)

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


def provider_block_reward(
    provider: SolverProvider,
    shift_requirement: SolverShiftRequirement,
) -> int:
    reward = 0

    for preferred_block in provider.preferred_blocks:
        overlaps_shift = block_overlaps_shift(preferred_block, shift_requirement)

        if overlaps_shift:
            reward = reward + PREFERRED_BLOCK_REWARD

    return reward


def provider_block_penalty(
    provider: SolverProvider,
    shift_requirement: SolverShiftRequirement,
) -> int:
    penalty = 0

    for avoid_block in provider.avoid_blocks:
        overlaps_shift = block_overlaps_shift(avoid_block, shift_requirement)

        if overlaps_shift:
            penalty = penalty + AVOID_BLOCK_PENALTY

    return penalty


def add_objective(
    model: cp_model.CpModel,
    solver_input: SolverInput,
    decisions: list[CandidateDecision],
) -> None:
    objective_terms = []
    provider_assignment_totals = []

    for decision in decisions:
        provider = decision.candidate.provider
        shift_requirement = decision.candidate.shift_requirement
        reward = provider_block_reward(provider, shift_requirement)
        penalty = provider_block_penalty(provider, shift_requirement)
        objective_weight = reward - penalty
        objective_term = decision.variable * objective_weight
        objective_terms.append(objective_term)

    for provider in solver_input.providers:
        provider_decisions = decisions_for_provider(provider, decisions)
        provider_variables = [
            decision.variable
            for decision in provider_decisions
        ]
        assignment_total = model.NewIntVar(0, len(solver_input.shift_requirements), f"total_{provider.id}")
        model.Add(assignment_total == sum(provider_variables))
        provider_assignment_totals.append(assignment_total)

    for first_index, first_total in enumerate(provider_assignment_totals):
        remaining_totals = provider_assignment_totals[first_index + 1 :]

        for second_index, second_total in enumerate(remaining_totals):
            difference_name = f"imbalance_{first_index}_{second_index}"
            difference = model.NewIntVar(0, len(solver_input.shift_requirements), difference_name)
            model.AddAbsEquality(difference, first_total - second_total)
            objective_term = difference * -ASSIGNMENT_IMBALANCE_PENALTY
            objective_terms.append(objective_term)

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
        start_time=shift_requirement.start_time,
        end_time=shift_requirement.end_time,
    )
    return assignment


def solver_result_from_solution(
    solver: cp_model.CpSolver,
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
    result = SolverResult(
        assignments=assignments,
        violations=[],
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
        result = solver_result_from_solution(solver, decisions)
        return result

    result = infeasible_solver_result(candidate_violations)
    return result
