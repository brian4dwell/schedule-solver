

That gives Next.js a clean `apps/web` folder. Then add `apps/api`, `apps/worker`, `packages/shared`, `infra`, and `docs` around it.

Below is a Codex-ready document you can drop in as `docs/IMPLEMENTATION_PROMPT.md` or paste directly into Codex.

---

# CRNA Surgery Center Scheduling Tool — Codex Implementation Brief

## Project Goal

Build an internal scheduling tool for CRNA / anesthesia coverage across multiple surgery centers.

This should be a Homebase-style scheduling app, but specialized for surgery-center staffing, room coverage, provider availability, provider preferences, credential requirements, and constraint-based schedule generation.

The tool will eventually use a solver such as Google OR-Tools, but the first implementation should establish a clean full-stack foundation.

## Glossary

Use these domain terms consistently throughout the codebase, database, API, UI, and docs.

```text
Center = physical surgery center location
Room = surgical room inside a Center
Provider = person doing the scheduled service, including CRNA, doctor, staff, or contractor
```


## Chosen Stack

```text
Hosting: Fly.io
Auth: Clerk
Frontend: Next.js
Frontend validation/types: Zod
Backend: FastAPI
Backend validation/types: Pydantic
ORM: SQLAlchemy 2.x
Migrations: Alembic
Database: Postgres
UI: Tailwind CSS + shadcn/ui
Queue: Redis
Worker: Python worker, initially RQ or simple job runner
Solver: Google OR-Tools later
```

## Architecture

The app should be split into three logical parts:

```text
apps/web      = Next.js frontend
apps/api      = FastAPI backend
apps/worker   = Python background worker for scheduling jobs
```

The backend is the source of truth. The frontend should not write directly to the database.

```text
Next.js UI
  ↓
Zod validates frontend forms
  ↓
FastAPI API
  ↓
Pydantic validates requests
  ↓
SQLAlchemy writes to Postgres
  ↓
Alembic manages schema migrations
```

Schedule generation should be asynchronous from day one.

```text
User clicks Generate Schedule
  ↓
API creates scheduling_job row
  ↓
API enqueues background job
  ↓
Worker runs scheduling logic
  ↓
Worker writes draft schedule/version/assignments
  ↓
UI displays proposed schedule for review
```

## Repo Layout

Create or use the following structure:

```text
crna-scheduler/
  apps/
    web/
      Next.js app
    api/
      FastAPI app
    worker/
      Python worker app

  packages/
    shared/
      shared constants and generated API types later

  infra/
    fly/
      fly.toml files or deployment notes

  docs/
    IMPLEMENTATION_PROMPT.md
    DOMAIN_MODEL.md
    SCHEDULING_CONSTRAINTS.md

  README.md
  .gitignore
```

## Important Next.js Bootstrap Instruction

This architecture is compatible with Next.js.

Use `create-next-app` inside `apps/web`.

Recommended bootstrap:

```bash
mkdir crna-scheduler
cd crna-scheduler

mkdir -p apps
cd apps

npx create-next-app@latest web
```

Recommended answers for `create-next-app`:

```text
TypeScript: Yes
ESLint: Yes
Tailwind CSS: Yes
src directory: Optional, prefer No unless already using src convention
App Router: Yes
Turbopack: Yes if stable in current environment, otherwise No
Import alias: Yes
Alias: @/*
```

Then return to repo root:

```bash
cd ..
cd ..
mkdir -p apps/api apps/worker packages/shared infra/fly docs
```

Do not place `package.json`, `next.config.ts`, or `app/` at the repo root. They belong in `apps/web`.

## Initial Milestone

Build the first vertical slice:

```text
1. Clerk login
2. API health check
3. Postgres connection
4. Alembic migration setup
5. Create Centers
6. Create Rooms under Centers
7. Create Providers
8. Add basic Provider availability
9. Create Schedule Period
10. Click Generate Schedule
11. Worker creates placeholder draft schedule
12. UI displays schedule job status and draft assignments
```

The first solver can be fake/simple. The goal is to establish the job pipeline and data model before adding OR-Tools complexity.

## Backend Requirements

Use FastAPI.

Create this rough backend structure:

```text
apps/api/
  app/
    main.py

    core/
      config.py
      security.py

    auth/
      clerk.py

    db/
      base.py
      session.py
      models/
        organization.py
        user.py
        center.py
        room.py
        provider.py
        provider_availability.py
        schedule_period.py
        schedule_job.py
        schedule_version.py
        assignment.py

    schemas/
      center.py
      room.py
      provider.py
      provider_availability.py
      schedule_period.py
      schedule_job.py
      assignment.py

    routers/
      health.py
      centers.py
      rooms.py
      providers.py
      provider_availability.py
      schedule_periods.py
      schedule_jobs.py

    services/
      scheduling/
        generate_placeholder_schedule.py
        constraints.py

  alembic/
  alembic.ini
  pyproject.toml
```

