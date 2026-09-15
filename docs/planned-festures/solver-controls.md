# Solver Controls

Status: Initial tuning release implemented; migration required before use.
Created: 2026-09-14.
Updated: 2026-09-14.

## Implementation decisions

- The schedule workspace includes a collapsible tuning panel with sliders, numeric inputs, per-factor explanations, resets, run history, and original outcome breakdowns.
- Seven integer weights accept values from zero through twice their application baseline, in steps of one. Zero disables scoring influence while raw outcomes remain measurable. Coverage stays fixed at 100,000; strict and best-effort coverage behavior is preserved. These bounds are an initial conservative range, not a guarantee of coverage dominance.
- Organization defaults are stored on `Organization`, with a revision check to reject conflicting saves. New organizations receive explicit application defaults. Each accepted run captures its resolved weights independently.
- Existing `ScheduleJob` records hold versioned, typed JSON snapshots of settings, inputs, runtime, solver results, and outcomes. Configuration and captured inputs are saved before solving; the final result and generated draft are committed together. Handled execution failures retain the attempt record.
- Settings and run APIs use the existing admin authorization boundary. The initiating authentication subject is recorded without creating a separate local User record.
- Preference outcomes count positive, negative, neutral, and missing preferences per assigned slot. The positive-preference denominator includes assignments with a specified preference, including neutral and negative values. Missing preferences are shown separately.
- Runtime compatibility includes a hash of scheduling source and the settings contract, the OR-Tools version, time limit, worker setting, and seed. Replay requires the same runtime and generation mode, and reuses captured inputs. Current eligibility is checked again at publication.
- History loads 50 runs at a time. Comparisons use earlier loaded runs only when input fingerprints, generation modes, and runtimes match. Score contributions account for Provider-level fairness rounding.
- Manual descendants retain the original job reference and show original solver measurements as such. Draft cleanup retains recorded run snapshots. Deleting an entire Schedule Period retains the application's existing full-period deletion behavior, including its jobs.
- Historical records without snapshots are not backfilled with guessed settings. A process terminated before completion can leave a run marked running; automatic abandoned-run reconciliation is not part of this release.
- Apply Alembic revision `202609140003` before running the updated application. PostgreSQL migration tests require `SCHEDULE_TEST_POSTGRES_URL` pointing to an isolated test server.

The sections below retain the feature design and acceptance criteria. Named profiles, multi-alternative selection, and sensitivity analysis remain future work.

## Problem and intended outcome

Previously, solver weights were defined only in code, making scheduling tradeoffs difficult to inspect or tune. Generated Schedule Versions retained a total solver score without the exact weights used to produce them.

Add a Solver tuning panel that lets schedulers adjust weights, generate a draft, and understand the resulting schedule. Start with occasional tuning and experimentation so users develop a feel for how the weights matter. Preserve a path to generating several alternatives and choosing between them later.

The core workflow is **adjust → generate → inspect what changed**.

## Current factors

The application baseline coefficients are consolidated in `apps/api/app/schemas/solver_settings.py` and passed to `solver.py` through the typed solver input.

| Group | Factor | Current coefficient | Effect of increasing it |
| --- | --- | ---: | --- |
| Provider preferences | Provider Center preference | 4 | Increases the influence of Provider Center preference scores |
| Provider preferences | Provider shift-type preference | 6 | Increases the influence of Provider shift-type preference scores |
| Provider preferences | Manager placement preference | 5 | Increases the influence of Manager Center Preference scores |
| Requested workload | Below requested minimum | 10 | Increases the penalty per half-shift unit below the requested minimum |
| Requested workload | Above requested maximum | 15 | Increases the penalty per half-shift unit above the requested maximum |
| Workload distribution | Assignment imbalance | 3 | Increases the penalty for pairwise differences in assigned workload units |
| Workload distribution | Historical fairness influence | 10 | Scales the existing debt/favor pressure applied to assigned workload |
| Coverage | Unfilled assignments | 100,000 | Increases the penalty for unfilled assignments in best-effort mode |

