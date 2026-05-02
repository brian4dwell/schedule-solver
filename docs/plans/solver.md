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

`solver_contracts.py` should contain the Pydantic models or dataclasses used between the database loader, Provider eligibility service, solver, and persistence layer.

`solver_service.py` should orchestrate the full end-to-end solve flow for Phase 1.

The solver should reuse the backend Provider eligibility service for hard eligibility decisions instead of duplicating those rules.

## Solver Input Contracts

Use explicit structures for solver input.

Example shape:

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class SolverWeeklyAvailabilityDay(BaseModel):
    weekday: str
    options: list[str]


class SolverProviderWeekAvailability(BaseModel):
    provider_id: UUID
    min_shifts_requested: int
    max_shifts_requested: int
    days: list[SolverWeeklyAvailabilityDay]


class SolverRequiredRoomTypeSkill(BaseModel):
    room_type_id: UUID
    required_proficiency_level: int = 1


class SolverRoom(BaseModel):
    id: UUID
    center_id: UUID
    md_only: bool
    is_active: bool
    required_room_type_skills: list[SolverRequiredRoomTypeSkill]


class SolverShiftRequirement(BaseModel):
    id: UUID
    center_id: UUID
    room_id: UUID | None
    shift_type: str
    start_time: datetime
    end_time: datetime
    required_provider_count: int
    required_provider_type: str | None


class SolverProviderRoomTypeSkill(BaseModel):
    room_type_id: UUID
    proficiency_level: int = 1


class SolverProvider(BaseModel):
    id: UUID
    is_active: bool
    provider_type: str
    provider_room_type_skills: list[SolverProviderRoomTypeSkill]
    week_availability: SolverProviderWeekAvailability


class SolverCenterCredential(BaseModel):
    provider_id: UUID
    center_id: UUID
    starts_at: datetime | None
    expires_at: datetime | None
    is_active: bool


class SolverInput(BaseModel):
    organization_id: UUID
    schedule_period_id: UUID
    rooms: list[SolverRoom]
    providers: list[SolverProvider]
    center_credentials: list[SolverCenterCredential]
    shift_requirements: list[SolverShiftRequirement]
```

Add `schedule_job_id` only in Phase 2 when background jobs are introduced.

Keep ad hoc `provider_availability` time blocks out of the first availability-aware solver pass unless a later product decision reintroduces them as preference data.

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
    required_provider_type: str | None
    shift_type: str
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
    is_feasible: bool
```

Add `metadata_json` later only when a violation needs structured debugging details.

## Data Loaded For A Solve Request

For one schedule generation request, load:

- The `schedule_period`.
- Shift requirements inside the schedule period.
- Providers in scheduling scope, including active status.
- Provider schedule-week availability for the schedule period.
- Provider center credentials, including active flags and credential date windows.
- Provider room type skills.
- Rooms and room types.
- Existing assignments only when the solver needs continuity or conflict checks.

Keep the first solver focused on generating one clean draft from the current demand and provider constraints.

## Candidate Generation

Before creating OR-Tools variables, build valid candidate assignments.

For each provider and shift pair, build a `ProviderSlotEligibilityInput` and ask the backend Provider eligibility service whether the provider is eligible.

Only eligible provider and shift pairs should become solver candidates.

A provider can be a candidate for a shift when:

- The provider is active.
- The room is active when the shift targets a room.
- The provider type matches `required_provider_type` when one is set.
- The provider has an active credential for the shift center and schedule date.
- The provider has submitted schedule-week availability for the shift weekday.
- The provider's weekday availability is not `unset`.
- The provider's weekday availability is not `none`.
- The provider's weekday availability includes the shift's `shift_type`.
- The provider can cover all required room type skills when a room is set.
- The provider meets the required room type proficiency levels.
- The provider can cover `md_only` rooms or other MD-specific requirements only when the provider type allows it.
- The provider is not already assigned to an overlapping shift in the same generated schedule.

Each valid candidate becomes one boolean decision variable.

```text
x[provider, shift_requirement] = 1 when the provider covers the shift
x[provider, shift_requirement] = 0 when the provider does not cover the shift
```

If a shift has no valid candidates, create a solver violation.

Do not create a fake assignment for an unfillable shift.

Do not silently substitute one `shift_type` for another during candidate generation.

If the product later allows a half or short shift to satisfy a full-shift request, model that as an explicit candidate type with a named soft penalty.

## Initial Hard Constraints

Hard constraints define what the solver must obey.

Start with:

- Each shift requirement receives exactly `required_provider_count` assignments.
- A provider cannot be assigned to overlapping shifts.
- A shift cannot target a missing or inactive room.
- A provider cannot be assigned when they are inactive.
- A provider cannot be assigned when their provider type does not match the required provider type.
- A provider cannot be assigned to a center without an active credential for the shift date.
- A provider cannot be assigned without compatible schedule-week availability.
- A provider cannot be assigned when weekday availability is missing, `unset`, `none`, or missing the slot `shift_type`.
- A provider cannot be assigned to a required room type they cannot cover.
- A provider cannot be assigned when they do not meet the required room type proficiency level.
- A non-MD provider cannot be assigned to an MD-only room or MD-specific requirement.

If exact coverage makes the model infeasible, record constraint violations and fail the request clearly.

Do not silently relax hard constraints.

Hard solver constraints should match the manual Provider eligibility service. When the eligibility service adds or changes a hard constraint, update solver candidate generation in the same change.

## Initial Soft Constraints

Soft constraints should affect the objective score.

Start with:

- Keep providers at or above `min_shifts_requested` when enough eligible demand exists.
- Keep providers at or below `max_shifts_requested` when enough eligible supply exists.
- Balance total assignment counts across providers after min/max requests are considered.
- Prefer continuity with the previous draft or published version later.
- Prefer assignments inside future `preferred` availability or preference data later.
- Penalize assignments inside future `avoid_if_possible` availability or preference data later.
- Prefer exact shift-type matches if the product later allows substitution.
- Penalize full-shift requests fulfilled by half or short shifts later, only after that substitution is explicitly allowed.
- Penalize center switching on the same day later.
- Penalize too many consecutive work days later.

Use weighted penalties.

Keep weights named constants so they can be tuned without digging through solver code.

Example:

```python
BELOW_MIN_SHIFT_REQUEST_PENALTY = 20
ABOVE_MAX_SHIFT_REQUEST_PENALTY = 30
ASSIGNMENT_IMBALANCE_PENALTY = 3
SHIFT_TYPE_SUBSTITUTION_PENALTY = 50
```

Solver output should include warning-level constraint rows for providers below `min_shifts_requested` or above `max_shifts_requested`.

These warning rows should not block publish.

Do not turn `min_shifts_requested` or `max_shifts_requested` into hard constraints unless product direction explicitly changes them.

## Persistence

Solver output should be saved using the schedule version, assignment, and constraint violation models described in `docs/project.md`.
