# Provider Workload Priority

Status: Planned; not implemented by this document.
Created: 2026-09-14.
Updated: 2026-09-14.

## Problem and outcome

Providers who prioritize working with us, offer substantial availability, and help us cover the schedule should receive priority for available work. When there are fewer shifts than Providers want, managers want to reward those contributions by allocating more of the available workload to those Providers.

Success means a higher share of requested work fulfilled for recognized Providers. Center and shift-type preferences still help choose their assignments, but positive preferences are not required to receive the workload reward.

Example: Two equally eligible Providers each want four shifts, and only six shifts are available. One consistently prioritizes us and offers flexible coverage. An intended outcome is four shifts for that Provider and two for the other, when their priority difference is sufficient and other scheduling constraints allow it. An automatic three/three split would not express the intended policy.

## Recommended approach

Add an admin-controlled **Workload priority** setting under manager preferences. Use Standard, Elevated, and High levels to weight how strongly the solver tries to fulfill each Provider's requested workload.

Store manager recognition as an explicit policy. Use fairness to track how actual workload compares with that policy over time. Equal assignment counts should no longer be the definition of fairness when Providers have different workload priorities or request different amounts of work.

| Component | Responsibility |
| --- | --- |
| Workload priority | Recognize the Provider's contribution and increase their opportunity to receive work |
| Weekly requested workload | State how much work the Provider wants or is willing to accept |
| Availability and eligibility | Determine which assignments the Provider can actually cover |
| Workload fairness | Track repeated shortfalls or excesses relative to the intended allocation |
| Center and shift-type preferences | Help choose suitable assignments within the workload allocation |

Start with manager judgment for recognition. Broad availability, prioritizing our organization, and helping with difficult coverage are reasons a manager can record. Do not automatically equate the number of checked availability options with contribution in the first release.

## Existing implementation and required changes

- `solver.py` already calculates workload in half-shift units through `shift_request_units.py`: a full shift is two units; a half or short shift is one.
- `add_shift_request_objective_terms()` penalizes falling below the weekly minimum and exceeding the maximum with the same coefficients for every Provider.
- `add_assignment_balance_objective_terms()` penalizes pairwise differences in assigned units. This actively favors equal workload and would oppose intentional priority allocations.
- Current fairness pressure is `(fairness_debt - favor_credit) * fairness_priority_multiplier`, and the objective subtracts that pressure per assigned unit. Positive pressure discourages work, and a multiplier has no effect when balances are zero.
- In `fairness.py`, `below_minimum_shift_request` adds debt, as does excess workload. Those events represent opposite desired responses for this feature, so an aggregate debt balance cannot reliably indicate whether someone should get more work or less.
- `under_average_workload` currently adds favor credit. Less work is not necessarily a benefit to a Provider seeking shifts, and a raw active-Provider average does not reflect contribution priority or requested workload.
- `rebuild_published_fairness_state()` reconstructs derived state from publications. Manager workload priority must be stored separately so a rebuild cannot erase recognition.

This feature needs workload objective and fairness changes together. Merely exposing the existing fairness tier or increasing manager Center preference scores would not provide clear workload allocation semantics.

Related context: [Fairness Across Time](../plans/fairness.md) and [Preference Scoring Plan](../plans/prefs.md). Some sections describe future behavior; implementation should follow the current code and the workload policy defined here.

## Manager workflow and policy lifetime

1. Set Workload priority on the Provider's manager preferences page.
2. For Elevated or High, record a reason such as prioritizes our organization, broad availability, flexible coverage, or exceptional help, with an optional explanatory note.
3. Choose the first effective schedule week and an optional final week. Show an absent final week as "No end date."
4. Save with app-wide `useToast()` feedback and field-specific inline validation.
5. Generate a draft and review requested versus assigned workload, priority used, and any remaining shortfall.

Resolve policy using schedule weeks, not the day the solver runs. Changes apply to subsequent generation; saved assignments stay as saved. Standard is the baseline allocation policy, not exclusion from work. Returning to Standard ends preferential workload treatment for the applicable weeks.

The latest policy revision defines the current configuration. Outside its effective weeks, Standard applies by definition; expiry does not reactivate an older elevated revision. Multiple queued policy windows are outside the first release.

Keep recognition levels, reasons, history, and comparative score diagnostics admin-only, following existing manager preference boundaries.

## Weekly workload allocation

