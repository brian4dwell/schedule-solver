# Code Review

Reviewed: 2026-04-30

Scope: current FastAPI backend, Next.js frontend, SQLAlchemy models, Alembic migrations, deploy wrapper, and project docs. This review treats the app as an early R&D internal tool for fewer than 20 users, so the focus is on correctness and future scheduling risk rather than enterprise hardening.

## Findings

### Medium: Nullable fields cannot be cleared through PATCH endpoints

The API uses `if request.field is not None` to decide whether a field was provided, so explicit `null` from the client is ignored. This affects nullable center and provider fields.

References:

- `apps/api/app/routers/centers.py:86`
- `apps/api/app/routers/centers.py:89`
- `apps/api/app/routers/centers.py:92`
- `apps/api/app/routers/centers.py:95`
- `apps/api/app/routers/centers.py:98`
- `apps/api/app/routers/centers.py:101`
- `apps/api/app/routers/providers.py:283`
- `apps/api/app/routers/providers.py:286`
- `apps/api/app/routers/providers.py:295`
- `apps/web/lib/api.ts:83`
- `apps/web/lib/api.ts:114`

Impact: once a center address, city, state, postal code, provider email, phone, or notes value is saved, users cannot clear it from the UI even though the frontend sends `null` for empty values. This will create stale scheduling/admin data quickly.

Recommendation: for update schemas, distinguish "field omitted" from "field included as null" using Pydantic field-set semantics, for example `request.model_fields_set` or `request.model_dump(exclude_unset=True)`. Add regression tests that set each nullable field, clear it, and assert the database value is `NULL`.

### Medium: The current organization/auth dependency is only a development shortcut

All API calls resolve to one hard-coded organization, creating it on demand.

References:

- `apps/api/app/dependencies.py:12`
- `apps/api/app/dependencies.py:15`
- `apps/api/app/dependencies.py:23`
- `apps/api/app/dependencies.py:34`

Impact: this is fine for local R&D, but any deployed environment reachable by a browser or script has no user identity, no authorization, and no audit actor. CORS does not protect the API from direct requests.

Recommendation: before real internal use on Fly, either put the deployment behind an access layer or wire the planned Clerk/JWT path. Keep the local organization dependency for development, but make production refuse to boot without an explicit auth mode.

### Medium: Deactivated records still flow through normal read and selection paths

Soft deletes set `is_active = False`, but list and lookup paths generally do not filter to active records, and validation still allows inactive centers to be used.

References:

- `apps/api/app/routers/centers.py:39`
- `apps/api/app/routers/providers.py:66`
- `apps/api/app/routers/providers.py:211`
- `apps/api/app/routers/rooms.py:47`
- `apps/api/app/routers/rooms.py:76`
- `apps/api/app/routers/rooms.py:279`
- `apps/api/app/routers/rooms.py:298`

Impact: an inactive center can still appear in forms, receive rooms, and be assigned as a provider credential. Inactive providers, rooms, and room types also keep appearing in list responses. That may be useful for audit views, but it is risky as the app moves toward solver inputs.

Recommendation: decide which endpoints are operational inputs versus administrative history. Operational endpoints should filter `is_active == True`; history views can opt into inactive records explicitly.

### Medium: Scheduling times are stored as naive datetimes

The timestamp helper uses `datetime.utcnow()`, and schedule domain models use plain `DateTime` for availability, requirements, assignments, and job timestamps.

References:

- `apps/api/app/db/models/scheduling.py:35`
- `apps/api/app/db/models/scheduling.py:41`
- `apps/api/app/db/models/scheduling.py:187`
- `apps/api/app/db/models/scheduling.py:200`
- `apps/api/app/db/models/scheduling.py:226`
- `apps/api/app/db/models/scheduling.py:266`

Impact: this is a latent solver bug. Surgery-center scheduling is local-time heavy, and DST boundaries or multi-time-zone centers will become ambiguous if the database cannot distinguish local wall time from UTC instants.

Recommendation: choose the time model before implementing availability and assignments. A common shape is: store persisted instants as timezone-aware UTC, and store recurring/local scheduling intent as local date, local time, and center timezone.

### Medium: There are no backend regression tests yet

`uv run pytest` runs successfully but collects zero tests.

Impact: the riskiest backend behavior is in CRUD edge cases and relationship replacement. Those are exactly the paths that will become solver prerequisites.

Recommendation: add a small FastAPI test suite before the next backend milestone. Highest-value cases are PATCH null clearing, room type replacement, provider credential replacement, inactive-record behavior, and the assignment credential foreign-key guard.

### Low: Frontend response validation is inconsistent

Provider responses are parsed with Zod, but center, room, and room type responses are trusted through TypeScript annotations after `response.json()`.

References:

- `apps/web/lib/api.ts:17`
- `apps/web/lib/api.ts:31`
- `apps/web/lib/api.ts:43`
- `apps/web/lib/api.ts:66`
- `apps/web/lib/api.ts:131`
- `apps/web/lib/api.ts:168`
- `apps/web/lib/api.ts:173`
- `apps/web/lib/api.ts:232`

Impact: this weakens the repo's stated preference for Zod boundary contracts and means API/frontend drift can show up as odd UI behavior instead of a clear contract failure.

Recommendation: add API response schemas for center, room, and room type in `apps/web/lib/schemas/*`, then parse all API responses consistently.

### Low: Referenced coding standards document is missing

`AGENTS.md` points to `docs/architecture/coding_standards.md`, but that file does not exist in the repo.

Impact: contributors cannot fully follow the stated repo standards, and review decisions may drift.

Recommendation: either add the file or update `AGENTS.md` to point at the current source of truth.

## Healthy Parts

- The project shape is clear: Next.js talks to FastAPI, FastAPI owns persistence, and Alembic owns schema history.
- Zod is already used for frontend form inputs and provider API responses.
- The first scheduling-domain constraints are moving into explicit structures instead of loose key/value data: center credentials, room type skills, room types, and MD-only rooms.
- The deployment wrapper is understandable and keeps the browser API path behind a same-origin `/api` proxy.
- `npm run lint`, `npm run build`, and `uv run python -m compileall app` pass.

## Checks Run

```powershell
Set-Location apps/api
uv run pytest
uv run python -m compileall app

Set-Location ../web
npm run lint
npm run build
```

Results:

- Backend pytest: passed command execution, but collected 0 tests.
- Backend compile: passed.
- Frontend lint: passed.
- Frontend production build: passed.

## Suggested Next Fix Order

1. Fix PATCH null-clearing semantics and add tests for it.
2. Decide the active-record contract before solver inputs depend on these tables.
3. Add a minimal backend test harness around CRUD and relationship replacement.
4. Choose the scheduling time model before implementing availability and assignments.
5. Add Zod response contracts for center, room, and room type responses.
