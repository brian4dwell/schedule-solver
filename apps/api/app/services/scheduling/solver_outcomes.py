from app.services.scheduling.shift_request_units import (
    shift_request_units_for_shift_type,
)
from app.services.scheduling.solver import fairness_pressure_for_provider
from app.services.scheduling.solver_contracts import SolverInput
from app.services.scheduling.solver_contracts import SolverResult
from app.services.scheduling.solver_run_contracts import SolverFactorOutcome
from app.services.scheduling.solver_run_contracts import SolverOutcomes
from app.services.scheduling.solver_run_contracts import SolverPreferenceOutcome


def record_preference(outcome: SolverPreferenceOutcome, level: int | None) -> int:
    if level is None:
        outcome.missing += 1
        return 0
    if level > 0:
        outcome.positive += 1
    elif level < 0:
        outcome.negative += 1
    else:
        outcome.neutral += 1
    return level


def measure_solver_outcomes(
    solver_input: SolverInput, result: SolverResult
) -> SolverOutcomes:
    weights = solver_input.preference_weights
    center_preferences = SolverPreferenceOutcome()
    shift_preferences = SolverPreferenceOutcome()
    manager_preferences = SolverPreferenceOutcome()
    center_points = 0
    shift_points = 0
    manager_points = 0
    assigned_count = 0
    shortfall = 0
    excess = 0
    below_count = 0
    above_count = 0
    fairness_raw = 0.0
    fairness_contribution = 0
    workloads: list[int] = []

    for provider in solver_input.providers:
        workload = 0
        for assignment in result.assignments:
            if assignment.provider_id != provider.id:
                continue
            assigned_count += 1
            assignment_units = shift_request_units_for_shift_type(assignment.shift_type)
            workload += assignment_units
            center_level = None
            shift_level = None
            manager_level = None
            for preference in provider.center_preferences:
                if preference.center_id == assignment.center_id:
                    center_level = preference.preference_level
                    break
            for preference in provider.shift_type_preferences:
                if preference.shift_type == assignment.shift_type:
                    shift_level = preference.preference_level
                    break
            for preference in provider.manager_center_preferences:
                if preference.center_id == assignment.center_id:
                    manager_level = preference.preference_level
                    break
            center_points += record_preference(center_preferences, center_level)
            shift_points += record_preference(shift_preferences, shift_level)
            manager_points += record_preference(manager_preferences, manager_level)
        workloads.append(workload)
        requested = provider.week_availability
        provider_shortfall = max(0, requested.min_shifts_requested_units - workload)
        provider_excess = max(0, workload - requested.max_shifts_requested_units)
        shortfall += provider_shortfall
        excess += provider_excess
        if provider_shortfall > 0:
            below_count += 1
        if provider_excess > 0:
            above_count += 1
        pressure = fairness_pressure_for_provider(provider)
        fairness_raw += pressure * workload
        scaled_pressure = pressure * weights.fairness_weight
        rounded_pressure = int(round(scaled_pressure))
        fairness_contribution -= rounded_pressure * workload

    imbalance = 0
    for index, workload in enumerate(workloads):
        for other_workload in workloads[index + 1 :]:
            difference = abs(workload - other_workload)
            imbalance += difference
    required_count = sum(
        shift.required_provider_count for shift in solver_input.shift_requirements
    )
    unfilled_count = required_count - assigned_count
    factors = [
        SolverFactorOutcome(
            factor="center_weight",
            raw_value=center_points,
            weight=weights.center_weight,
            contribution=center_points * weights.center_weight,
        ),
        SolverFactorOutcome(
            factor="shift_type_weight",
            raw_value=shift_points,
            weight=weights.shift_type_weight,
            contribution=shift_points * weights.shift_type_weight,
        ),
        SolverFactorOutcome(
            factor="manager_hidden_weight",
            raw_value=manager_points,
            weight=weights.manager_hidden_weight,
            contribution=manager_points * weights.manager_hidden_weight,
        ),
        SolverFactorOutcome(
            factor="below_minimum_weight",
            raw_value=shortfall,
            weight=weights.below_minimum_weight,
            contribution=-shortfall * weights.below_minimum_weight,
        ),
        SolverFactorOutcome(
            factor="above_maximum_weight",
            raw_value=excess,
            weight=weights.above_maximum_weight,
            contribution=-excess * weights.above_maximum_weight,
        ),
        SolverFactorOutcome(
            factor="balance_weight",
            raw_value=imbalance,
            weight=weights.balance_weight,
            contribution=-imbalance * weights.balance_weight,
        ),
        SolverFactorOutcome(
            factor="fairness_weight",
            raw_value=fairness_raw,
            weight=weights.fairness_weight,
            contribution=fairness_contribution,
        ),
        SolverFactorOutcome(
            factor="unfilled_weight",
            raw_value=unfilled_count,
            weight=weights.unfilled_weight,
            contribution=-unfilled_count * weights.unfilled_weight,
        ),
    ]
    outcomes = SolverOutcomes(
        assigned_count=assigned_count,
        unfilled_count=unfilled_count,
        below_minimum_provider_count=below_count,
        above_maximum_provider_count=above_count,
        center_preferences=center_preferences,
        shift_preferences=shift_preferences,
        manager_preferences=manager_preferences,
        factors=factors,
    )
    return outcomes