Use existing requested minimum and maximum shifts, availability, and hard eligibility. Availability provides scheduling flexibility; it must not be converted into an instruction to assign every available day.

Proposed first-release allocation order:

1. Satisfy hard constraints and prioritize coverage of required work.
2. Strongly favor meeting requested minimums across Providers where feasible. If there is not enough work to meet them all, weight the competing shortfalls by workload priority.
3. Allocate remaining work within requested maximums using workload priority and diminishing marginal rewards, so recognized Providers can receive a larger share without a blanket rule that they take every available shift first.
4. Use workload history and assignment preferences to resolve remaining tradeoffs.

This is a soft allocation policy, not a guarantee of minimum work or a new hard maximum. Existing excess-work warnings and penalties remain applicable. Stop earning priority reward at the Provider's requested maximum, even if coverage needs result in an assignment beyond it.

A Provider requesting no work receives no workload reward. A High Provider with limited availability can receive only eligible assignments; remaining work stays available to other Providers. A Provider with neutral Center and shift preferences still receives full workload-priority consideration.

## Objective design

Use a typed, versioned workload configuration with tier weights, stronger below-minimum fulfillment weights, and a diminishing reward curve for additional requested work. Trial relative tier weights might be Standard `1`, Elevated `1.5`, High `2`; calibrate them against concrete shortage scenarios before choosing defaults.

Model workload using half-shift units and marginal rewards:

```text
assigned_units = sum(selected_assignment_shift_units)
rewarded_units = min(assigned_units, requested_maximum_units)
unit_reward = tier_weight * fulfillment_band_weight * diminishing_reward_factor
workload_reward = sum(unit_reward for each rewarded unit)
```

Units up to the requested minimum receive the stronger fulfillment-band weight. Units between minimum and maximum receive a smaller reward. The diminishing factor decreases across additional units within each band. Encode exact unit thresholds and integer coefficients in the configuration and solver constraints, rather than relying on post-processing. A full shift and two equivalent half shifts earn the same workload reward.

Replace raw pairwise assignment equality with the priority-aware fulfillment objective. Keeping an unrestricted equality penalty alongside the new objective would silently fight the intended allocation. Compare outcomes by requested workload and configured priority, rather than labeling a deliberate four/two allocation unfair solely because counts differ.

For the first release, protect feasible requested minimums before allocating above-minimum reward. This means the illustrative four/two outcome applies when minimums permit it or minimum fulfillment itself is infeasible. If both Providers can receive their requested minimum of three, the proposed policy gives three/three before giving one a fourth. Whether recognition should also outweigh another Provider's feasible minimum is a product decision below.

Implement the stated allocation ordering with explicit optimization stages or proven objective bounds across the supported solve horizon. Do not assume the existing large coverage penalty or a particular tier multiplier guarantees that order. Preserve a shared solve-time budget and report solver status/bounds accurately if a stage cannot prove optimality; do not claim a proven best coverage allocation from a merely feasible solve.

Use configured coefficients and typed intermediate calculations. Keep preference, workload-priority, and historical-fairness contributions separately inspectable. Priority does not change licensing/credential, skill, location, availability, same-day, double-booking, or publish validation rules.

## Fairness across weeks

Separate **unmet demand** from **excess workload** in solver-facing fairness inputs. A Provider repeatedly receiving less than requested should receive pressure toward more suitable work; a Provider repeatedly assigned beyond the requested maximum should receive pressure toward less work. Do not use the same signed aggregate debt to drive both outcomes.

For this feature, derive unmet-demand and excess-workload signals from their typed published events, preserving distinct categories and decay. Keep other burden events separately named; do not silently reinterpret all existing debt. Remove raw `under_average_workload` as a benefit signal in the new workload policy and replace it with requested-workload and priority-aware reporting.

Recognition should remain effective across weeks. A Provider receiving their intended priority allocation should not immediately accumulate an opposing fairness penalty simply because they worked more than Standard Providers. Historical shortfall influence should be bounded and evaluated relative to the priority-aware allocation; it may help with repeated shortages without automatically returning everyone to equal shares.

Persist the policy/configuration used for each published period and use those historical inputs during rebuilds. A manager changing a tier today must not rewrite what past workload allocations meant. Drafts may show projected workload events; durable history changes only on publication. Replacing a publication must rebuild that period's contribution without counting both versions.

