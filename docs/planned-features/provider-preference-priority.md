# Provider Preference Priority

Status: Planned; not implemented by this document.
Created: 2026-09-14.

## Problem and outcome

Some Providers offer substantial flexibility and availability, take difficult coverage, or are especially helpful to the team. Managers want to recognize those contributions by giving these Providers their preferred shifts more often.

The intended reward is better preference fulfillment. More assignments or less work are different outcomes and should not be treated as equivalent rewards.

## Recommended approach

Add a manager-controlled **Preference priority** setting on each Provider. Use it to add a bounded soft bonus when an eligible assignment matches that Provider's own recorded preferences. Keep existing fairness pressure and manager Center preferences as separate objective contributions.

Start with manual recognition and three levels: Standard, Elevated, and High. Require a reason for elevated priority and allow an effective date range. Use explicit names that distinguish this setting from the existing fairness priority tier.

| Approach | What it controls | Fit for this feature |
| --- | --- | --- |
| Existing manager Center preferences | How much the manager wants a Provider at a particular Center | Useful for operational placement; does not necessarily reward what the Provider wants |
| Existing fairness priority multiplier | Scales the Provider's existing fairness pressure | Does not directly target preference fulfillment and can change assignment volume |
| New Provider preference priority | Extra value for honoring this Provider's expressed preferences | Recommended first release |
| Earned recognition credits | Accumulate and spend rewards for specific helpful actions | Possible later extension requiring new accounting semantics |

Example: Two equally eligible Providers request the same desirable full shift. With comparable workload and fairness effects, Elevated priority gives one Provider's preference more influence. They can still lose that shift when the alternative schedule better satisfies coverage, other preferences, or fairness.

## Existing implementation and implications

- `apps/api/app/services/scheduling/solver.py` scores Provider Center preferences, Provider shift-type preferences, and hidden manager Center preferences separately before summing them.
- Current preference weights in `solver_contracts.py` are Center `4`, shift type `6`, and manager hidden `5`. Preference levels range from `-3` to `3`.
- The solver also penalizes requested-shift shortfalls/excesses and assignment imbalance.
- Current solver fairness pressure is `(fairness_debt - favor_credit) * fairness_priority_multiplier`; the objective subtracts pressure scaled by assignment count. Positive pressure discourages additional assignments. With zero balances, changing the multiplier does nothing.
- Therefore, exposing the existing multiplier alone would not implement "give this Provider their preferred shifts more often." Adding manual debt or favor credit would also have indirect, potentially opposite effects.
- `rebuild_published_fairness_state()` in `fairness.py` reconstructs derived Provider states from published schedules and can remove states with no published history. Manager recognition must live outside this derived state.
- Existing admin preference routes and `apps/web/components/providers/provider-preferences-editor.tsx` provide a natural place for management controls.

Related design context: [Preference Scoring Plan](../plans/prefs.md) and [Fairness Across Time](../plans/fairness.md). Those documents include future concepts; use the current implementation as the baseline for this feature.

## Manager workflow

1. Open a Provider's manager preferences and set Preference priority.
2. Choose Standard, Elevated, or High. Standard adds no bonus.
3. For Elevated or High, select a reason: broad availability, flexible coverage, last-minute help, or other contribution. Add a short manager note describing the contribution.
4. Set the first effective schedule date and an optional last effective date. Display an unset end date explicitly as "No end date."
5. Save and show confirmation through `useToast()`; display field validation beside the relevant control.
6. On the next generation, show the priority used and its score contribution in admin draft diagnostics.

Apply dates to the assignment's schedule date, not the date the manager runs the solver. Changes affect subsequent generation; existing draft and published assignments remain as saved. Returning a Provider to Standard stops future bonuses for the applicable dates.

Keep the setting, reasons, change history, and detailed score explanations in admin-only API contracts and UI, consistent with existing manager preference boundaries. Provider-facing scheduling explanations may describe the Provider's matched preferences without exposing manager notes or comparative priority.

## What counts as a preferred shift

For the first release, use the Provider's existing Center and shift-type preferences. Availability means "can work," and does not itself mean "wants this particular shift."

Do not infer preference from the amount of availability offered, a manager Center preference, or free-text [weekly availability notes](weekly-availability-notes.md). If the Provider has no positive recorded preferences, show that priority currently has no matching preference to reward; do not substitute a generic assignment bonus.

