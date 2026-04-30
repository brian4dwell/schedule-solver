# Save Schedules With Versions

## Goal

Save schedule periods, generated schedules, manual edits, and published schedules to Postgres with durable version history.

The existing database model already has the right backbone:

- `schedule_periods` stores the date range being scheduled.
- `schedule_jobs` stores schedule generation attempts.
- `schedule_versions` stores immutable versions of a schedule period.
- `assignments` stores the assignment snapshot for one schedule version.
- `constraint_violations` stores issues tied to a version or assignment.

Build on those tables instead of adding a separate schedule persistence concept.

## Versioning Rule

Treat every saved schedule version as immutable.

The user can edit a working copy in the UI. When the user saves, generates, duplicates, or publishes a schedule, the backend creates a new `schedule_versions` row and a new full set of `assignments`.

Older versions should not have their assignments edited in place.

Example history:

```text
Schedule Period
  Version 1 - generated draft
  Version 2 - manually adjusted
  Version 3 - published
  Version 4 - post-publish draft edits
```

## Database Plan

Add a little more meaning to `schedule_versions`:

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

Recommended sources:

```text
solver
manual
duplicate
import
```

`parent_schedule_version_id` records which version a new version came from.

## Assignment Storage

Store `assignments` as a full saved snapshot for each version.

Do not store diffs yet. Full snapshots are easier to query, validate, compare, display, and reason about during the first scheduling workflow.

Add these fields later if the drag-and-drop schedule workspace needs stable ordering:

```text
sort_order nullable
day_date nullable
```

`day_date` can be derived from `start_time`, so only add it if the UI benefits from storing it directly.

## API Plan

Add scheduling endpoints. They can live in one `schedules.py` router first, then split later if the file gets too large.

```http
GET  /schedule-periods
POST /schedule-periods
GET  /schedule-periods/{period_id}

GET  /schedule-periods/{period_id}/versions
POST /schedule-periods/{period_id}/versions
GET  /schedule-versions/{version_id}
GET  /schedule-versions/{version_id}/assignments

POST /schedule-versions/{version_id}/duplicate
POST /schedule-versions/{version_id}/publish
```

For saving edits from the frontend:

```http
POST /schedule-periods/{period_id}/versions
```

Use Pydantic request models with meaningful structure:

```python
class AssignmentCreate(BaseModel):
    provider_id: UUID
    center_id: UUID
    room_id: UUID | None
    shift_requirement_id: UUID | None
    start_time: datetime
    end_time: datetime
    assignment_status: str
    source: str
    notes: str | None


class ScheduleVersionCreate(BaseModel):
    parent_schedule_version_id: UUID | None
    notes: str | None
    assignments: list[AssignmentCreate]
```

Mirror these request and response contracts with Zod schemas in the frontend.

## Save Flow

Saving a schedule should happen in one database transaction.

1. Validate the schedule period belongs to the current organization.
2. Validate the parent version belongs to the same period if one is provided.
3. Find the next `version_number` for the period.
4. Insert the `schedule_versions` row.
5. Insert every submitted `assignment` linked to that version.
6. Run basic validation.
7. Insert any `constraint_violations`.
8. Return the saved version and assignments.

## Publish Flow

Publishing should not rewrite assignments.

1. Validate the version belongs to the current organization.
2. Validate the version belongs to the target schedule period.
3. Mark older published versions for the same period as `superseded`.
4. Mark the selected version as `published`.
5. Set `published_at`.
6. Set `published_by_user_id` when the authenticated user is available.
7. Update `schedule_periods.status` to `published`.

## Frontend Plan

The current schedule workspace can become a client-side working copy of a saved version.

1. Replace mock schedule periods with `GET /schedule-periods`.
2. Load the latest draft or published version on `/schedules/[scheduleId]`.
3. Keep drag-and-drop edits client-side until the user saves.
4. Add a Save button that posts a new version.
5. Add a Publish button that publishes the current saved version.
6. Show version history in the schedule workspace.

## Implementation Order

1. Add Pydantic schemas for schedule periods, versions, assignments, and publish responses.
2. Add API routes for schedule period, schedule version, and assignment reads.
3. Add a create-version transaction that saves assignments as a full snapshot.
4. Add the publish endpoint.
5. Add an Alembic migration for the version metadata fields.
6. Wire the frontend schedule pages to the API with Zod parsing.
7. Add tests for version creation, immutable old versions, and publishing superseding prior versions.

