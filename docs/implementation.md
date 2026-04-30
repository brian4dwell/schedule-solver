# Schedule Solver Implementation Status

Updated: 2026-04-30

## Project Goal

Build an internal CRNA / anesthesia scheduling tool for surgery-center coverage.

The original plan was a Homebase-style scheduling app with:

- Centers and Rooms as the demand locations.
- Providers as the schedulable people.
- Provider availability, provider preferences, credential requirements, and room coverage constraints.
- Schedule generation through an async worker, eventually using OR-Tools.
- Reviewable schedule versions before publishing.

That direction is still right. The implementation has deliberately spent more time strengthening the scheduling domain model before adding the worker and solver.

## Current Architecture

The repo now follows the intended monorepo shape.

```text
apps/web       Next.js App Router frontend
apps/api       FastAPI backend
apps/worker    Placeholder worker directory, not implemented yet
packages/shared Placeholder shared package directory
infra/fly      Fly.io support files
docs           Current plans and implementation notes
```

The backend remains the source of truth. The frontend calls the API and does not write directly to Postgres.

```text
Next.js UI
  -> Zod validation at frontend boundaries
  -> FastAPI API
  -> Pydantic request/response models
  -> SQLAlchemy models
  -> Alembic migrations
  -> Postgres
```

## What Is Implemented

### Backend Foundation

Implemented in `apps/api`:

- FastAPI application setup.
- Health endpoint at `GET /health`.
- SQLAlchemy 2.x database setup.
- Alembic migration setup.
- Pydantic schemas for the active CRUD surface.
- Docker Compose services for Postgres and Redis.
- `uv` managed Python environment.

The current API routers are:

```text
GET    /health

GET    /centers
POST   /centers
GET    /centers/{center_id}
PATCH  /centers/{center_id}
DELETE /centers/{center_id}

GET    /centers/{center_id}/rooms
POST   /centers/{center_id}/rooms
GET    /rooms/{room_id}
PATCH  /rooms/{room_id}
DELETE /rooms/{room_id}

GET    /room-types
POST   /room-types
PATCH  /room-types/{room_type_id}
DELETE /room-types/{room_type_id}

GET    /providers
POST   /providers
GET    /providers/{provider_id}
PATCH  /providers/{provider_id}
DELETE /providers/{provider_id}
```

### Database Backbone

The original scheduling backbone exists as SQLAlchemy models and migrations:

- `organizations`
- `users`
- `centers`
- `rooms`
- `providers`
- `provider_availability`
- `shift_requirements`
- `schedule_periods`
- `schedule_jobs`
- `schedule_versions`
- `assignments`
- `constraint_violations`

Additional implemented scheduling-domain tables:

- `room_types`
- `room_room_types`
- `provider_center_credentials`
- `provider_room_type_skills`

Additional implemented room/provider fields:

- `rooms.md_only`
- Providers expose `credentialed_center_ids`.
- Providers expose `skill_room_type_ids`.

There is also a database-level guard tying an assignment's provider and center to `provider_center_credentials`. That is stricter than the original generic `provider_credentials` table and matches the emerging requirement that center credentialing is a first-class scheduling rule.

### Frontend Foundation

Implemented in `apps/web`:

- Next.js App Router app.
- Tailwind CSS styling.
- Zod schemas for frontend forms and schedule working-copy data.
- App shell with dashboard, sidebar, and top navigation.
- Centers pages and forms.
- Rooms page and forms.
- Room Types page and forms.
- Providers pages and forms.
- Schedule list and schedule workspace pages.

The UI currently uses real API data for:

- Centers
- Rooms
- Room types
- Providers
- Provider center credentials
- Provider room type skills

The schedule workspace currently uses real room data, but schedule periods, schedule versions, publish events, and room placements are still frontend-local working-copy state.

## Original Acceptance Criteria Status

Implemented:

- `apps/web` exists as a Next.js app.
- `apps/api` exists as a FastAPI app.
- `/health` returns the health contract.
- Alembic has an initial schema and follow-up migrations.
- Centers can be created, listed, updated, and deactivated.
- Rooms can be created, listed, updated, and removed or deactivated.
- Providers can be created, listed, updated, and deactivated.
- The frontend has working pages for Centers, Rooms, and Providers.
- The UI consistently uses Provider as the broad scheduling person term.
- The database has no broad `Clinician` entity.

Still incomplete from the original vertical slice:

- Clerk login and JWT verification.
- User and organization authorization beyond the current local organization dependency.
- Provider availability CRUD.
- Shift requirement CRUD.
- Schedule period CRUD.
- Schedule generation job endpoints.
- Redis/RQ worker processing.
- Placeholder draft schedule generation.
- Persisted schedule versions and assignments surfaced in the UI.

## What We Chose To Do Differently

### Local Organization Before Clerk

The original plan called for Clerk from the start. The current backend instead creates or reuses one local organization through `get_current_organization_id`.

