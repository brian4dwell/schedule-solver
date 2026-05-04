# Code Review

Reviewed: 2026-05-04

Scope: current FastAPI backend, scheduling solver and fairness services, SQLAlchemy models, Alembic migrations, Next.js frontend, and project docs. This review treats the app as an early R&D internal tool for fewer than 20 users, so the focus is on scheduling correctness, data integrity, and the path to safe internal deployment.

## Findings

### Medium: Non-local auth modes still resolve to the hard-coded local organization

The dependency now blocks `auth_mode = "local"` outside development, which is a good step. However, any other `auth_mode` value passes the guard and still calls `get_default_organization`, so a production deployment with `AUTH_MODE=clerk` or `AUTH_MODE=jwt` would look configured while remaining unauthenticated and single-tenant.

References:

- `apps/api/app/core/config.py:16`
- `apps/api/app/core/config.py:46`
- `apps/api/app/dependencies.py:12`
- `apps/api/app/dependencies.py:34`
- `apps/api/app/dependencies.py:36`
- `apps/api/app/dependencies.py:41`

Impact: a Fly deployment can accidentally expose real schedule data behind a fake auth mode. CORS does not protect direct API access, and all requests would still share the same organization id.

Recommendation: make `auth_mode` an explicit enum. Keep `local` for development only, and make unsupported or unimplemented non-local modes fail during startup or dependency resolution before returning any organization id.

### Medium: Publishing replacement versions can double-count fairness history for the same schedule period

Fairness records are generated when a draft is saved or generated, then generated again on publish. Publishing applies the selected version's snapshot directly into `provider_fairness_states`. If one version for a period has already been published and another version of the same period is later published, the second version's snapshot may start from state that already includes the first version's impact, then applies another full period's impact.

References:

- `apps/api/app/services/scheduling/fairness.py:451`
- `apps/api/app/services/scheduling/fairness.py:510`
- `apps/api/app/services/scheduling/fairness.py:563`
- `apps/api/app/services/scheduling/solver_persistence.py:145`
- `apps/api/app/routers/schedules.py:478`
- `apps/api/app/routers/schedules.py:825`
- `apps/api/app/routers/schedules.py:831`

Impact: superseding a published schedule can inflate debt and favor credit, which then feeds the solver objective for future periods. This can make fairness pressure drift away from actual practitioner burden.

Recommendation: define period-replacement accounting before relying on fairness state. A safe shape is to apply published state from the latest accepted version per period only, or rebase the new version from the last applied schedule version outside the period. Add a regression test that publishes v1, publishes v2 for the same period, and asserts the durable provider state reflects only v2 for that period.

### Medium: Draft assignments are persisted before validating the slot as a coherent operational record

Manual draft saving maps request payloads directly into `Assignment` rows. Assigned-provider rows run eligibility checks, but unassigned rows skip validation entirely, and the eligibility loader only proves the room belongs to the organization. It does not prove the room is active or belongs to the submitted center.

References:

- `apps/api/app/routers/schedules.py:359`
- `apps/api/app/routers/schedules.py:400`
- `apps/api/app/routers/schedules.py:463`
- `apps/api/app/services/scheduling/provider_eligibility.py:257`
- `apps/api/app/services/scheduling/provider_eligibility.py:274`
- `apps/api/app/services/scheduling/provider_eligibility.py:286`

Impact: a draft can contain a center/room mismatch, an inactive room, or an unassigned slot with invalid operational references. Those records then flow into duplicate, publish, fairness, and solver workflows.

Recommendation: add a schedule-assignment validation step before persistence. Validate active center, active room, room-center match, optional active provider, date range, and period containment. Return 400-level errors instead of relying on database constraints or later publish-time checks.

### Medium: The documented backend test command fails without an import-path override

The repo instructions say to run `uv run pytest`, but that command currently fails during collection because some tests import `app.*` before the package path is configured. Running with `PYTHONPATH=.` passes, which points to harness configuration rather than failing behavior.

References:

- `apps/api/tests/test_fairness.py:5`
- `apps/api/tests/test_schedule_routes.py:9`
- `apps/api/tests/test_provider_weekly_availability_schema.py:7`
- `apps/api/tests/test_provider_eligibility.py:9`
- `apps/api/tests/test_patch_nullable_fields.py:4`

Impact: contributors and CI will see a red backend test command even though the suite passes with the right import path. That weakens confidence in future solver and fairness changes.

Recommendation: configure the import path once in `apps/api/pyproject.toml` or a shared `conftest.py`, then remove per-test `sys.path` edits. Keep `uv run pytest` as the single supported command.

### Low: Frontend response validation is still inconsistent for center and room data

Provider, schedule, availability, and fairness responses are parsed with Zod contracts, but centers, rooms, and room types are still trusted through TypeScript annotations after `response.json()`.

References:

- `apps/web/lib/api.ts:47`
- `apps/web/lib/api.ts:61`
- `apps/web/lib/api.ts:73`
- `apps/web/lib/api.ts:215`
- `apps/web/lib/api.ts:252`
- `apps/web/lib/api.ts:257`
- `apps/web/lib/api.ts:323`
- `apps/web/lib/api.ts:545`

Impact: API/frontend drift in center or room contracts can become odd UI behavior instead of a clear boundary failure.

Recommendation: add center, room, and room type API schemas in `apps/web/lib/schemas/*`, then parse those responses the same way provider, schedule, availability, and fairness responses are parsed.

### Low: Referenced coding standards document is missing

`AGENTS.md` points to `docs/architecture/coding_standards.md`, but that file does not exist in the repo.

References:

- `AGENTS.md:5`

Impact: contributors cannot fully follow the stated repo standards, and review decisions may drift.

Recommendation: either add the document or update `AGENTS.md` to point at the current source of truth.

## Healthy Parts

- PATCH null-clearing semantics have been fixed for centers and providers, with regression coverage.
- Active-record filtering is now applied to the main center, provider, room, and room-type operational endpoints.
- The solver has focused unit coverage for credential checks, availability, overlap rejection, locked assignments, infeasible schedules, shift request warnings, and fairness pressure.
- Fairness has moved from plan-only design into persisted contracts, reports, snapshots, events, and solver input.
- The frontend now validates the newer schedule, provider, weekly availability, and fairness API boundaries with Zod.
- `npm run lint`, `npm run build`, `uv run python -m compileall app`, and `PYTHONPATH=. uv run pytest` pass.

## Checks Run

```powershell
Set-Location apps/api
uv run pytest
$env:PYTHONPATH='.'; uv run pytest
uv run python -m compileall app

Set-Location ../web
npm run lint
npm run build
```

Results:

- Backend pytest: `uv run pytest` failed during collection with `ModuleNotFoundError: No module named 'app'`.
- Backend pytest with `PYTHONPATH=.`: passed, 47 tests.
- Backend compile: passed.
- Frontend lint: passed.
- Frontend production build: passed.

## Suggested Next Fix Order

1. Make auth mode explicit so non-local production settings cannot silently use the local organization shortcut.
2. Fix the backend test harness so `uv run pytest` is green without environment overrides.
3. Define fairness replacement accounting before publishing multiple versions of the same period.
4. Validate schedule draft assignments before persistence.
5. Add Zod response contracts for center, room, and room type responses.
