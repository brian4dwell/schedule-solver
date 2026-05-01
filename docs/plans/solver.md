# OR-Tools Schedule Solver

## Goal

Use Google OR-Tools to auto-populate schedule periods with proposed provider assignments.

The first implementation should run inside the normal FastAPI server request lifecycle.

The first implementation should create a new draft `schedule_versions` row.

The first implementation should write proposed `assignments` rows for review.

The solver should not publish schedules directly.

The solver should not mutate older schedule versions.

We can introduce an RQ worker later if request duration or operational load proves the solve path is truly long running.

## Delivery Phases

### Phase 1: In-Process Solver In FastAPI

Keep orchestration in the API process to reduce debugging complexity.

Use this flow:

```text
User clicks Generate Schedule
  ↓
FastAPI endpoint loads schedule data from Postgres
  ↓
FastAPI endpoint builds typed solver input
  ↓
FastAPI endpoint runs OR-Tools CP-SAT
  ↓
FastAPI endpoint writes a draft schedule version
  ↓
FastAPI endpoint writes proposed assignments
  ↓
FastAPI endpoint writes constraint violations and warnings
  ↓
UI displays the generated draft for review
```

Add instrumentation for solve duration and payload size.

Define an explicit threshold for "too long" based on observed timings in production-like data.

### Phase 2: Optional Background Execution

Only start this phase when Phase 1 shows the solve path is consistently long running or degrades API reliability.

Introduce `schedule_jobs` and RQ processing when there is evidence that async execution is needed.

Keep solver contracts and persistence logic unchanged while moving orchestration to a worker.

## Package

Add OR-Tools to the Python environment that owns scheduling generation.

For the current repo shape, that is `apps/api`.

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
  solver_service.py
```

`solver_contracts.py` should contain the Pydantic models or dataclasses used between the database loader, solver, and persistence layer.

`solver_service.py` should orchestrate the full end-to-end solve flow for Phase 1.

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
    rooms: list[SolverRoom]
    providers: list[SolverProvider]
    shift_requirements: list[SolverShiftRequirement]
```

Add `schedule_job_id` only in Phase 2 when background jobs are introduced.

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

## Data Loaded For A Solve Request

For one schedule generation request, load:

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

If exact coverage makes the model infeasible, record constraint violations and fail the request clearly.

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
