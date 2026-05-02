# Provider Assignment Plan

## Goal

Each scheduled room slot should support selecting a specific Provider.

The selected Provider must be validated against credentialing, room skills, provider type, MD-specific requirements, weekly availability, min/max shift requests, and overlapping assignments before the schedule can be published.

Draft schedules may keep complete Provider assignments even when one or more assignments currently have unresolved eligibility warnings or hard-constraint violations.

## Draft And Publish Behavior

Schedules can be created in draft state with full Provider assignments already attached.

Draft schedules can be saved repeatedly without removing or weakening assignments.

Draft schedules with unresolved hard-constraint violations cannot be published.

Publish is blocked until every assigned Provider is eligible for the assigned slot.

Publishing should either:

- Reject versions with hard violations.
- Require an explicit future override workflow.

Do not add override behavior in the first pass.

## Domain Rule

A room slot is not fully publishable until it has both:

- A Room.
- A Provider assigned to cover that Room during the slot time.

Provider eligibility should be enforced in one backend service and reused by manual scheduling, saved schedule validation, publish validation, and solver candidate generation.

Do not duplicate eligibility rules independently in the frontend and solver.

## Hard-Constraint Validation In Provider Selection

Provider selection must enforce hard constraints at choice time, not only at publish time.

Hard constraints to validate:

- Required credential exists and is active for the schedule date and time.
- Required skill exists at the required proficiency or certification level.
- MD-specific requirements are satisfied for the assigned shift or service type.
- The Provider is active.
- The Provider type matches the slot requirement when one is set.
- The Provider has submitted compatible weekly availability for the slot day and shift type when availability is treated as a hard constraint.
- Assigning the slot would not put the Provider over the maximum requested shift count for the schedule week.
- The Provider is not already assigned to another overlapping slot in the same schedule version.

Filtering rule:

- Default Provider list ordering shows eligible Providers first.
- Ineligible Providers remain visible in the list.
- Ineligible Providers must be clearly marked as not eligible.

## Eligibility Rules

A Provider can cover a room slot when:

- The Provider is active.
- The Provider type matches the slot requirement when one is set.
- The Provider is credentialed for the slot Center.
- The credential is active for the schedule date and time.
- The Provider has the skills required by the Room's room types.
- Each required skill meets the required proficiency or certification level.
- The Provider can cover MD-specific shifts, services, or `md_only` Rooms when applicable.
- The Provider's weekly availability for the slot weekday is compatible with the slot shift type when availability is a hard constraint.
- The Provider's assignment count for the schedule week, including the candidate slot, does not exceed `max_shifts_requested`.
- The Provider is not already assigned to another overlapping slot in the same schedule version.

If any rule fails, the slot may keep the selected Provider as an invalid draft assignment until the user changes it or publish validation blocks the schedule.

Do not add fallback credential behavior.

If a Provider has no credential row for a Center, treat that Provider as not credentialed for that Center.

If a Room has room types, the Provider must have all required room type skills at the required level.

If a Room has no room types, the room type skill check passes.

## Weekly Availability Rules

Provider assignment uses schedule-week availability, not ad hoc availability blocks, for the first availability-aware scheduling pass.

Availability is stored per Provider, schedule week, and weekday with one or more options:

```text
full_shift
first_half
second_half
short_shift
none
unset
```

Work availability options are:

```text
full_shift
first_half
second_half
short_shift
```

Availability option rules:

- `none` means the Provider is explicitly unavailable for that weekday.
- `unset` means availability has not been supplied for that weekday.
- `none` and `unset` are exclusive and cannot be combined with other options.
- A weekday with one or more work availability options can be considered for matching schedule slots.
- Do not infer availability from missing rows or missing options.

Shift type matching rules:

- A full-shift slot requires `full_shift`.
- A first-half slot requires `first_half`.
- A second-half slot requires `second_half`.
- A short-shift slot requires `short_shift`.
- Do not silently substitute one shift type for another without an explicit product decision.

Min/max shift request rules:

- `min_shifts_requested` and `max_shifts_requested` are stored on the Provider's schedule-week availability.
- Both values must be integers from `0` through `14`.
- `min_shifts_requested` must be less than or equal to `max_shifts_requested`.
- Both values must be less than or equal to the count of weekdays with work availability selected.
- `max_shifts_requested` is a hard cap for publish validation and solver candidate generation.
- `min_shifts_requested` is a schedule-level target, not a per-slot eligibility rule.
- A Provider below `min_shifts_requested` should produce a schedule-level warning or solver objective signal.
- Do not block assigning one otherwise eligible slot only because the Provider is currently below `min_shifts_requested`.
- Count a Provider's assigned shifts once per scheduled slot in the schedule week.

