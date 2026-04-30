# Save Schedules With Versions

## Goal

Save schedule periods, draft schedule versions, Provider assignments, manual edits, eligibility violations, and published schedules to Postgres with durable version history.

The provider-assignment work changed this plan in an important way: saved schedule assignments are now Provider-room-slot assignments, not just room placements.

The database backbone is still the right one:

- `schedule_periods` stores the date range being scheduled.
- `schedule_jobs` stores schedule generation attempts.
- `schedule_versions` stores immutable versions of a schedule period.
- `assignments` stores the Provider assignment snapshot for one schedule version.
- `constraint_violations` stores eligibility and scheduling issues tied to a version or assignment.

Build on those tables instead of adding a separate schedule persistence concept.

## Current Baseline

The provider-assignment implementation already added part of the save-schedules surface.

Implemented backend pieces:

- `POST /schedule-provider-eligibility`
- `POST /schedule-versions/draft`
- `POST /schedule-versions/{schedule_version_id}/publish`
- `ProviderSlotEligibilityInput`
- `ProviderEligibilityViolation`
- `ProviderSlotEligibilityResult`
- Draft save request and response schemas in `apps/api/app/schemas/schedule.py`
- Provider eligibility service in `apps/api/app/services/scheduling/provider_eligibility.py`
- Assignment fields for `provider_id`, `center_id`, `room_id`, `shift_requirement_id`, `required_provider_type`, `start_time`, and `end_time`
- Constraint violations created from Provider eligibility failures during draft save

Implemented frontend pieces:

- Zod working-copy shape for schedule slots with `providerId`
- Zod eligibility reason shape for the Provider picker
- Zod schedule version status values for `draft`, `published`, `superseded`, and `working`

Treat those as the baseline. The remaining save-schedules work should fill in schedule-period reads, version reads, version metadata, frontend persistence, and stricter publish state updates.

## Versioning Rule

Treat every saved schedule version as immutable.

The user can edit a working copy in the UI. When the user saves, generates, duplicates, or publishes a schedule, the backend creates a new `schedule_versions` row and a new full set of `assignments`.

Older versions must not have their assignments edited in place.

Draft versions may keep Provider assignments even when one or more assignments has unresolved eligibility warnings or hard-constraint violations.

Published versions must pass strict Provider eligibility validation.

Example history:

```text
Schedule Period
  Version 1 - generated draft
  Version 2 - manually adjusted draft with warnings
  Version 3 - published
  Version 4 - post-publish draft edits
```

## Database Plan

Keep the existing `schedule_versions` table and add the remaining version metadata:

```text
schedule_versions
  id
  organization_id
  schedule_period_id
  schedule_job_id nullable
  version_number
  status
  source
  parent_schedule_version_id nullable
  published_at nullable
  published_by_user_id nullable
  created_by_user_id nullable
  solver_score nullable
  notes nullable
  created_at
  updated_at
```

Recommended statuses:

```text
draft
published
superseded
archived
```

The frontend may keep `working` as a client-only status for unsaved edits.

Recommended sources:

```text
solver
manual
duplicate
import
```

`parent_schedule_version_id` records which version a new version came from.

`published_at` and `published_by_user_id` record the publish event on the selected version.

`created_by_user_id` should remain nullable until real authenticated users replace the current local organization dependency.

## Assignment Storage

Store `assignments` as a full saved snapshot for each version.

Do not store diffs yet. Full snapshots are easier to query, validate, compare, display, and reason about during the first scheduling workflow.

Current assignment snapshot fields include:

```text
organization_id
schedule_version_id
schedule_period_id
provider_id
center_id
room_id nullable
shift_requirement_id nullable
required_provider_type nullable
start_time
end_time
assignment_status
source
notes nullable
created_at
updated_at
```

Keep `provider_id` required for saved assignments in this pass. A schedule slot without a Provider can remain frontend working-copy state until the user saves a complete draft assignment.

Add these fields later if the drag-and-drop schedule workspace needs stable persisted ordering:

```text
sort_order nullable
day_date nullable
```

`day_date` can be derived from `start_time`, so only add it if the UI benefits from storing it directly.

## Validation Rule

Provider eligibility is now part of schedule persistence.

Before persisting a draft version, the backend should:

1. Validate the schedule period belongs to the current organization.
2. Validate the parent version belongs to the same period when provided.
3. Create the draft version.
4. Insert the submitted assignments.
5. Validate every assignment through the Provider eligibility service.
6. Insert `constraint_violations` for each warning or hard violation.
7. Return the saved version, assignments, and violations.

Draft save should not remove or weaken Provider assignments just because a Provider is currently ineligible.

Publish should re-run Provider eligibility against current credential, skill, MD-only, availability, and double-booking state.

Publishing must fail when any assignment has a hard Provider eligibility violation.

Do not add override behavior in this pass.

Do not add fallback credential behavior.

## API Plan

Keep the implemented endpoints and add the missing read and period routes.

Implemented:

```http
POST /schedule-provider-eligibility
POST /schedule-versions/draft
POST /schedule-versions/{schedule_version_id}/publish
```

Add:

```http
GET  /schedule-periods
POST /schedule-periods
GET  /schedule-periods/{period_id}

GET  /schedule-periods/{period_id}/versions
GET  /schedule-versions/{version_id}
GET  /schedule-versions/{version_id}/assignments
GET  /schedule-versions/{version_id}/violations

POST /schedule-versions/{version_id}/duplicate
```

Optionally add this route as an alias around the existing draft-save endpoint if it makes the API more period-oriented:

```http
POST /schedule-periods/{period_id}/versions
```

If both routes exist, keep one implementation path and have the other delegate to it.

Use Pydantic request and response models with meaningful structure:

```python
class ScheduleAssignmentCreate(BaseModel):
    provider_id: UUID
    center_id: UUID
    room_id: UUID | None = None
    shift_requirement_id: UUID | None = None
    required_provider_type: str | None = None
    start_time: datetime
    end_time: datetime
    source: str = "manual"
    notes: str | None = None


class ScheduleDraftSaveRequest(BaseModel):
    schedule_period_id: UUID
    parent_schedule_version_id: UUID | None = None
    notes: str | None = None
    assignments: list[ScheduleAssignmentCreate] = Field(default_factory=list)
```

Mirror backend request and response contracts with Zod schemas in the frontend.

Keep the existing frontend schedule-slot schema as a UI working-copy contract, and add separate Zod contracts for persisted API responses.

## Save Flow

Saving a schedule should happen in one database transaction.

1. Validate the schedule period belongs to the current organization.
2. Validate the parent version belongs to the same period if one is provided.
3. Find the next `version_number` for the period.
4. Insert the `schedule_versions` row with `status = "draft"` and `source = "manual"`.
5. Insert every submitted `assignment` linked to that version.
6. Run Provider eligibility validation for every assignment.
7. Insert any `constraint_violations`.
8. Return the saved version, assignments, and violations.

The current `POST /schedule-versions/draft` endpoint already performs the core save and validation flow. Remaining work should add metadata fields, schedule-period route coverage, read endpoints, and frontend wiring.

## Publish Flow

Publishing should not rewrite assignments.

1. Validate the version belongs to the current organization.
2. Load all assignments for the version.
3. Re-run Provider eligibility for every assignment.
4. Return `409` with structured violation details if any hard violation exists.
5. Mark older published versions for the same period as `superseded`.
6. Mark the selected version as `published`.
7. Set `published_at`.
8. Set `published_by_user_id` when the authenticated user is available.
9. Update `schedule_periods.status` to `published`.

The current publish endpoint re-runs eligibility and blocks publish with `409`, but it still needs superseding behavior, `published_at`, `published_by_user_id`, and schedule-period status updates.

## Frontend Plan

The current schedule workspace is a client-side working copy. It should become a working copy of a persisted schedule version.

1. Replace mock schedule periods with `GET /schedule-periods`.
2. Load the latest draft or published version on `/schedules/[scheduleId]`.
3. Convert persisted assignments into the workspace slot shape.
4. Keep drag-and-drop edits client-side until the user saves.
5. Add a Save button that posts `POST /schedule-versions/draft`.
6. Add a Publish button that publishes the current saved version.
7. Show version history in the schedule workspace.
8. Show saved assignment violations from `constraint_violations`.
9. Keep Provider picker eligibility feedback connected to `POST /schedule-provider-eligibility`.

Use frontend Zod contracts at API boundaries.

Keep frontend-only fields like `dayKey`, `sortOrder`, `validationStatus`, and `validationMessages` out of the persisted backend contract unless the backend starts storing them.

## Implementation Order

Already completed by the provider-assignment work:

1. Add Provider eligibility contracts.
2. Add Provider eligibility service.
3. Add interactive Provider eligibility endpoint.
4. Add draft schedule save endpoint.
5. Validate draft assignments through Provider eligibility.
6. Persist constraint violations for invalid draft assignments.
7. Add publish eligibility blocking.
8. Add focused tests for Provider eligibility rules.

Remaining backend work:

1. Add migration fields on `schedule_versions` for `source`, `parent_schedule_version_id`, `published_at`, `published_by_user_id`, and `created_by_user_id`.
2. Add schedule period Pydantic schemas and CRUD routes.
3. Add schedule version read routes.
4. Add assignment and violation read routes.
5. Update draft save to populate `source` and `parent_schedule_version_id`.
6. Update publish to supersede older published versions.
7. Update publish to set publish metadata and `schedule_periods.status`.
8. Add duplicate-version endpoint.

Remaining frontend work:

1. Add API Zod schemas for schedule periods, persisted versions, assignments, violations, and save responses.
2. Replace mock schedule-period list data with API data.
3. Load persisted versions in the schedule workspace.
4. Save the current workspace as a new draft version.
5. Publish a saved version through the API.
6. Display version history and violation summaries.

Remaining tests:

1. Schedule period CRUD.
2. Draft save creates immutable new versions.
3. Draft save records Provider eligibility violations without dropping assignments.
4. Previous versions are not mutated by later saves.
5. Publish supersedes older published versions.
6. Publish updates schedule period status.
7. Publish returns structured violations when Provider eligibility fails.

Run backend tests with:

```bash
uv run pytest
```

Do not invoke bare `pytest`.
