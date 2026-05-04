# Coding Standards

Updated: 2026-05-04

## Purpose

These standards describe how this repo is written today and how future changes should stay consistent.

Schedule Solver is an internal scheduling application with a FastAPI backend, a Next.js frontend, and a scheduling domain where correctness matters more than cleverness. Favor explicit data shapes, readable control flow, and boundary validation over compact code.

## Core Principles

- Every line of code should do one thing.
- Use intermediate variables as documentation.
- Prefer concrete typed structures over dictionaries or untyped objects.
- Use dictionaries only when the keys are genuinely unknown, unstable, or boundary metadata.
- Do not add fallback behavior unless the product requirement calls for it.
- Keep the backend as the source of truth for scheduling, eligibility, publishing, persistence, and solver rules.
- Keep drafts reviewable, even when they contain warnings or hard blockers.
- Keep publish paths strict.
- Preserve domain language from `docs/project.md`.

## Repo Shape

Use the existing monorepo boundaries:

```text
apps/api        FastAPI backend, Pydantic contracts, SQLAlchemy models, Alembic migrations, tests
apps/web        Next.js App Router frontend, Zod contracts, Tailwind UI
docs            Living product, architecture, planning, review, and deployment docs
infra           Deployment support
packages        Future shared packages
```

Do not put frontend-only behavior in the API or backend-only rules in the UI. The UI may run local checks for responsiveness, but save and publish correctness belongs in the backend.

## Domain Language

Use the terms from `docs/project.md` consistently:

- Provider, not clinician.
- Center, Room, Room Type, Schedule Period, Schedule Version, Assignment.
- Provider Center Credential and Provider Room Type Skill for scheduling eligibility.
- Constraint Violation for persisted schedule issues.
- Hard Constraint, Warning, and Soft Constraint for schedule quality and publish behavior.

Do not introduce new broad abstractions when concrete domain tables and contracts already exist.

## Python Standards

Python code lives in `apps/api`.

Use Python 3.12 style typing:

```python
provider_id: UUID | None
assignments: list[Assignment]
```

Prefer one import per imported symbol for local modules and common project patterns:

```python
from app.schemas.schedule import ScheduleDraftSaveRequest
from app.schemas.schedule import ScheduleDraftSaveResponse
```

Keep functions small enough that their name explains the step they perform. A route may orchestrate work, but domain decisions should move into helpers or services when they become meaningful.

Use intermediate variables for boolean decisions:

```python
path_matches_body = period_id == request.schedule_period_id

if not path_matches_body:
    raise HTTPException(status_code=400, detail="Path period does not match request period")
```

Prefer explicit loops when they make validation or accumulation clearer. Comprehensions are fine for simple projection and filtering.

Avoid dense chained expressions when they combine several ideas. Split statement construction, parsing, and response construction into named steps.

## Backend Contracts

Use Pydantic models for request, response, and service contracts.

Use `Field(default_factory=list)` for list defaults.

Use `ConfigDict(from_attributes=True)` for read schemas that serialize SQLAlchemy models.

Use `model_fields_set` for PATCH handlers so explicit `null` values clear nullable fields.

Avoid returning dictionaries between internal layers when a Pydantic model can name the shape. Dictionaries are acceptable for unstable metadata such as `ConstraintViolation.metadata_json`.

Keep backend API field names in snake_case. Convert to frontend camelCase only at frontend boundaries when a local UI model benefits from it.

## FastAPI Routes

Routes should:

- Depend on `get_db` for the session.
- Depend on `get_current_organization_id` for the organization boundary.
- Query through SQLAlchemy `select`.
- Scope organization-owned records by `organization_id`.
- Filter active operational records when inactive records should not be selectable.
- Raise `HTTPException` with clear status codes for user-facing request failures.
- Commit once after a coherent write operation.
- Refresh returned SQLAlchemy objects after commit when returning newly changed state.

Use route modules for HTTP orchestration. Put reusable domain checks in helper functions or services.

Use `require_*` or `find_*` helpers when a route needs a scoped record and should return 404 if it is missing.

## SQLAlchemy And Persistence

Use SQLAlchemy 2.x declarative models with `Mapped[...]` and `mapped_column`.

Every organization-owned table should carry `organization_id` unless there is a clear reason it is global.

Use concrete tables for stable business concepts. Prefer tables such as `provider_center_credentials` and `provider_room_type_skills` over generic key/value credential rows.

Prefer soft deletion with `is_active` for operational records that may be referenced by schedules. Hard delete only when existing references make it safe.

Timestamps should use timezone-aware UTC values through the existing helpers.

Persist generated explanations, warnings, and publish blockers as structured records when they are part of scheduler review.

## Alembic Migrations

Every schema change needs an Alembic migration in `apps/api/alembic/versions`.

Use chronological revision ids in the existing style.

Name constraints when they matter for future migrations or domain integrity.