The existing data does not express a preference for a specific dated shift, such as "I particularly want next Tuesday morning." Supporting those requests requires a separate typed, date-specific preference input. Confirm whether that is needed for this feature before implementation.

## Proposed scoring

Retain the current base objective and add a separately inspectable priority contribution. Use the Provider-visible preference components only:

```text
center_score = provider_center_preference * center_weight
shift_type_score = provider_shift_type_preference * shift_type_weight
provider_preference_score = center_score + shift_type_score
has_avoid_preference = center_preference < 0 OR shift_type_preference < 0
rewardable_score = 0 if has_avoid_preference else max(0, provider_preference_score)
shift_fraction = existing_shift_request_units / 2
candidate_priority_bonus = rewardable_score * priority_bonus_rate * shift_fraction
weekly_priority_bonus = min(sum(selected_candidate_priority_bonuses), weekly_bonus_cap)
```

Proposed starting rates for calibration: Standard `0%`, Elevated `25%`, High `50%`. For a full shift with Provider Center preference `2` and shift-type preference `3`, the base Provider preference score is `26`; Elevated adds `6.5` and High adds `13` before the weekly cap. Weight shorter assignments using the existing shift-request units so splitting equivalent preferred work does not multiply the reward. These are trial values, not calibrated defaults.

Use fixed-point integer objective coefficients compatible with the current solver. Scale all interacting objective terms consistently; do not truncate small bonuses or accidentally increase preference influence relative to coverage and fairness. Derive the capped weekly term with an explicit solver variable and constraints.

The proposed avoid rule prevents reward points for a shift with a disliked dimension even when another positive dimension outweighs it. Existing base preference scoring still applies to that assignment. Confirm this policy during refinement.

Bound the total bonus per Provider per schedule week and apply the same allowance across a full shift or its equivalent split shifts. Choose the numeric cap through fixtures and calibration, rather than rewarding an unlimited number of assignments. Define week grouping explicitly if generation spans more than one week.

Keep the requested-shift, workload, fairness, and manager preference terms independent. A reward can still affect assignment counts because these objectives interact; validate that effect explicitly rather than promising that counts cannot change.

Coverage must retain precedence over the added reward. The current solver uses a large unfilled-slot penalty. Before enabling priority, prove that the configured total reward bound for the supported solve horizon preserves coverage dominance; if that cannot be established, introduce an explicit coverage-first optimization stage. Do not silently relax coverage to improve priority scores.

All credentialing, licensing as currently modeled, availability, Provider type, skill, same-day, and double-booking checks continue to filter eligible candidates. Priority cannot promote an ineligible Provider into the candidate set or create a publishing override.

## Persistence and boundary contracts

Add a concrete, organization-owned `ProviderPreferencePriorityRevision` table containing revision ID, Provider ID, revision number, priority level, reason code, manager note, effective start/end dates, actor user ID, and creation timestamp. Each save appends a revision instead of overwriting history. Enforce unique revision numbers per organization and Provider.

Proposed first-release revision semantics: the latest revision is the complete current policy. Within its date range, apply its level; outside that range, apply Standard. An expired revision does not reactivate a previous elevated revision. Multiple queued or overlapping recognition grants are out of scope. No configured policy means Standard by definition.

Store tier rates and the weekly cap in a typed, versioned scoring configuration. Managers select a tier rather than entering arbitrary multipliers. A migration introduces the new tables and constraints without repurposing existing fairness tiers or balances.

Add Pydantic contracts for admin reads/writes, revision history, resolved solver priority, scoring configuration, and score diagnostics. Mirror browser-facing boundaries in Zod and extend `apps/web/lib/api.ts`. Use explicit enums, date validation, bounded text, and typed structures rather than free-form maps. Reject unknown tiers and invalid configurations.

Extend `SolverProvider` and `solver_input_builder.py` to pass resolved priority policy into generation. Batch-load policies, and resolve effective dates per candidate. Capture the policy revision, scoring configuration version, and actual preference values used in each saved generation's diagnostics so later edits cannot rewrite the explanation.

Do not put private reasons into general assignment metadata returned to Providers. Store audit information and diagnostics in a dedicated restricted structure. Saving or publishing a schedule must not mutate the manager's priority policy.