Published schedule weeks lock availability edits.

Draft schedule weeks may update availability, and downstream picker, save, publish, and solver validation must read the latest availability state.

## Ineligibility Reason Visibility

Each ineligible Provider row must display explicit reason codes and human-readable explanations.

Minimum reason categories:

- Missing credential.
- Credential expired or inactive.
- Missing required skill.
- MD requirement not met.
- Availability not supplied, if availability is treated as a hard constraint.
- Availability incompatible with the slot shift type, if availability is treated as a hard constraint.
- Weekly maximum shift request exceeded.
- Weekly minimum shift request not met for schedule-level validation.

UI display behavior:

- Eligible Providers appear at the top of the list.
- Ineligible Providers appear below eligible Providers.
- Within each section, apply the existing secondary sort, such as Provider name.
- The UI should support multiple reasons for one Provider when more than one constraint fails.

Recommended stable constraint types:

```text
inactive_provider
provider_type_mismatch
missing_center_credential
inactive_center_credential
missing_required_skill
insufficient_required_skill_level
md_requirement_not_met
provider_availability_unset
provider_unavailable
provider_shift_type_unavailable
provider_max_shifts_exceeded
provider_min_shifts_not_met
provider_double_booked
```

## Validation Checkpoints

At Provider search or load time, compute an eligibility summary for each candidate Provider.

On Provider selection, block selecting an ineligible Provider only if product direction requires strict selection blocking.

If strict selection blocking is not required, allow temporary selection in draft with clear warnings.

On draft save, allow save with warnings and recorded violations.

On publish, enforce a strict hard-constraint pass for all assignments.

## Frontend Schedule Shape

Change the schedule workspace assignment shape from a day-level Room placement to a room slot with Provider assignment state.

Recommended Zod shape:

```ts
export const scheduleSlotAssignmentSchema = z.object({
  id: z.string().min(1),
  dayKey: scheduleDayKeySchema,
  centerId: z.string().uuid(),
  roomId: z.string().uuid(),
  providerId: z.string().uuid().nullable(),
  shiftType: z.enum(["full_shift", "first_half", "second_half", "short_shift"]),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  sortOrder: z.number().int().min(0),
  validationStatus: z.enum(["unknown", "valid", "warning", "invalid"]),
  validationMessages: z.array(z.string()),
});
```

Recommended Provider picker eligibility shape:

```ts
export const providerIneligibilityReasonSchema = z.object({
  code: z.string().min(1),
  category: z.enum([
    "missing_credential",
    "credential_inactive",
    "missing_skill",
    "md_requirement_not_met",
    "availability_conflict",
    "shift_request_conflict",
    "other_hard_constraint",
  ]),
  message: z.string().min(1),
});

export const providerPickerEligibilitySchema = z.object({
  providerId: z.string().uuid(),
  isEligible: z.boolean(),
  reasons: z.array(providerIneligibilityReasonSchema),
});
```

Recommended Provider weekly availability shape:

```ts
export const providerAvailabilityOptionSchema = z.enum([
  "full_shift",
  "first_half",
  "second_half",
  "short_shift",
  "none",
  "unset",
]);

export const providerWeeklyAvailabilityDaySchema = z.object({
  weekday: scheduleDayKeySchema,
  options: z.array(providerAvailabilityOptionSchema).min(1),
});

export const providerWeeklyAvailabilitySchema = z.object({
  scheduleWeekId: z.string().uuid(),
  providerId: z.string().uuid(),
  isLocked: z.boolean(),
  minShiftsRequested: z.number().int().min(0).max(14),
  maxShiftsRequested: z.number().int().min(0).max(14),
  days: z.array(providerWeeklyAvailabilityDaySchema).length(7),
});
```

Add Zod refinements for exactly one row per weekday, exclusive `none` and `unset` options, `minShiftsRequested <= maxShiftsRequested`, and requested shift counts that do not exceed the number of weekdays with work availability.

Keep the frontend schema as a UI working-copy contract.

Use backend assignment contracts for saved versions.

## Frontend Behavior

Load active Providers into the schedule workspace.

Each scheduled room slot should show:

- Center.
- Room.
- Room type skills.
- MD-only status when applicable.
- Slot time.
- Shift type.
- Provider picker.
- Eligibility status.

