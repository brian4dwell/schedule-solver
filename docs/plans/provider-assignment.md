# Provider Assignment And Eligibility

## Goal

Each scheduled room slot should support selecting a specific Provider.

The selected Provider must be validated against credentialing, room skills, provider type, availability, and overlapping assignments before the schedule can be saved, generated, or published.

## Domain Rule

A room slot is not fully scheduled until it has both:

- A Room.
- A Provider assigned to cover that Room during the slot time.

Provider eligibility should be enforced in one backend service and reused by manual scheduling, saved schedule validation, and solver candidate generation.

Do not duplicate eligibility rules independently in the frontend and solver.

## Eligibility Rules

A Provider can cover a room slot when:

- The Provider is active.
- The Provider type matches the slot requirement when one is set.
- The Provider is credentialed for the slot Center.
- The Provider has the skills required by the Room's room types.
- The Provider can cover `md_only` Rooms when applicable.
- The Provider is not explicitly unavailable during the slot.
- The Provider is not already assigned to another overlapping slot in the same schedule version.

If any rule fails, the slot should keep the selected Provider only as an invalid working-copy choice until the user changes it or saves a version with recorded constraint violations.

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
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  sortOrder: z.number().int().min(0),
  validationStatus: z.enum(["unknown", "valid", "warning", "invalid"]),
  validationMessages: z.array(z.string()),
});
```

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
- Provider picker.
- Eligibility status.

The Provider picker should make valid choices easy.

The first implementation can either:

- Show only eligible Providers.
- Show all Providers with invalid choices visibly disabled.

Prefer showing all Providers only if the UI clearly explains why a Provider cannot be selected.

The frontend may run lightweight local checks for responsive UI, but the backend remains the source of truth.

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
    schedule_version_id: UUID | None
    provider_id: UUID
    center_id: UUID
    room_id: UUID | None
    required_provider_type: str | None
    start_time: datetime
    end_time: datetime


class ProviderEligibilityViolation(BaseModel):
    severity: str
    constraint_type: str
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
- Provider availability blocks overlapping the slot.
- Existing assignments overlapping the slot when a schedule version is provided.

Check each rule explicitly with intermediate variables.

Create violations using stable constraint types:

```text
inactive_provider
provider_type_mismatch
missing_center_credential
missing_room_type_skill
md_only_provider_mismatch
provider_unavailable
provider_double_booked
```

Do not add fallback credential behavior.

If a Provider has no credential row for a Center, treat that Provider as not credentialed for that Center.

If a Room has room types, the Provider must have all required room type skills.

If a Room has no room types, the room type skill check passes.

## Saving Manual Assignments

Manual schedule saves should create a new immutable `schedule_versions` row and a full set of `assignments`.

Before persisting assignments:

1. Validate the schedule period belongs to the current organization.
2. Validate the parent version belongs to the same period when provided.
3. Validate every submitted Provider assignment through the eligibility service.
4. Create the new schedule version.
5. Insert assignments.
6. Insert constraint violations for invalid or warning-level assignments.
7. Return the new version and its validation summary.

Do not mutate assignments from previous versions.

Publishing should either:

- Reject versions with hard violations.
- Require an explicit future override workflow.

Do not add override behavior in the first pass.

## Solver Integration

The solver should reuse the eligibility rules during candidate generation.

For each shift requirement, create Provider candidates only when the eligibility result is valid.

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
  "provider_id": "00000000-0000-0000-0000-000000000000",
  "center_id": "00000000-0000-0000-0000-000000000000",
  "room_id": "00000000-0000-0000-0000-000000000000",
  "required_provider_type": "crna",
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
      "message": "Provider is not credentialed for this center."
    }
  ]
}
```

The save-version endpoint should still perform full validation.

The interactive endpoint is only a convenience for better UI feedback.

## Implementation Order

1. Update frontend schedule Zod contracts to include Provider assignment fields.
2. Load Providers into the schedule workspace.
3. Add a Provider picker to each room slot.
4. Add backend Provider eligibility contracts.
5. Add the Provider eligibility service.
6. Add tests for Provider eligibility rules.
7. Add schedule version save validation.
8. Persist violations for invalid saved assignments.
9. Reuse eligibility checks in solver candidate generation.
10. Add interactive eligibility endpoint if UI latency requires it.

## Tests

Add focused backend tests for:

- A valid Provider can cover a room slot.
- An inactive Provider is rejected.
- A Provider with the wrong provider type is rejected.
- A Provider without Center credentialing is rejected.
- A Provider missing a required room type skill is rejected.
- A non-MD Provider is rejected for an `md_only` Room.
- An unavailable Provider is rejected.
- A Provider already assigned to an overlapping slot is rejected.
- A valid manual save creates a new schedule version.
- An invalid manual save records constraint violations.

Run tests with:

```bash
uv run pytest
```

Do not invoke bare `pytest`.

## Acceptance Criteria

This plan is complete when:

- Schedule room slots can hold a Provider assignment.
- The UI shows Provider eligibility status per slot.
- The backend validates Provider eligibility with typed contracts.
- Manual schedule saves validate every Provider assignment.
- Invalid assignments create structured constraint violations.
- Solver candidate generation uses the same eligibility rules.
- Tests cover credentialing, skills, availability, MD-only rooms, and overlapping assignments.
