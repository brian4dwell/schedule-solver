# Schedule Solver Living Document

Updated: 2026-05-02

## Purpose

Schedule Solver is an internal scheduling application for anesthesia coverage across surgery centers.

The product should help schedulers turn room coverage demand, Provider availability, credentials, skills, and preferences into reviewable schedule drafts.

The system should support both manual schedule building and generated schedule drafts. Generated schedules should be explainable, editable, versioned, and never published without review.

This document is the broad project guide. It should describe the product intent, domain language, architecture, implemented features, constraint philosophy, and near-term roadmap. More detailed implementation plans live in `docs/plans`.

## Product Goals

The scheduler should be able to:

- Maintain Centers, Rooms, Room Types, and Providers.
- Track which Providers are credentialed for which Centers.
- Track which Providers can cover which Room Types.
- Track Provider weekly availability for each schedule period.
- Track Provider min/max requested shifts as soft scheduling preferences.
- Build a schedule manually by placing Rooms into dated slots and assigning Providers.
- See why a Provider is or is not eligible for a slot.
- Save schedule drafts without losing invalid or warning-level assignments.
- Review hard blockers and warnings before publishing.
- Generate schedule drafts with a solver and review them before publishing.

The system should not:

- Publish schedules with hard eligibility failures.
- Silently relax credentialing, skill, MD-only, availability, or double-booking rules.
- Treat min/max shift requests as hard publish blockers.
- Hide invalid choices in the UI when showing them helps the scheduler understand the schedule.
- Mutate older schedule versions.

## Users

Primary users are internal schedulers and administrators responsible for surgery-center coverage.

Early workflow assumptions:

- One scheduler may build or edit a schedule period at a time.
- The scheduler needs visibility into invalid assignments rather than only a blocked save button.
- Draft schedules are work-in-progress artifacts.
- Published schedules represent reviewed schedule versions.
- Provider is the broad term for schedulable people. Do not introduce a broad `Clinician` concept.

## Domain Language

Use these terms consistently:

- **Organization**: Tenant boundary for all data.
- **Center**: Surgery center or coverage location.
- **Room**: Physical or logical demand location inside a Center.
- **Room Type**: Skill/category requirement attached to a Room.
- **Provider**: Schedulable person.
- **Provider Center Credential**: Whether a Provider may work at a Center.
- **Provider Room Type Skill**: Whether a Provider can cover a Room Type.
- **Schedule Period**: The schedule window being planned. The current UI treats these as schedule weeks.
- **Schedule Version**: Immutable saved draft or published version for a Schedule Period.
- **Assignment**: Provider coverage for one room slot in one Schedule Version.
- **Constraint Violation**: Persisted explanation for a schedule issue.
- **Hard Constraint**: Must be satisfied before publish.
- **Warning**: Should be visible, but does not block publish.
- **Soft Constraint**: Solver/UI preference that affects schedule quality, not basic eligibility.

## Constraint Philosophy

Hard constraints determine whether a Provider can cover a slot.

Current hard blockers:

- Missing Provider assignment.
- Missing or inactive Room.
- Inactive Provider.
- Provider type mismatch when a slot requires a Provider type.
- Missing Center credential.
- Inactive or out-of-window Center credential.
- Missing required Room Type skill.
- Insufficient Room Type skill level.
- MD-only requirement not met.
- Weekly availability is unset for the slot day.
- Weekly availability is `none` for the slot day.
- Weekly availability does not include the slot shift type.
- Provider is double-booked in the same schedule version.

Warnings and soft constraints should be visible but should not block publish.

Current warning constraints:

- Provider is below `min_shifts_requested`.
- Provider is above `max_shifts_requested`.

Future soft constraints:

- Provider preference misses.
- Assigning a half or short shift to satisfy a full-shift request.
- Avoid-if-possible availability.
- Assignment imbalance.
- Too many consecutive work days.
- Excess center switching.

The UI should distinguish hard blockers from warnings and soft constraints. Hard rows count toward publish blockers. Warning and soft rows do not.

## Availability Model

The first availability-aware scheduling pass uses schedule-week availability, not ad hoc recurring rules.

Provider availability is stored per Provider, Schedule Period, and weekday.

Allowed weekday options:

```text
full_shift
first_half
second_half
short_shift
none
unset
```

Rules:

- `unset` means availability has not been supplied.
- `none` means the Provider is explicitly unavailable that day.
- `unset` and `none` are exclusive choices.
- Work availability options can be combined.
- A slot's `shift_type` must appear in the Provider's weekday options.
- Do not infer availability from missing rows.

Min/max shift requests:

- `min_shifts_requested` and `max_shifts_requested` are schedule-level soft requests.
- Both values are constrained to fit within selected work-available days.
- Below-min and above-max states are schedule warnings.
- Min/max values do not make Providers ineligible.
- Min/max values do not block publish.

Published schedule weeks lock availability edits.

## Architecture

The repo follows a monorepo shape.