## Backend Libraries

Use:

```text
fastapi
uvicorn
pydantic
pydantic-settings
sqlalchemy
alembic
psycopg[binary]
python-dotenv
httpx
python-jose or PyJWT
redis
rq
```

## Backend Environment Variables

Support these env vars:

```env
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/crna_scheduler
CLERK_SECRET_KEY=
CLERK_JWT_ISSUER=
CLERK_JWKS_URL=
REDIS_URL=redis://localhost:6379/0
ENVIRONMENT=development
```

## Backend Auth

Use Clerk for identity.

The frontend sends the Clerk session token to the API as:

```http
Authorization: Bearer <token>
```

The API should verify the JWT against Clerk’s JWKS.

For MVP, implement auth middleware/dependency but allow an environment flag for local development if needed.

Suggested dependency:

```python
get_current_user()
```

This should return an app-level user object containing:

```text
clerk_user_id
clerk_org_id, if available
email
role
```

Store app-specific authorization in Postgres.

## Database Model

Use UUID primary keys unless there is a strong reason not to.

Use `created_at` and `updated_at` timestamps on core tables.

### organizations

Represents the internal company/practice using the tool.

Fields:

```text
id
clerk_org_id nullable
name
created_at
updated_at
```

### users

Application users.

Fields:

```text
id
organization_id
clerk_user_id
email
first_name nullable
last_name nullable
role
created_at
updated_at
```

Roles for now:

```text
owner
admin
scheduler
viewer
provider
```

### centers

Physical surgery center locations.

Fields:

```text
id
organization_id
name
address_line_1 nullable
address_line_2 nullable
city nullable
state nullable
postal_code nullable
timezone
is_active
created_at
updated_at
```

### rooms

Surgical rooms inside a Center.

Fields:

```text
id
organization_id
center_id
name
display_order
is_active
created_at
updated_at
```

A Room belongs to exactly one Center.

### providers

Broad table for people who can be scheduled.

Fields:

```text
id
organization_id
first_name
last_name
display_name
email nullable
phone nullable
provider_type
employment_type
is_active
notes nullable
created_at
updated_at
```

`provider_type` examples:

```text
crna
doctor
staff
contractor
other
```

`employment_type` examples:

```text
employee
contractor
locum
other
```

### provider_credentials

Credentials or permissions that affect scheduling.

Fields:

```text
id
organization_id
provider_id
credential_type
credential_value
expires_at nullable
created_at
updated_at
```

Examples:

```text
can_cover_center
can_cover_room
pediatric_certified
cardiac_certified
state_license
```

Keep flexible for MVP.

### provider_availability

Provider availability blocks.

Fields:

```text
id
organization_id
provider_id
start_time
end_time
availability_type
notes nullable
created_at
updated_at
```

`availability_type` examples:

```text
available
unavailable
preferred
avoid_if_possible
```

### shift_requirements

The demand side of the schedule: what coverage is needed.

Fields:

```text
id
organization_id
center_id
room_id nullable
start_time
end_time
required_provider_count
required_provider_type nullable
notes nullable
created_at
updated_at
```

For example:

```text
Center A, Room 1, Monday 7am-3pm, needs 1 CRNA
```

### schedule_periods

Represents a date range being scheduled.

Fields:

```text
id
organization_id
name
start_date
end_date
status
created_at
updated_at
```

`status` examples:

```text
draft
generating
ready_for_review
published
archived
```

### schedule_jobs

Tracks schedule generation jobs.

Fields:

```text
id
organization_id
schedule_period_id
status
requested_by_user_id nullable
started_at nullable
finished_at nullable
error_message nullable
created_at
updated_at
```

`status` examples:

```text
pending
running
succeeded
failed
cancelled
```

### schedule_versions

Each solver/manual generation creates a version.

Fields:

```text
id
organization_id
schedule_period_id
schedule_job_id nullable
version_number
status
solver_score nullable
notes nullable
created_at
updated_at
```

`status` examples:

```text
draft
reviewed
published
superseded
```

### assignments

Actual proposed or published assignments.

Fields:

```text
id
organization_id
schedule_version_id
schedule_period_id
provider_id
center_id
room_id nullable
shift_requirement_id nullable
start_time
end_time
assignment_status
source
notes nullable
created_at
updated_at
```

`assignment_status` examples:

```text
proposed
accepted
declined
published
removed
```

`source` examples:

```text
solver
manual
import
```

### constraint_violations

Track schedule issues.

Fields:

```text
id
organization_id
schedule_version_id
assignment_id nullable
severity
constraint_type
message
metadata_json nullable
created_at
updated_at
```