These coefficients use different units and accumulate differently. Preference scores apply per assignment; workload uses half-shift units; balance considers pairs of Providers. A weight of 10 is not necessarily twice as influential overall as another factor with a weight of 5.

Historical fairness currently uses debt minus favor credit, multiplied by the Provider's fairness priority multiplier, then scaled and rounded. Its explanation must describe that behavior accurately. Tuning its solver influence does not redefine how fairness debt and favor credit are recorded.

## First-release experience

### Before generation

Place **Solver tuning** beside the Generate action in the schedule workspace. Organize the seven adjustable factors into the three groups above. Display coverage separately with its current behavior explained.

Each adjustable factor includes:

- A slider and numeric input showing the same exact value.
- The application baseline value and the saved organization value.
- A short explanation of what increasing the value encourages.
- The unit used to count the factor.
- An explicit reset action.

Distinguish **Reset to organization default** from **Reset to application baseline**. Resetting the panel changes the pending run configuration; saving an organization default requires a separate action.

Show changes before generation. For example:

> Center preference: 4 → 8. This doubles the score contribution of Center preferences. It does not guarantee twice as many preferred placements.

Do not imply that weights are percentages or that they sum to 100. Optional qualitative labels must map consistently to visible numeric values.

### After generation

Show a compact outcome summary alongside the generated draft:

- Unfilled assignments.
- Providers below their requested minimum, plus total shortfall in workload units.
- Providers above their requested maximum, plus total excess in workload units.
- Provider Center and shift-type preference outcomes.
- Manager placement preference outcomes, within existing access boundaries.
- Workload imbalance and the historical fairness contribution.

Provide an expandable factor breakdown showing each raw measurement, coefficient, and signed score contribution. Calculate measurements from the resulting assignments and captured inputs so disabled factors remain measurable. Account explicitly for fairness scaling and rounding.

Define preference outcome metrics and their denominators before implementation. Neutral or missing preferences must be distinguishable from positive preferences being satisfied.

When comparable previous results exist, show outcome differences. A changed weight may produce the same assignments because constraints and competing factors still favor that result. Explain this without promising that every slider movement changes the schedule.

Total solver scores are not directly comparable across different weights. Use schedule outcomes to judge whether tuning helped. A factor breakdown explains scoring; it does not prove why a particular assignment was necessary.

## Saving and run history

Start with **one saved tuning configuration per organization**. Named profiles are a later enhancement.

- Opening the panel for ordinary generation loads the saved organization configuration.
- Adjustments apply to the next run without changing the organization default.
- **Save as organization default** is a separate, explicit action governed by the application's appropriate management permissions.
- Every accepted generation attempt automatically captures its resolved configuration before solving.
- **Settings used** displays a run's configuration as read-only.
- **Use settings from this run** copies historical values into the panel for a new attempt using current scheduling inputs.
- Editing defaults never changes historical records or existing assignments.

Capture all effective coefficients, including unchanged values and the coverage coefficient. Retain the configuration source and revision, initiating user, timestamps, generation mode, solver implementation identifier, configuration schema version, runtime parameters, duration, result status, and resulting Schedule Version reference when one exists.

Record unsuccessful attempts as well as successful runs. Distinguish infeasible results, time-limited results, and execution errors where supported by the solver. Preserve the attempt record if generation fails before producing a Schedule Version.

Historical runs without a recorded configuration must say **Settings not recorded**. Do not infer their weights from today's defaults.

Run diagnostics describe the original solver output. If a draft is subsequently edited manually, keep its solver provenance and make the distinction visible when displaying original run metrics.

## Controlled experimentation

Include **Try different weights on the same inputs** early in this feature.

Save a typed input snapshot for each run containing the actual solver inputs: requirements, availability, eligibility data, preferences, fairness balances and multipliers, and locked assignments. A controlled experiment reuses that snapshot and changes only the selected weights. It creates a new run and draft while preserving the earlier result.

Keep this action distinct from reusing historical settings with current data. Detect whether snapshots, generation mode, and solver implementation/runtime settings match before presenting differences as a controlled comparison.

A saved snapshot supports controlled inputs, but does not guarantee identical assignments across solver versions, time limits, or nondeterministic execution. Record the relevant execution settings and make incompatible historical replay explicit; do not silently substitute current inputs.