Ship the directional fairness changes with the allocation feature. Validate multiple consecutive schedule weeks, not just a single contested shift, to catch accounting feedback that would undo the recognition or amplify under-assignment.

## Data, API, and UI implementation

- Add an organization-owned `ProviderWorkloadPriorityRevision` table with Provider ID, revision number, tier, reason code, optional manager note, effective week range, actor ID, and timestamps. Enforce scoped revision uniqueness and validate week ranges.
- Add versioned workload scoring configuration and concrete typed workload history/snapshot fields or tables for unmet demand and excess work. Do not repurpose the existing fairness multiplier without an explicit migration of its meaning.
- Define how existing published events initialize the new history. Use facts actually recorded; do not invent historical recognition. Standard before the feature's effective date is the explicit baseline policy, and legacy snapshots should remain identifiable.
- Add admin read/update/history endpoints near `apps/api/app/routers/preferences.py`; require organization-scoped Provider access and existing admin authorization.
- Add Pydantic and Zod contracts for policy, dates, workload configuration, resolved solver inputs, and diagnostics. Update `apps/web/lib/api.ts` and manager preference controls together.
- Extend `SolverProvider`, `solver_input_builder.py`, workload objective helpers, and fairness projection/rebuild paths. Batch-load policies and resolve each schedule week independently.
- Persist generation policy/configuration versions, requested units, and relevant history inputs in restricted diagnostics so later changes do not alter saved explanations.
- Show admin report columns for availability offered, requested range, assigned units, workload priority, unmet minimum, and historical shortfall/excess. Distinguish submitted availability from actually usable coverage; individually eligible slots do not necessarily form a jointly feasible schedule.

## Delivery and validation

1. Finalize minimum-versus-priority ordering and the desired strength of recognition using a few sample allocation scenarios.
2. Add policy/configuration persistence, API contracts, admin controls, and historical input capture.
3. Implement the priority-aware workload objective and replace equal-count balancing.
4. Implement directional workload fairness and publication/rebuild handling.
5. Compare identical baseline and proposed solves across shortage, balanced-demand, excess-demand, and constrained-eligibility fixtures, including consecutive weeks.
6. Review coverage, requested-work fulfillment by priority, concentration of shortages, assignments above maximum, preferences, and runtime. State when solver bounds limit the comparison.
7. Document the final policy in `docs/project.md` and update the linked fairness/preference implementation plans when the feature ships.

Acceptance criteria:

- In a controlled six-shift fixture, two equally eligible Providers each accept up to four shifts and have compatible minimums; calibrated High versus Standard priority yields the intended four/two allocation.
- The priority effect works when all Center and shift-type preferences are neutral.
- When available work is insufficient for all minimums, priority influences who receives the scarce assignments.
- When both minimums are feasible, the proposed minimum-first policy meets them before rewarding extra work.
- Reward stops at the requested maximum, and increased priority does not reward assigning unwanted excess work.
- Full and equivalent split shifts have equal workload value; multiple weeks have separate requested ranges and reward curves.
- Priority cannot create eligible candidates, bypass hard requirements, or sacrifice coverage for recognition points.
- Removing the equality penalty allows an intentional unequal workload allocation without a hidden counteracting equal-share objective.
- An unmet minimum produces future pressure toward work; excess work produces pressure away from work. Repeated-week tests preserve recognition while bounding historical effects.
- Changing policy, generating drafts, rebuilding fairness, and replacing publications preserve policy history and do not duplicate workload events.
- Admin-only settings and diagnostics stay out of Provider payloads; cross-organization IDs are rejected.
- Run focused backend checks with `uv run pytest` for objective behavior, fairness direction, publication replay, and authorization, plus frontend checks for policy editing and boundary validation.

## Remaining policy decisions

- How strong should recognition be: a modest preference for more work, or filling High Providers' requested workload before Standard Providers? Proposed starting point: weighted allocation with diminishing rewards.
- Should High priority outweigh another Provider's otherwise feasible requested minimum? Proposed starting point: protect feasible minimums first, then prioritize remaining work.
- Does the existing maximum mean "I would like this much work" or only "I could accept this much"? If those differ operationally, add an explicit desired weekly workload target instead of assuming the maximum is the target.
- Should elevated recognition expire automatically, or remain until changed? Proposed first release: optional final week, visibly displayed.

## Out of scope

Automatic helpfulness scoring, interpreting free-text availability notes, consumable reward credits, guaranteed workload, and changing hard eligibility requirements.