When adding required columns to populated tables, use a safe sequence:

- Add nullable column.
- Backfill existing rows.
- Alter to non-null.
- Add constraints.

Downgrades should undo the upgrade steps when practical.

## Scheduling Rules

Manual scheduling, solver generation, draft save, and publish should share the same hard eligibility rules.

Hard blockers include credentialing, active provider, provider type, room skill, MD-only, availability, and double-booking rules.

Warnings and soft constraints should be visible without becoming publish blockers unless the product decision changes.

Drafts may keep incomplete or invalid assignments. Publishing must reject hard violations.

Do not silently relax constraints. If a future override exists, model it explicitly and persist why it happened.

## Solver Standards

Use typed solver input and output contracts in `apps/api/app/services/scheduling/solver_contracts.py`.

The solver should produce draft schedule versions, not published schedules.

Keep solver explanations reviewable. Infeasible runs should return clear violations and metrics.

Favor deterministic, explainable rules before adding more complex optimization behavior.

## Frontend Standards

Frontend code lives in `apps/web`.

Use Next.js App Router conventions already present in the app.

Use server components for page-level data loading when possible. Use `"use client"` only for interactive components that need client state, browser APIs, or event handlers.

Keep API access in `apps/web/lib/api.ts`.

Keep Zod contracts in `apps/web/lib/schemas`.

Parse API responses with Zod at the frontend boundary. New API response shapes should get Zod schemas before UI code depends on them.

Use TypeScript types inferred from Zod schemas when possible:

```ts
export type SchedulePeriodApi = z.infer<typeof schedulePeriodApiSchema>;
```

Keep API payload field names in snake_case. Use camelCase for local UI state and form values when it improves component clarity.

## React And UI

Use function components and typed props.

Keep page components thin:

- Load data.
- Render `AppShell`.
- Render page-level components.

Keep interactive workflow logic in feature components under `components/<feature>`.

Use small helper functions for formatting, filtering, parsing, and label construction instead of embedding complex expressions in JSX.

Use Tailwind directly. Add shared UI libraries only when repeated behavior justifies the dependency and migration cost.

The current UI style is quiet, dense, and operational:

- Slate base colors.
- Teal for primary actions and selected states.
- Red for hard errors.
- Amber for warnings.
- Emerald for valid/eligible states.
- `rounded-md` borders.
- Tables for scan-heavy operational data.
- Cards only for bounded panels or repeated items.

Do not turn internal workflow pages into marketing pages.

## Validation

Validate at boundaries:

- Zod for frontend forms, browser-facing data, and API responses.
- Pydantic for backend requests, responses, and service contracts.
- Database constraints for persistence integrity.
- Domain services for scheduling rules that require data lookups or cross-record checks.

Keep frontend validation aligned with backend validation, but do not rely on frontend validation for backend correctness.

## Error Handling

Fail clearly when required data is missing or invalid.

Use explicit status codes:

- 400 for invalid request shape or mismatched route/body intent.
- 404 for scoped records that do not exist.
- 409 for state conflicts such as publishing with hard violations or editing locked availability.

Do not hide unexpected boundary drift. Let Zod or Pydantic raise clear errors instead of coercing unknown shapes into fallback behavior.

## Tests

Backend tests live in `apps/api/tests`.

Run backend tests through uv:

```powershell
cd apps/api
uv run pytest
```

Do not invoke bare `pytest`.

Use focused tests for:

- Domain rules.
- Route registration and route behavior.
- Pydantic validation.
- PATCH null-clearing behavior.
- Solver feasibility and violation behavior.
- Fairness accounting.

Prefer tests that name the behavior being protected:

```python
def test_unassigned_provider_violation_blocks_publish() -> None:
```

Frontend checks:

```powershell
cd apps/web
npm run lint
npm run build
```

Run targeted checks after narrow changes and broader checks after shared contract, solver, persistence, or UI workflow changes.

## Tooling

Python tooling is managed with `uv`.

Use:

```powershell
uv run pytest
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

Frontend tooling is managed with npm in `apps/web`.

Use:

```powershell
npm run lint
npm run build
npm run dev
```

## Documentation

Update `docs/project.md` when product intent, core domain language, major constraints, implemented architecture, or roadmap reality changes.

Use `docs/plans` for detailed implementation plans.

Use `docs/reviews` for reviews and follow-up findings.

Keep docs aligned with implemented behavior. If a doc describes an intended future behavior, label it as future or planned.

## Change Discipline

Keep changes scoped to the request.

Respect existing dirty work in the tree. Do not revert unrelated edits.

When adding a feature, carry the change through each affected layer:

- Persistence model and migration.
- Backend schema.
- Route or service behavior.
- Tests.
- Frontend Zod schema.
- API client.
- UI.
- Documentation when the domain or workflow changes.

When changing a shared contract, update both the backend Pydantic contract and the frontend Zod contract in the same change.
