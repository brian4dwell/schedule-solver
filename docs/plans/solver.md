# OR-Tools Schedule Solver

## Goal

Use Google OR-Tools to auto-populate schedule periods with proposed provider assignments.

The solver should run in the background worker, create a new draft `schedule_versions` row, and write proposed `assignments` rows for review.

The solver should not publish schedules directly.

The solver should not mutate older schedule versions.

## High-Level Flow

```text
User clicks Generate Schedule
  ↓
API creates schedule_job with pending status
  ↓
API enqueues worker job
  ↓
Worker loads schedule data from Postgres
  ↓
Worker builds typed solver input
  ↓
Worker runs OR-Tools CP-SAT
  ↓
Worker writes a draft schedule version
  ↓
Worker writes proposed assignments
  ↓
Worker writes constraint violations and warnings
  ↓
UI displays the generated draft for review
```

## Package

Add OR-Tools to the Python environment that owns scheduling generation.

For the current repo shape, that is likely `apps/api` until `apps/worker` has its own package.

```bash
cd apps/api
uv add ortools
```

Python commands in this repo should continue to run through `uv run`.

## Solver Boundary

Keep the solver behind a typed service boundary.

Do not pass unstructured dictionaries through the scheduling pipeline.

Recommended service location:

```text
apps/api/app/services/scheduling/
  solver.py
  solver_contracts.py
  solver_input_builder.py
  solver_persistence.py
```

`solver_contracts.py` should contain the Pydantic models or dataclasses used between the database loader, solver, and persistence layer.

## Solver Input Contracts

Use explicit structures for solver input.

Example shape:

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class SolverTimeBlock(BaseModel):
    start_time: datetime
    end_time: datetime
    availability_type: str


class SolverRoom(BaseModel):
    id: UUID
    center_id: UUID
    md_only: bool
    room_type_ids: list[UUID]


class SolverShiftRequirement(BaseModel):
    id: UUID
    center_id: UUID
    room_id: UUID | None
    start_time: datetime
    end_time: datetime
    required_provider_count: int
    required_provider_type: str | None


class SolverProvider(BaseModel):
    id: UUID
    provider_type: str
    credentialed_center_ids: list[UUID]
    skill_room_type_ids: list[UUID]
    unavailable_blocks: list[SolverTimeBlock]
    preferred_blocks: list[SolverTimeBlock]
    avoid_blocks: list[SolverTimeBlock]


class SolverInput(BaseModel):
    organization_id: UUID
    schedule_period_id: UUID
    schedule_job_id: UUID
    rooms: list[SolverRoom]
    providers: list[SolverProvider]
    shift_requirements: list[SolverShiftRequirement]
```

## Solver Output Contracts

The solver should return assignment decisions and violations separately.

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class SolverAssignment(BaseModel):
    provider_id: UUID
    shift_requirement_id: UUID
    center_id: UUID
    room_id: UUID | None
    start_time: datetime
    end_time: datetime


class SolverViolation(BaseModel):
    severity: str
    constraint_type: str
    message: str


class SolverResult(BaseModel):
    assignments: list[SolverAssignment]
    violations: list[SolverViolation]
    solver_score: float | None
```

Add `metadata_json` later only when a violation needs structured debugging details.

## Data Loaded For A Job

For one `schedule_job`, the worker should load:

- The `schedule_period`.
- Shift requirements inside the schedule period.
- Active providers.
- Provider availability blocks overlapping the schedule period.
- Provider center credentials.
- Provider room type skills.
- Rooms and room types.
- Existing assignments only when the solver needs continuity or conflict checks.

Keep the first solver focused on generating one clean draft from the current demand and provider constraints.

## Candidate Generation

Before creating OR-Tools variables, build valid candidate assignments.

A provider can be a candidate for a shift when:

- The provider is active.
- The provider type matches `required_provider_type` when one is set.
- The provider is credentialed for the shift center.
- The provider is not explicitly unavailable during the shift.
- The provider can cover the room's room types when a room is set.
- The provider can cover `md_only` rooms only when the provider type allows it.

Each valid candidate becomes one boolean decision variable.

```text
x[provider, shift_requirement] = 1 when the provider covers the shift
x[provider, shift_requirement] = 0 when the provider does not cover the shift
```

If a shift has no valid candidates, create a solver violation.

Do not create a fake assignment for an unfillable shift.