The Provider picker should make valid choices easy while preserving visibility into invalid choices.

Provider picker behavior:

- Show eligible Providers first.
- Show ineligible Providers below eligible Providers.
- Clearly mark ineligible Providers as not eligible.
- Display at least one reason for every ineligible Provider.
- Display multiple reasons when more than one hard constraint fails.
- Display availability status for the slot weekday and shift type.
- Display weekly shift count against min/max requested shifts when it affects eligibility or warnings.
- Apply the existing secondary sort within the eligible and ineligible sections.

The frontend may run lightweight local checks for responsive UI, but the backend remains the source of truth.

## UI Implementation TODOs

The availability editor and basic schedule Provider picker exist. The remaining UI work is to connect them through the backend eligibility contract.

TODO:

- Load Provider weekly availability for the active schedule week into the schedule workspace.
- Include slot `shiftType`, start time, end time, and schedule week in Provider eligibility requests.
- Show a distinct reason when a Provider has `unset` availability for the slot weekday.
- Show a distinct reason when a Provider has `none` availability for the slot weekday.
- Show a distinct reason when the slot shift type is not included in the Provider's weekday options.
- Show the Provider's assigned shift count against `min_shifts_requested` and `max_shifts_requested`.
- Mark Providers at or over `max_shifts_requested` as ineligible for additional slots.
- Surface `min_shifts_requested` misses as schedule-level warnings instead of per-slot blockers.
- Recompute picker eligibility when a slot's day, shift type, time, Room, or Provider changes.
- Recompute picker eligibility after availability is saved or deleted.
- Use the backend eligibility response for final picker reason codes instead of only local room/provider checks.
- Keep the local checks only as optimistic UI hints while backend validation is loading.
- Disable availability editing for published weeks in the UI, matching the API lock behavior.

## Backend Validation Contract

Create typed contracts for Provider eligibility checks.

Recommended location:

```text
apps/api/app/services/scheduling/
  provider_eligibility.py
  provider_eligibility_contracts.py
```

Recommended Pydantic models:

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ProviderSlotEligibilityInput(BaseModel):
    organization_id: UUID
    schedule_period_id: UUID
    schedule_version_id: UUID | None
    provider_id: UUID
    center_id: UUID
    room_id: UUID | None
    required_provider_type: str | None
    shift_type: str
    start_time: datetime
    end_time: datetime


class ProviderEligibilityViolation(BaseModel):
    severity: str
    constraint_type: str
    category: str
    message: str


class ProviderSlotEligibilityResult(BaseModel):
    provider_id: UUID
    is_eligible: bool
    violations: list[ProviderEligibilityViolation]