```text
apps/web        Next.js App Router frontend
apps/api        FastAPI backend
apps/worker     Placeholder worker directory
packages/shared Placeholder shared package directory
infra/fly       Fly.io support files
docs            Living docs, plans, reviews, and deployment notes
```

The backend is the source of truth.

```text
Next.js UI
  -> Zod validation at frontend boundaries
  -> FastAPI API
  -> Pydantic request/response models
  -> SQLAlchemy models
  -> Alembic migrations
  -> Postgres
```

The frontend must not write directly to Postgres.

Use structured contracts at boundaries:

- Zod for frontend forms and API response parsing.
- Pydantic for backend request/response and service contracts.
- SQLAlchemy models for persistence.
- Alembic migrations for schema evolution.

Python tooling is managed with `uv`. Run Python commands through `uv run`.

## Implemented Backend

Implemented in `apps/api`:

- FastAPI application setup.
- Health endpoint at `GET /health`.
- SQLAlchemy 2.x database setup.
- Alembic migration setup.
- Pydantic schemas for active routes.
- Docker Compose support for Postgres and Redis.
- Local organization dependency through `get_current_organization_id`.
- Schedule period, version, assignment, publish, and generation routes.
- Provider eligibility service with typed contracts.
- In-process solver service skeleton using typed solver contracts.

Current API surface includes:

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

GET    /schedule-periods
POST   /schedule-periods
GET    /schedule-periods/{period_id}
GET    /schedule-periods/{period_id}/versions
POST   /schedule-periods/{period_id}/versions
POST   /schedule-periods/{period_id}/generate

GET    /schedule-versions/{schedule_version_id}
GET    /schedule-versions/{schedule_version_id}/assignments
GET    /schedule-versions/{schedule_version_id}/violations
POST   /schedule-versions/{schedule_version_id}/duplicate
POST   /schedule-versions/{schedule_version_id}/publish
POST   /schedule-versions/draft

POST   /schedule-provider-eligibility