## Initial Hard Constraints

Hard constraints define what the solver must obey.

Start with:

- Each shift requirement receives exactly `required_provider_count` assignments.
- A provider cannot be assigned to overlapping shifts.
- A provider cannot be assigned during explicit unavailable blocks.
- A provider cannot be assigned to a center they are not credentialed for.
- A provider cannot be assigned to a room type they cannot cover.
- A non-MD provider cannot be assigned to an MD-only room.

If exact coverage makes the model infeasible, the worker should record constraint violations and fail the job clearly.

Do not silently relax hard constraints.

## Initial Soft Constraints

Soft constraints should affect the objective score.

Start with:

- Prefer assignments inside `preferred` availability blocks.
- Penalize assignments inside `avoid_if_possible` blocks.
- Balance total assignment counts across providers.
- Prefer continuity with the previous draft or published version later.
- Penalize center switching on the same day later.
- Penalize too many consecutive work days later.

Use weighted penalties.

Keep weights named constants so they can be tuned without digging through solver code.

Example:

```python
PREFERRED_BLOCK_REWARD = 10
AVOID_BLOCK_PENALTY = 25
ASSIGNMENT_IMBALANCE_PENALTY = 3
```

## Persistence

Solver output should be saved using the schedule version model from `docs/plans/save_schedules.md`.

When the solver succeeds:

1. Create a new `schedule_versions` row.
2. Set `status` to `draft`.
3. Set `source` to `solver` after the version metadata migration exists.
4. Set `schedule_job_id` to the current job.
5. Set `solver_score` from the solver objective value when available.
6. Insert one `assignments` row for each solver assignment.
7. Set every generated assignment `assignment_status` to `proposed`.
8. Set every generated assignment `source` to `solver`.
9. Insert any warnings into `constraint_violations`.
10. Mark the `schedule_job` as `succeeded`.

When the solver cannot create a valid schedule:

1. Insert available hard-constraint violations when possible.
2. Mark the `schedule_job` as `failed`.
3. Store a clear `error_message`.
4. Do not create a partial schedule version unless the API explicitly supports partial drafts.

## API Surface

Use the existing async generation shape.

```http
POST /schedule-periods/{period_id}/generate
```

Creates a `schedule_job` with `pending` status and enqueues the worker job.

```http
GET /schedule-jobs/{job_id}
```

Returns the job status.

```http
GET /schedule-periods/{period_id}/versions
```

Returns generated and manually saved versions.

```http
GET /schedule-versions/{version_id}/assignments
```

Returns proposed assignments for review.

## Frontend Review Flow

The schedule workspace should load saved versions instead of relying only on local mock state.

The generated schedule should appear as a draft version.

The user should be able to:

- Generate a draft.
- Watch job status.
- Open the generated draft.
- Manually adjust assignments.
- Save manual edits as a new version.
- Publish a reviewed version.

Publishing should remain separate from solving.

## First Implementation Slice

Implement the first useful solver with a small constraint set.

1. Add schedule version read and write endpoints.
2. Add `ortools`.
3. Add typed solver contracts.
4. Add `SolverInput` builder from database rows.
5. Generate candidates for provider type, center credential, unavailable blocks, room types, and MD-only rooms.
6. Add exact shift coverage constraints.
7. Add no-overlapping-provider-shifts constraints.
8. Run CP-SAT.
9. Persist generated assignments into a new draft version.
10. Add job status updates.
11. Add tests for the simple solver cases.

## Tests

Add focused tests for:

- A simple one-shift schedule is filled.
- Unavailable providers are not assigned.
- Providers are not assigned to unauthorized centers.
- Providers are not assigned to unsupported room types.
- Non-MD providers are not assigned to MD-only rooms.
- A provider is not double-booked across overlapping shifts.
- An unfillable shift creates a clear violation.
- A generated schedule creates a new version.
- Older versions are not mutated.

Use `uv run pytest`.

Do not invoke bare `pytest`.

## Later Enhancements

After the first solver works:

- Add configurable constraint weights.
- Add provider weekly hour limits.
- Add maximum consecutive day rules.
- Add fair distribution by provider type.
- Add continuity with prior published schedules.
- Add center-switching penalties.
- Add explanation text for each unfilled shift.
- Add a solver preview endpoint for diagnostics.
- Add an admin page for tuning solver weights.