Historical replay still produces a draft. Publishing must apply the application's current publish validation and eligibility rules.

## Constraints and coverage

Weights tune Soft Constraints. Credentialing, active Provider rules, Provider type, Room Type skills, MD-only rules, availability, double-booking, and other Hard Constraints remain enforced. Generation produces drafts and does not publish them automatically.

Initially, display coverage's existing coefficient without offering it as an ordinary slider. Strict mode requires coverage; best-effort mode currently penalizes unfilled assignments with a large finite coefficient.

Before enabling broad weight ranges, decide whether best-effort coverage must always take priority. If so, evaluate an explicit two-stage objective: maximize coverage first, then optimize other factors while preserving that coverage. This is a separate solver behavior decision, not an implicit consequence of adding controls. Define behavior when the first stage reaches its time limit without proving maximum coverage.

A large finite coverage penalty is not an unconditional guarantee that coverage wins every possible tradeoff.

## Implementation approach

1. Consolidate effective solver coefficients into a concrete typed contract. Keep application baseline values identical to current behavior.
2. Add organization configuration persistence and durable run records with configuration and input snapshots. Evaluate the existing `ScheduleJob` model before introducing an overlapping run concept.
3. Resolve and validate configuration at the backend boundary, capture it before solving, and pass it explicitly through input building, solving, and persistence.
4. Persist raw outcome metrics and score contributions with the run result.
5. Add frontend Zod contracts, API client functions, the tuning panel, and historical settings views.
6. Add controlled replay and compact comparisons for matching inputs.

Use Pydantic contracts internally and at backend boundaries, and matching Zod contracts at frontend boundaries. Use concrete structures for stable fields; serialized snapshots must remain schema-validated and versioned. Organization-owned records and access must be scoped by organization.

Choose explicit integer ranges for the first release. Define zero as disabling that objective's influence while retaining outcome measurement. Reject unsupported values rather than silently clamping or substituting defaults. Final upper bounds require calibration against coverage behavior, objective size, and realistic schedules.

Use Alembic migrations for persistence changes. Initialize organization configurations explicitly from the application baseline, including for newly created organizations. Do not fabricate snapshots for older runs.

Use the app-wide `useToast()` system for save and generation feedback. Keep input validation inline. Preserve existing restrictions around Manager Center Preferences and sensitive run snapshots.

## Validation and acceptance criteria

- Application baseline settings preserve current coefficients and expected solver behavior on representative fixtures.
- Each control reaches the corresponding solver objective; focused scenarios demonstrate its intended tradeoff.
- Hard Constraints remain enforced at all supported weight values.
- Zero-weight factors still have accurate raw outcome metrics.
- Reported score contributions reconcile with the solver score for feasible results, including rounding.
- A one-time adjustment does not change the organization default.
- Saved defaults and historical configurations are independent.
- Successful and unsuccessful attempts retain the exact configuration used.
- Controlled replay reuses captured inputs and preserves prior results.
- Comparisons identify changed inputs or execution conditions and do not rank different configurations by raw total score.
- Historical metrics are not presented as metrics for manually edited assignments.
- Access and persistence respect organization and manager-preference boundaries.

Run focused backend checks through `uv run pytest`. Validate frontend changes with the repository lint and build commands when implemented. This document itself requires no application changes or deployment.

## Later enhancements

- Named organization profiles and profile revisions.
- A richer side-by-side alternatives view.
- Generating several configurations from one input snapshot.
- Selecting a preferred alternative through the existing draft review workflow.
- Visual sensitivity analysis showing how outcomes respond to weight changes.

## Follow-up decisions

- Recalibrate the initial bounded weight ranges using real tuning experience.
- Decide whether best-effort coverage should become an explicit first-stage objective.
- Establish a retention policy beyond the current Schedule Period lifetime.
- Add compatibility handling if historical snapshots must replay across future solver versions.
- Decide whether abandoned-run reconciliation is needed before introducing background execution.

These decisions should support the initial tuning workflow without expanding the first release into a full alternatives-management interface.