GET    /schedule-weeks/{schedule_week_id}/providers/{provider_id}/availability
PUT    /schedule-weeks/{schedule_week_id}/providers/{provider_id}/availability
DELETE /schedule-weeks/{schedule_week_id}/providers/{provider_id}/availability
```

## Data Model

Core tables:

- `organizations`
- `users`
- `centers`
- `rooms`
- `room_types`
- `room_room_types`
- `providers`
- `provider_center_credentials`
- `provider_room_type_skills`
- `provider_availability`
- `provider_schedule_week_availability`
- `shift_requirements`
- `schedule_periods`
- `schedule_jobs`
- `schedule_versions`
- `assignments`
- `constraint_violations`

Important current fields:

- `rooms.md_only`
- `assignments.provider_id` is nullable so drafts can preserve unassigned slots.
- `assignments.shift_type` stores the requested slot type.
- `provider_schedule_week_availability.availability_options` stores weekday availability as JSON.
- `provider_schedule_week_availability.min_shifts_requested`
- `provider_schedule_week_availability.max_shifts_requested`

The implementation intentionally uses concrete credential and skill tables instead of generic provider credential key/value rows.

## Implemented Frontend

Implemented in `apps/web`:

- Next.js App Router app.
- Tailwind CSS styling.
- Zod schemas for form and API boundaries.
- App shell with dashboard, sidebar, and top navigation.
- Centers pages and forms.
- Rooms pages and forms.
- Room Types pages and forms.
- Providers pages and forms.
- Schedule list page.
- Schedule workspace page.
- Availability page for schedule-week Provider availability.

The UI currently uses real API data for:

- Centers.
- Rooms.
- Room Types.
- Providers.
- Provider Center Credentials.
- Provider Room Type Skills.
- Schedule Periods.
- Schedule Versions.
- Assignments.
- Provider schedule-week availability.

The schedule workspace currently supports:

- Room slots with Provider assignment state.
- Slot `shiftType`, start time, and end time.
- Provider picker with eligible Providers first.
- Ineligible Provider visibility with reason text.
- Backend eligibility verification on Provider selection.
- Draft save through persisted Schedule Versions.
- Publish through the API.
- Header summary for unset Provider availability.
- Toggle to reveal Providers with unset availability.
- `Schedule constraints` table below the calendar.
- Hard publish blocker count based on hard constraint rows.
- Min/max shift request warnings without publish blocking.

## Schedule Constraints Table

The schedule workspace should show a general constraints table directly beneath the calendar.

Recommended columns:

- Severity.
- Scope.
- Subject.
- Constraint.
- Message.

Severity meanings:

- `Hard`: publish blocker.
- `Warning`: visible non-blocking issue.
- `Soft`: future schedule quality or preference issue.

This table is the intended home for:

- Slot hard blockers.
- Provider week min/max warnings.
- Preference warnings.
- Solver soft-constraint explanations.
- Future forced-relaxation explanations.

## Solver Direction

The solver should generate draft schedules, not published schedules.

Current direction:

- Keep the first useful solver in the FastAPI request lifecycle.
- Move to `apps/worker` and RQ only if solve time or operational load requires it.
- Use typed solver input/output contracts.
- Generate a new draft Schedule Version.
- Persist proposed Assignments.
- Persist violations and warnings.
- Let the user review before publishing.

Solver hard constraints should match manual scheduling hard constraints.

Solver soft constraints should eventually include:

- Min/max shift request targets.
- Provider preferences.
- Preference for full-shift matches.
- Penalty when a full-shift request is fulfilled by a half or short shift.
- Assignment balance.
- Avoid-if-possible availability.

Detailed solver notes live in `docs/plans/solver.md`.

## Key Product Decisions

### Backend Is Source Of Truth

The frontend can run local checks for responsiveness, but publish and save validation must rely on backend rules.

### Drafts May Be Invalid

Drafts can keep incomplete, invalid, or warning-level assignments. This preserves scheduler work.

### Publish Must Be Strict

Published versions cannot have hard violations. A future override workflow may exist, but override behavior is not part of the first pass.

### Min/Max Shift Requests Are Soft

Min/max values represent requested workload shape, not eligibility. They should produce warnings and solver scoring pressure, not hard publish blocks.

### Availability Is Hard For Slot Eligibility

Unset availability, explicit `none`, and missing shift-type availability currently make the Provider ineligible for that slot.

### No Broad Clinician Entity

Use Provider as the schedulable-person abstraction.

### Add Shadcn Only When It Helps

The app currently uses Tailwind directly. Add shadcn/ui only when shared component behavior justifies the dependency and migration cost.

## Deliberate Divergences From The Original Plan

### Local Organization Before Clerk

The original plan called for Clerk from the start. The current backend uses a local organization dependency.

This keeps development moving, but it is not the final authorization model.

### Concrete Credential And Skill Tables

The original plan allowed for generic Provider credentials. The current implementation uses concrete Center credential and Room Type skill tables because these are core scheduling rules.

### Room Types And MD-Only Rooms Came Early

Room type skills and MD-only Rooms were implemented earlier than originally planned because they are essential eligibility constraints.

### Schedule Workspace Evolved Alongside Persistence

The frontend workspace originally explored local room placement. It now uses persisted schedule periods, versions, assignments, save, and publish flows.

### Room Deletion Is Conditional

Rooms can be hard-deleted when they have no schedule records and soft-deleted when schedule records exist.

## Current Gaps

High-priority gaps:

- Clerk login and JWT verification.
- Organization and user authorization beyond the local organization dependency.
- Shift Requirement CRUD.
- Preference model and preference UI.
- Persisting all backend warning rows that should appear in the `Schedule constraints` table.
- Refreshing schedule workspace eligibility when availability changes from another page.
- Stronger solver integration with schedule-week availability.
- Worker/RQ execution if solver runtime proves too slow for API requests.

Known architecture gaps:

- Timezone model needs to stay explicit as scheduling gets more complex.
- Recurring availability is intentionally out of the first availability pass.
- Soft constraint weighting needs product calibration.
- Schedule Version conflict handling may need optimistic concurrency once multiple users edit the same period.

## Roadmap

### Near Term

- Finish Shift Requirement CRUD.
- Connect Schedule Periods to Shift Requirements in the UI.
- Persist and display backend warning rows in the schedule constraints table.
- Add Provider preference data model.
- Add preference-driven soft constraint rows.
- Improve availability refresh behavior across pages.

### Solver Milestone

- Use `docs/plans/solver.md`.
- Keep Phase 1 in-process.
- Build candidate generation from backend eligibility rules.
- Generate draft Schedule Versions.
- Persist solver metrics and warnings.
- Explain solver failures clearly.

### Auth And Multi-User Milestone

- Add Clerk login.
- Verify JWTs in FastAPI.
- Replace local organization dependency with real organization/user resolution.
- Add role and permission boundaries.
- Add audit metadata where needed.

### Later Product Areas

- Notifications.
- Calendar sync.
- Payroll.
- Mobile-optimized workflows.
- Multi-tenant billing.
- Advanced recurring availability.
- Advanced solver preference tuning.

## Planning Documents

Current detailed plans:

- `docs/plans/provider-assignment.md`
- `docs/plans/solver.md`

Historical or review documents:

- `docs/reviews/code-review.md`
- `docs/deploy.md`
- `docs/todo.md`

If a plan is completed, update this living document and either archive or remove stale plan references.

## Development Commands

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

Run backend tests:

```bash
cd apps/api
uv run pytest
```

Run frontend checks:

```bash
cd apps/web
npm run lint
npm run build
```

Do not invoke bare `pytest` in this repo.

## Document Maintenance

Update this document when:

- A major domain concept changes.
- A hard constraint becomes soft or a soft constraint becomes hard.
- A new persistence table becomes part of the core workflow.
- A milestone moves from planned to implemented.
- The scheduler workflow changes materially.
- A detailed plan in `docs/plans` becomes stale.

Keep this document broad and accurate. Keep detailed implementation sequencing in focused plan docs.
