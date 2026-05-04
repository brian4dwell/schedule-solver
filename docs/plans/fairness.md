# Fairness Across Time: Love Bank System

## Problem statement

Our current soft-constraint handling can be locally acceptable but globally frustrating: if the same practitioner repeatedly absorbs undesirable assignments week after week, trust in the schedule drops even when each single week looks reasonable.

We need a fairness layer that:

1. Spreads the impact of unavoidable soft-constraint violations across people and time.
2. Allows intentional structural favoring for selected practitioners.
3. Preserves transparency so stakeholders can understand why tradeoffs were made.

## Core concept: Love Bank

Each practitioner has a rolling fairness account ("love bank") that records how much they have recently benefited or suffered from scheduling outcomes.

- Positive scheduling outcomes add points.
- Negative scheduling outcomes remove points.
- Recent history matters more than old history (time decay).
- The solver uses these balances when selecting assignments.

This gives us a single, auditable fairness currency that can be incorporated into optimization.

## Design goals

Preference scoring details live in `docs/plans/prefs.md`.

This document defines fairness accounting and pressure signals consumed by preference and objective composition.


- Reduce repeated burden on the same person.
- Preserve flexibility when schedule feasibility is tight.
- Make special-treatment policy explicit instead of hidden.
- Provide measurable fairness metrics over rolling windows.

## Model design

### 1) Event catalog and point weights

Define schedule events and assign point impact.

Illustrative event impacts:

- Preferred request honored: +1 to +2.
- Undesired shift assignment: -3.
- Soft preference violation: -4.
- Difficult shift pattern (e.g., undesirable adjacency): -5.
- Last-minute reassignment: -6.

We should maintain category-specific event tags for analysis:

- Quality-of-life.
- Workload.
- Preference.
- Volatility.

### 2) Time decay

Use weekly exponential decay to emphasize recent fairness history.

Formula:

`balance[t] = decay * balance[t-1] + weekly_points[t]`

Suggested initial decay range: 0.90 to 0.98 per week.

### 3) Structural favoring via priority tiers

Support explicit practitioner priority tiers (for example: standard, elevated, critical).

Each tier defines:

- A multiplier on negative events.
- Optional protected soft constraints promoted toward hard behavior.
- Optional caps to avoid unlimited preferential accumulation.

This allows intentional favoritism while keeping the policy inspectable and tunable.

### 4) Two-account variant (recommended)

Track two balances instead of one:

1. Fairness debt: burden absorbed recently.
2. Favor credit: special treatment already received.

Why this helps:

- Debt protects practitioners who have repeatedly taken pain.
- Favor credit prevents runaway repeated preference to the same people.

A combined pressure signal can be used during optimization:

`pressure = debt_weight * fairness_debt - favor_weight * favor_credit`

Higher pressure means "protect this person from additional pain this cycle." 

### 5) Solver integration strategy

When evaluating candidate schedules:

- Add marginal fairness cost for negative events.
- Scale that cost by event severity.
- Scale that cost by practitioner pressure and priority tier.
- Pass fairness pressure outputs to preference objective composition in `docs/plans/prefs.md`.

Result:

- Repeated penalties on the same person become progressively expensive.
- The optimizer naturally rotates burden when feasible.

## Guardrails

Apply global protections so fairness accounting cannot produce harmful edge behavior.

- Maximum negative-event count per practitioner per rolling window.
- Minimum rest and safety constraints remain non-negotiable.
- Tier favoritism caps to prevent excessive imbalance.
- Repeat-hit guardrail (same person, same negative event repeatedly).

## Observability and reporting

Expose fairness telemetry each run and in rolling dashboards.

Recommended metrics:

- Negative event distribution (variance, max-min gap, optional Gini).
- Repeat-hit frequency by practitioner and event type.
- Rolling burden concentration over 4/8/12 week windows.
- Outcome differences by priority tier.

Alert examples:

- Same practitioner receives same violation in 3 of last 4 weeks.
- Practitioner fairness debt exceeds threshold.
- A small subset absorbs disproportionate burden over rolling windows.

## Policy and governance

Document and socialize:

- What counts as burden and benefit.
- Why some practitioners have higher priority.
- Decay behavior and how long history persists.
- Non-negotiable constraints.
- Review and dispute workflow.

Transparency is essential for practitioner trust.

---

## Implementation plan

## Current implementation decisions

The first real implementation slice is now contract-backed instead of mock UI data.

Implemented backend surfaces:

- `fairness_config_versions` stores the active decay and weight configuration.
- `provider_fairness_states` stores the current solver-facing debt, favor credit, priority tier, and priority multiplier.
- `provider_fairness_events` stores per-schedule-version ledger entries.
- `provider_fairness_snapshots` stores per-provider balances for each schedule version.
- `GET /fairness/report` returns the latest persisted fairness report.

Implemented scoring events:

- `below_minimum_shift_request` adds debt when a provider receives fewer shifts than their requested weekly minimum.
- `above_maximum_shift_request` adds debt when a provider receives more shifts than their requested weekly maximum.
- `full_shift_availability_accommodation` adds debt when full-day availability is used to cover a shorter shift.
- `under_average_workload` adds favor credit when a provider receives materially lighter workload than the active-provider average.

Planned debt events:

- Center preference accommodations.
- Skill or shift-type preference accommodations.

Implemented solver integration:

- Solver input loading reads persisted `provider_fairness_states`.
- `fairness_debt`, `favor_credit`, and `priority_multiplier` are passed into `SolverProvider`.
- The solver objective uses the resulting pressure to avoid assigning more work to providers with high pressure when feasible.

Implemented accounting lifecycle:

- Saving or generating a schedule version records fairness events and snapshots for that version.
- Publishing a schedule version applies its snapshots to `provider_fairness_states`.
- Draft snapshots are inspectable, but the durable state changes only on publish.

Current caveats:

- The event catalog is intentionally small and based on data already present in the app.
- Priority tier editing is not exposed yet.
- Backtesting and calibration are not implemented yet.
- Re-publishing another version of the same schedule period should be treated carefully until period-replacement accounting is explicitly designed.

## UI implementation plan

The Fairness UI must render only data returned by the backend fairness report contract.

Current UI route:

- `/fairness`

Current UI data source:

- `GET /fairness/report`
- Web validation contract: `apps/web/lib/schemas/fairness.ts`
- API client function: `getFairnessReport`

Current UI views:

- Empty state when no fairness snapshots exist.
- Run summary for the latest schedule version with fairness records.
- Metric cards derived from persisted snapshots.
- Provider balance table showing assignments, ending debt, ending favor credit, pressure, and priority tier.
- Event ledger showing provider, event type, category, debt delta, favor delta, reason, and timestamp.

UI rules:

- Do not hard-code example fairness metrics or fake transaction events.
- Add a backend report field before adding a UI field.
- Keep UI labels aligned with persisted event and snapshot terminology.
- Validate the response with Zod before rendering.
- Show unavailable future concepts as absent, not as placeholder data.

### Phase 0: Alignment and scope

1. Confirm event taxonomy with operations and practitioner stakeholders.
2. Confirm priority tiers and governance policy.
3. Define success criteria (for example: reduce repeat-hit incidents by X%).

Deliverables:

- Approved event catalog.
- Approved tier policy.
- Initial fairness KPI targets.

### Phase 1: Data model and contracts

1. Add practitioner fairness state model.
2. Add event ledger model for weekly outcomes.
3. Define validation contracts for fairness config and event records.
4. Add versioned fairness configuration schema (weights, decay, tier multipliers).

Deliverables:

- Fairness domain models.
- Config contract and loader.
- Migration or bootstrap plan for existing practitioners.

### Phase 2: Scoring engine

1. Implement weekly event scoring pipeline.
2. Implement decay update step.
3. Compute fairness debt, favor credit, and combined pressure.
4. Persist per-practitioner fairness snapshots per schedule run.

Deliverables:

- Deterministic fairness scoring module.
- Unit tests for scoring and decay math.
- Reproducible snapshots for audit.

### Phase 3: Solver objective integration

1. Add fairness terms to soft objective function.
2. Add tier-aware scaling for negative event costs.
3. Add repeat-hit penalties in rolling windows.
4. Tune objective weights against baseline scenarios.

Deliverables:

- Solver fairness objective extension.
- Weight tuning report across representative scenarios.
- Regression benchmarks for feasibility and runtime impact.

### Phase 4: Guardrails and safety constraints

1. Enforce maximum repeat burden thresholds.
2. Enforce non-negotiable clinical/safety constraints independently of fairness points.
3. Add hard stop thresholds for pathological allocations.

Deliverables:

- Guardrail rule set.
- Tests covering edge conditions.

### Phase 5: Reporting and explainability

1. Build run-level fairness summary output.
2. Add rolling fairness dashboard views.
3. Add per-practitioner explanation traces (what events changed balance).

Deliverables:

- Fairness report payload.
- Dashboard slices for operations review.
- Human-readable change trace for each scheduling cycle.

### Phase 6: Backtesting and calibration

1. Replay historical schedules with fairness engine enabled.
2. Compare baseline vs fairness-enabled metrics.
3. Calibrate event weights, decay, and tier multipliers.
4. Re-run until KPI targets and stakeholder acceptance are achieved.

Deliverables:

- Backtest report.
- Calibrated default config.
- Go-live recommendation.

### Phase 7: Rollout

1. Start with shadow mode (score only, no solver influence).
2. Enable low-weight fairness objective in production.
3. Ramp to target weight gradually.
4. Run weekly review for first 8-12 weeks.

Deliverables:

- Rollout plan with checkpoints.
- Incident and override protocol.
- Post-rollout review summary.

## Risks and mitigations

- Risk: Over-favoring priority practitioners causes hidden inequity.
  - Mitigation: Track tier-differential metrics and cap preferential accumulation.

- Risk: Fairness objective reduces schedule feasibility in tight weeks.
  - Mitigation: Keep fairness terms soft, add bounded penalties, preserve hard feasibility constraints.

- Risk: Weight tuning becomes subjective and unstable.
  - Mitigation: Use backtesting, publish rationale, and schedule periodic recalibration.

## Initial configuration recommendations

- Start with two-account model (debt + favor credit).
- Use decay near 0.95 weekly as first trial.
- Keep event catalog small (5-8 events) for first release.
- Use only 2-3 priority tiers initially.
- Add repeat-hit guardrail from day one.

## Definition of done (first release)

- Fairness state is persisted and versioned.
- Solver objective includes fairness pressure terms.
- Repeat-hit metric is available over rolling windows.
- Priority tier policy is encoded and auditable.
- Backtest demonstrates reduction in repeated burden concentration without unacceptable feasibility degradation.