## Fairness and reporting

First release: keep debt and favor-credit accounting unchanged. Display priority outcomes alongside fairness so managers can see both recognition and the resulting distribution of work.

Useful admin measures per saved version include matched preferred assignments, available eligible preference opportunities, priority bonus awarded, requested versus assigned shift units, and fairness debt/favor balances. Define the opportunity denominator explicitly as individually eligible Provider/shift pairs; it is not a promise that all such shifts could be assigned together. Prefer comparisons with a baseline solve on identical inputs when evaluating policy impact.

A nonzero priority contribution means that the schedule received reward points. It does not prove that priority caused that assignment. Only describe differences from a controlled comparison as changes between the two solves, and account for solver status and objective bounds when neither solve proves optimality.

Later, if managers want rewards that are earned and used up, add a separate recognition ledger with explicit grants, expiry, and redemption rules. Draft generation must not spend credits; publication would redeem them, and replacing a publication must reverse/rebuild redemptions without double spending. Do not reuse `favor_credit` until its direction and interaction with preference fulfillment are deliberately redesigned.

## Implementation sequence

1. Confirm whether current Center/shift-type preferences express the desired reward; settle tier labels, expiry behavior, and the avoid rule.
2. Add priority revision/configuration models and migrations, admin authorization, Pydantic and Zod contracts, and revision-history reads.
3. Add controls to manager preferences with effective dates, reason, current status, and field-specific validation.
4. Extend solver input loading and typed candidate score breakdowns; implement the integer-scaled, capped priority objective without changing hard eligibility.
5. Persist admin diagnostics with generation inputs and expose priority outcomes alongside existing fairness reporting.
6. Run paired baseline/priority solves on representative fixtures. Calibrate rates and cap against preference fulfillment, coverage, workload, requested shifts, fairness distribution, and runtime.
7. Enable only after the tests below pass and document the selected policy in `docs/project.md` and the linked fairness/preference plans. Standard remains the initial policy for existing Providers.

## Acceptance criteria and validation

- With identical eligibility, preferences, workload, and fairness, an active elevated policy wins a contested preferred shift in a controlled fixture with a uniquely better objective.
- When everyone is Standard or the added weight is zero, objective values match the existing model after accounting for integer scaling; equivalent optimal assignment permutations need not be identical.
- Neutral preferences and manager-only preferences do not generate a Provider reward. An avoid preference produces no priority bonus under the proposed rule.
- A higher tier cannot bypass hard eligibility or reduce coverage to collect reward points.
- High fairness pressure and workload/request effects can outweigh the bounded reward in fixtures where their combined cost is larger.
- The weekly cap is enforced across assignments and equivalent full/split shifts; verify that broad availability does not yield unlimited reward or systematic unwanted excess work.
- Policy start/end dates, Standard resets, and expiry behave as specified; old revisions do not reactivate.
- Priority survives fairness state rebuilds and does not change debt/favor balances merely because a manager edits it.
- Repeated draft generation and replacement publication do not create recognition credits, consume rewards, or duplicate policy revisions.
- Organization isolation, admin authorization, and Provider payload tests protect manager settings, reasons, history, and diagnostics.
- Saved explanations retain the original policy and preference inputs after later edits.
- Run focused `uv run pytest` tests for policy resolution, objective behavior, routes, fairness regression, and publication interactions. Run frontend checks appropriate to the new controls and Zod boundaries.

## Decisions to confirm during refinement

- Is the reward better Center/shift-type matching, specific dated shifts, more of the requested weekly shift count, or some combination? Proposed first release: Center/shift-type matching.
- Are three levels enough, and should Elevated/High require an end date? Proposed first release: optional end date, clearly displayed.
- Should a mixed positive/negative preference match receive no reward as proposed, or should a positive net match qualify?
- How strongly should High priority compete with fairness and unmet shift requests? Choose rates and caps using concrete comparison schedules.
- Should recognition be a standing manager decision or a consumable thank-you for a particular contribution? Proposed first release: standing or time-limited manager policy.

## Out of scope

Automatic scoring of helpfulness, automatically rewarding the number of availability options submitted, interpreting free-text notes, guaranteed shifts, hard constraint overrides, and consumable recognition credits in the first release.