`severity` examples:

```text
info
warning
error
hard_violation
```

## API Endpoints

Implement REST endpoints.

### Health

```http
GET /health
```

Returns:

```json
{
  "status": "ok"
}
```

### Centers

```http
GET /centers
POST /centers
GET /centers/{center_id}
PATCH /centers/{center_id}
DELETE /centers/{center_id}
```

Use soft delete by setting `is_active = false`.

### Rooms

```http
GET /centers/{center_id}/rooms
POST /centers/{center_id}/rooms
GET /rooms/{room_id}
PATCH /rooms/{room_id}
DELETE /rooms/{room_id}
```

Use soft delete by setting `is_active = false`.

### Providers

```http
GET /providers
POST /providers
GET /providers/{provider_id}
PATCH /providers/{provider_id}
DELETE /providers/{provider_id}
```

Use soft delete by setting `is_active = false`.

### Provider Availability

```http
GET /providers/{provider_id}/availability
POST /providers/{provider_id}/availability
PATCH /provider-availability/{availability_id}
DELETE /provider-availability/{availability_id}
```

### Shift Requirements

```http
GET /shift-requirements
POST /shift-requirements
GET /shift-requirements/{shift_requirement_id}
PATCH /shift-requirements/{shift_requirement_id}
DELETE /shift-requirements/{shift_requirement_id}
```

### Schedule Periods

```http
GET /schedule-periods
POST /schedule-periods
GET /schedule-periods/{schedule_period_id}
PATCH /schedule-periods/{schedule_period_id}
```

### Schedule Generation

```http
POST /schedule-periods/{schedule_period_id}/generate
```

Creates a `schedule_job` with status `pending`, enqueues background work, and returns the job.

```http
GET /schedule-jobs/{schedule_job_id}
```

Returns job status.

```http
GET /schedule-periods/{schedule_period_id}/versions
```

Returns schedule versions.

```http
GET /schedule-versions/{schedule_version_id}/assignments
```

Returns assignments for display in the frontend.

## Worker Requirements

Create a worker in `apps/worker`.

For MVP, the worker can import shared backend modules if needed, but avoid circular dependencies.

The worker should:

```text
1. Pull a schedule_job from Redis/RQ
2. Mark schedule_job as running
3. Read schedule_period, shift_requirements, providers, availability
4. Generate placeholder assignments
5. Create schedule_version
6. Create assignments
7. Create constraint_violations if needed
8. Mark job succeeded or failed
```

For the placeholder solver:

```text
For each shift requirement:
  choose the first active Provider who:
    - has matching provider_type if required
    - does not have explicit unavailable block overlapping the shift
  create assignment
```

This is intentionally simple. Later replace with OR-Tools.

## Frontend Requirements

Use Next.js App Router.

Use Clerk for auth.

Use Tailwind and shadcn/ui.

Suggested frontend structure:

```text
apps/web/
  app/
    layout.tsx
    page.tsx

    dashboard/
      page.tsx

    centers/
      page.tsx
      new/
        page.tsx
      [centerId]/
        page.tsx

    rooms/
      page.tsx

    providers/
      page.tsx
      new/
        page.tsx
      [providerId]/
        page.tsx

    availability/
      page.tsx

    shift-requirements/
      page.tsx

    schedule-periods/
      page.tsx
      [schedulePeriodId]/
        page.tsx
        review/
          page.tsx

  components/
    layout/
      app-shell.tsx
      sidebar.tsx
      top-nav.tsx

    centers/
      center-form.tsx
      centers-table.tsx

    rooms/
      room-form.tsx
      rooms-table.tsx

    providers/
      provider-form.tsx
      providers-table.tsx

    scheduling/
      schedule-grid.tsx
      generate-schedule-button.tsx
      schedule-job-status.tsx

  lib/
    api.ts
    schemas/
      center.ts
      room.ts
      provider.ts
      providerAvailability.ts
      shiftRequirement.ts
      schedulePeriod.ts
```

## Frontend Pages

### Dashboard

Show simple navigation cards:

```text
Centers
Rooms
Providers
Availability
Shift Requirements
Schedule Periods
```

### Centers Page

Allow users to:

```text
view centers
create center
edit center
deactivate center
```

### Center Detail Page

Show:

```text
center info
rooms inside center
button to add room
```

### Providers Page

Allow users to:

```text
view providers
create provider
edit provider
deactivate provider
```

Use the term Provider in the UI.

### Availability Page

Allow basic provider availability creation.

For MVP this can be a simple form:

```text
Provider
Start time
End time
Availability type
Notes
```

### Shift Requirements Page

Allow creation of demand/coverage requirements.

Fields:

```text
Center
Room optional
Start time
End time
Required provider count
Required provider type optional
Notes
```

### Schedule Periods Page