This keeps the first CRUD and scheduling-domain work moving without blocking on auth. It should be treated as a temporary development shortcut, not the final authorization model.

### Credential Tables Instead Of Generic Provider Credentials

The original plan suggested a flexible `provider_credentials` table with `credential_type` and `credential_value`.

The current implementation made two concrete credential/skill concepts first-class:

- `provider_center_credentials`
- `provider_room_type_skills`

This is a good divergence. These rules are central to assignment eligibility, easier to validate with foreign keys, and safer than a loosely typed credential-value table for the core scheduling workflow.

### Room Types And MD-Only Rooms Came Earlier

The original first slice did not require room types or MD-only rooms.

The implementation added:

- `room_types`
- many-to-many room-to-room-type assignment
- provider room type skills
- `rooms.md_only`

This moved future solver constraints into the CRUD foundation, which should make the first solver less throwaway.

### Schedule Workspace Before Schedule Persistence

The original plan put schedule periods, jobs, versions, and assignments before a richer scheduling editor.

The current frontend has a local drag-and-drop schedule workspace first. It can place rooms by day, reorder them, and simulate publish events, but it does not persist schedule periods, versions, assignments, or publish history yet.

This was useful for exploring the shape of the scheduling UI, but the next backend milestone needs to catch up so schedule work is durable.

### Room Deletion Is Conditional

The original plan said room delete should soft-delete by setting `is_active = false`.

The current implementation hard-deletes rooms when they have no schedule records and soft-deletes them when schedule records exist. This is reasonable, but it is different from the original simple rule and should stay intentional.

### No Shadcn Yet

The chosen stack named Tailwind CSS plus shadcn/ui. The current UI uses Tailwind directly and does not appear to include shadcn components.

That is acceptable for now. Add shadcn only when the app benefits from shared component behavior rather than because it appeared in the original brief.

## Current Planning Documents

The implementation has evolved into three focused next-step plans:

- `docs/plans/save_schedules.md`
- `docs/plans/provider-assignment.md`
- `docs/plans/solver.md`

These should now be treated as the detailed implementation plans for the next milestones.

## Recommended Next Milestones

### 1. Save Schedules With Versions

Use `docs/plans/save_schedules.md`.

Build the persistence layer for schedule periods, schedule versions, assignments, and publish state.

Immediate backend work:

- Add schedule period schemas and routes.
- Add schedule version schemas and routes.
- Add assignment read contracts.
- Add `POST /schedule-periods/{period_id}/versions`.
- Add publish endpoint.
- Add version metadata fields:
  - `source`
  - `parent_schedule_version_id`
  - `published_at`
  - `published_by_user_id`
  - `created_by_user_id`

Immediate frontend work:

- Replace mock schedule periods on `/schedules`.
- Load a real schedule period in `/schedules/[scheduleId]`.
- Save the current working copy as a new immutable version.
- Publish a saved version through the API.
- Show version history from persisted records.

### 2. Add Provider Assignments To Schedule Slots

Use `docs/plans/provider-assignment.md`.

The schedule workspace currently assigns rooms to days. It needs to become a room-slot and provider-assignment workspace.

Immediate work:

- Add provider selection to each scheduled room slot.
- Add slot start and end times.
- Add frontend Zod contracts for provider-assigned slots.
- Load providers into the schedule workspace.
- Add backend provider eligibility contracts and service.
- Validate center credential, room type skill, MD-only, availability, and double booking in one reusable backend service.

### 3. Add Availability And Shift Requirements CRUD

These were in the original plan and are required before the solver can produce meaningful output.

Immediate work:

- Add provider availability create/list/update/delete API.
- Add provider availability frontend page.
- Add shift requirement create/list/update/delete API.
- Add shift requirement frontend page.
- Connect schedule periods to shift requirements.

### 4. Add Worker And First Solver Slice

Use `docs/plans/solver.md`.

Start with the worker and job lifecycle, then add OR-Tools.

Immediate work:

- Implement `apps/worker`.
- Add schedule generation endpoints:
  - `POST /schedule-periods/{period_id}/generate`
  - `GET /schedule-jobs/{job_id}`
- Add typed solver input/output contracts.
- Build candidate generation from provider eligibility.
- Persist generated assignments as a new draft schedule version.

## Later Work

Keep these out of the immediate milestone unless they become blockers:

- Full Clerk auth and role enforcement.
- Advanced permissions.
- Notifications.
- Calendar sync.
- Payroll.
- Mobile app.
- Multi-tenant billing.
- Complex recurring availability rules.
- Advanced solver preference tuning.

## Current Development Commands

Start local services:

```bash
docker compose up -d postgres redis
```

Run API migrations:

```bash
cd apps/api
uv run alembic upgrade head
```

Run the API:

```bash
cd apps/api
uv run uvicorn app.main:app --reload --port 8000
```

Run the web app:

```bash
cd apps/web
npm run dev
```

Run backend tests when tests exist:

```bash
cd apps/api
uv run pytest
```

Do not invoke bare `pytest` in this repo.