```

The service should return structured violations instead of raising for ordinary eligibility failures.

Raise only for invalid references, missing organization access, or corrupted inputs.

## Backend Validation Rules

The eligibility service should load:

- Provider.
- Center credential rows.
- Room.
- Room room types.
- Provider room type skills.
- Provider schedule-week availability rows.
- Provider assignment counts for the schedule week.
- Existing assignments overlapping the slot when a schedule version is provided.

Check each rule explicitly with intermediate variables.

Create violations using stable constraint types.

## Saving Manual Assignments

Manual schedule saves should create a new immutable `schedule_versions` row and a full set of `assignments`.

Before persisting assignments:

1. Validate the schedule period belongs to the current organization.
2. Validate the parent version belongs to the same period when provided.
3. Validate every submitted Provider assignment through the eligibility service.
4. Create the new schedule version in draft state.
5. Insert assignments.
6. Insert constraint violations for invalid or warning-level assignments.
7. Return the new version and its validation summary.

Do not mutate assignments from previous versions.

Draft save should not remove Provider assignments just because a Provider is currently ineligible.

## Publishing Manual Assignments

Publish should re-run Provider eligibility against the latest credential, skill, MD status, weekly availability, min/max shift requests, and assignment state.

Publish must fail when any assigned Provider has a hard-constraint violation.

Publish should return schedule-level warnings when a Provider is assigned fewer than `min_shifts_requested` shifts.

Publish validation should return a structured summary that identifies each invalid assignment and its reason codes.

## Solver Integration

The solver should reuse the eligibility rules during candidate generation.

For each shift requirement, create Provider candidates only when the eligibility result is valid.

The solver should use `min_shifts_requested` as an objective signal and `max_shifts_requested` as a hard upper bound.

Do not create solver decision variables for invalid Provider-room-slot combinations.

If no valid candidates exist for a shift requirement:

1. Record a hard violation.
2. Fail the schedule job clearly.
3. Do not create fake assignments.

This keeps manual scheduling and generated scheduling consistent.

## API Surface

Add an endpoint for interactive UI validation if needed:

```http
POST /schedule-provider-eligibility
```

Request:

```json
{
  "schedule_version_id": null,
  "schedule_period_id": "00000000-0000-0000-0000-000000000000",
  "provider_id": "00000000-0000-0000-0000-000000000000",
  "center_id": "00000000-0000-0000-0000-000000000000",
  "room_id": "00000000-0000-0000-0000-000000000000",
  "required_provider_type": "crna",
  "shift_type": "full_shift",
  "start_time": "2026-05-04T07:00:00",
  "end_time": "2026-05-04T15:00:00"
}
```

Response:

```json
{
  "provider_id": "00000000-0000-0000-0000-000000000000",
  "is_eligible": false,
  "violations": [
    {
      "severity": "hard_violation",
      "constraint_type": "missing_center_credential",
      "category": "missing_credential",
      "message": "Provider is not credentialed for this center."
    }
  ]
}
```

The save-version endpoint should still perform full validation.

The publish endpoint must always perform strict validation before marking a version published.

The interactive endpoint is only a convenience for better UI feedback.

## Implementation Order

1. Update frontend schedule Zod contracts to include Provider assignment fields.
2. Add Provider picker eligibility Zod contracts with visible ineligibility reasons.
3. Load Providers into the schedule workspace.
4. Load Provider weekly availability into the schedule workspace for the active schedule week.
5. Compute Provider eligibility summaries when Providers are loaded for a slot.
6. Add a Provider picker to each room slot.
7. Sort eligible Providers before ineligible Providers.
8. Display availability and min/max shift reasons in the picker.
9. Add backend Provider eligibility contracts.
10. Add the Provider eligibility service.
11. Add schedule-week availability and min/max shift checks to the eligibility service.
12. Add tests for Provider eligibility rules.
13. Add schedule version draft save validation.
14. Persist violations for invalid saved draft assignments.
15. Add strict publish validation.
16. Reuse eligibility checks in solver candidate generation.
17. Add interactive eligibility endpoint if UI latency requires it.

## Tests

Add focused backend tests for:

- A valid Provider can cover a room slot.
- An inactive Provider is rejected.
- A Provider with the wrong provider type is rejected.
- A Provider without Center credentialing is rejected.
- A Provider with an expired or inactive credential is rejected.
- A Provider missing a required room type skill is rejected.
- A Provider with insufficient skill level is rejected.
- A non-MD Provider is rejected for an MD-specific Room, shift, or service.
- A Provider with `unset` availability is rejected when availability is a hard constraint.
- A Provider with `none` availability is rejected when availability is a hard constraint.
- A Provider without the slot shift type in weekday availability is rejected when availability is a hard constraint.
- A Provider at `max_shifts_requested` is rejected for an additional slot.
- A Provider below `min_shifts_requested` creates a schedule-level warning.
- A Provider already assigned to an overlapping slot is rejected.
- An invalid manual draft save creates a new schedule version and records constraint violations.
- Publishing fails when any assigned Provider has a hard violation.
- Publishing succeeds after the Provider eligibility state is corrected.

Run tests with:

```bash
uv run pytest
```

Do not invoke bare `pytest`.

## Acceptance Criteria

This plan is complete when:

- A scheduler can save a draft schedule with full assignments even when one or more Providers are currently ineligible.
- Draft saves do not remove or weaken existing Provider assignments.
- Publish action is disabled or rejected when any assigned Provider is ineligible.
- Provider picker shows eligible Providers first and still shows ineligible Providers.
- Every ineligible Provider has at least one visible reason explaining why they are not eligible.
- Provider rows can show multiple ineligibility reasons.
- Provider picker reflects weekly availability for the slot weekday and shift type.
- Provider picker reflects `max_shifts_requested` as a hard cap.
- Schedule-level validation reports Providers below `min_shifts_requested` without blocking individual slot assignment.
- If eligibility changes through credentials, skills, MD status, or availability updates, the picker and publish eligibility reflect the latest state.
- The backend validates Provider eligibility with typed contracts.
- Manual schedule saves validate every Provider assignment and record violations.
- Solver candidate generation uses the same eligibility rules.
- Tests cover credentialing, skills, availability, MD-specific requirements, draft save behavior, publish blocking, and overlapping assignments.