Allow creation of a schedule period.

Fields:

```text
Name
Start date
End date
```

### Schedule Period Detail Page

Show:

```text
Generate Schedule button
latest schedule job status
schedule versions
link to review screen
```

### Schedule Review Page

Show assignments in a simple grid/table.

MVP table columns:

```text
Date
Start
End
Center
Room
Provider
Status
Source
Notes
```

## Zod Schemas

Create Zod schemas for frontend form validation.

Example:

```ts
import { z } from "zod";

export const providerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  providerType: z.enum(["crna", "doctor", "staff", "contractor", "other"]),
  employmentType: z.enum(["employee", "contractor", "locum", "other"]),
  notes: z.string().optional(),
});
```

## Pydantic Schemas

Create equivalent Pydantic schemas in the API.

Example:

```python
from pydantic import BaseModel, EmailStr
from typing import Optional, Literal

class ProviderCreate(BaseModel):
    first_name: str
    last_name: str
    display_name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    provider_type: Literal["crna", "doctor", "staff", "contractor", "other"]
    employment_type: Literal["employee", "contractor", "locum", "other"]
    notes: Optional[str] = None
```

## Naming Conventions

Use snake_case in the backend and database.

```text
provider_type
employment_type
created_at
```

Use camelCase in the frontend.

```text
providerType
employmentType
createdAt
```

The API may return snake_case initially. If convenient, convert at the frontend API client boundary.

## Development Setup

Use Docker Compose for local Postgres and Redis.

Create:

```text
docker-compose.yml
```

With:

```text
postgres
redis
```

Use local commands:

```bash
# web
cd apps/web
npm run dev

# api
cd apps/api
uvicorn app.main:app --reload --port 8000

# worker
cd apps/worker
python -m worker.main
```

## Fly Deployment Direction

Eventually deploy:

```text
crna-scheduler-web
crna-scheduler-api
crna-scheduler-worker
```

Or use one Fly app with multiple process groups.

For MVP, prefer separate apps if it keeps deployment clearer:

```text
web = Next.js app
api = FastAPI app
worker = Python worker
```

All connect to the same Postgres and Redis.

## Non-Goals For First Pass

Do not implement these yet:

```text
full OR-Tools optimization
complex recurring availability rules
SMS/email notifications
payroll
mobile app
calendar sync
document parsing
advanced permissions
multi-tenant billing
```

Build the simple vertical slice first.

## First Codex Task

Implement the initial repo scaffold and basic CRUD foundation.

Tasks:

```text
1. Create monorepo structure.
2. Bootstrap Next.js app in apps/web.
3. Add Tailwind/shadcn-compatible layout.
4. Create FastAPI app in apps/api.
5. Add SQLAlchemy database setup.
6. Add Alembic migration setup.
7. Create initial SQLAlchemy models:
   - Organization
   - User
   - Center
   - Room
   - Provider
   - ProviderAvailability
   - ShiftRequirement
   - SchedulePeriod
   - ScheduleJob
   - ScheduleVersion
   - Assignment
   - ConstraintViolation
8. Create initial Pydantic schemas.
9. Create CRUD endpoints for Centers, Rooms, Providers.
10. Create health endpoint.
11. Create docker-compose.yml with Postgres and Redis.
12. Create README with local development commands.
```

## Acceptance Criteria

The first pass is complete when:

```text
1. `apps/web` runs locally with Next.js.
2. `apps/api` runs locally with FastAPI.
3. `/health` returns `{ "status": "ok" }`.
4. Alembic can create and apply the initial migration.
5. The API can create/list/update/deactivate Centers.
6. The API can create/list/update/deactivate Rooms under Centers.
7. The API can create/list/update/deactivate Providers.
8. The frontend has basic pages for Centers, Rooms, and Providers.
9. The UI consistently uses the term Provider.
10. There are no references to Clinician as the broad scheduling entity.
```

## Important Implementation Note

Keep the first version boring and explicit. Avoid clever abstractions.

The purpose of this first pass is to create a stable foundation for:

```text
availability capture
shift requirements
schedule generation jobs
manual schedule review
OR-Tools optimization
constraint explanations
```

Do not overbuild the solver yet. Build the data model, API, and UI foundation first.

---

## Answer on Next.js compatibility

This project layout will **not** break Next.js as long as Next.js lives inside `apps/web`.

This is safe:

```text
crna-scheduler/
  apps/
    web/
      package.json
      next.config.ts
      app/
      components/
```

This can cause confusion:

```text
crna-scheduler/
  package.json
  next.config.ts
  app/
  apps/
    api/
    worker/
```

The second layout makes the repo root the Next.js project. That is not what we want.

Use the first layout. It keeps the frontend clean while letting the repo also contain FastAPI, worker, infra, and docs.
