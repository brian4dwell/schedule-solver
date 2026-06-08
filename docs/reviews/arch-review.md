# Architecture Review

Date: 2026-06-06

Scope: broad architecture review of the current Schedule Solver repo, focused on backend/frontend boundaries, scheduling domain ownership, Provider Portal flow, availability contracts, and near-term maintainability against `docs/architecture/coding_standards.md`.

## Findings

### High: Half-shift request units are persisted but not the scheduling source of truth

`ProviderScheduleWeekAvailability` now stores both legacy integer shift counts and half-shift unit counts (`min_shifts_requested`, `max_shifts_requested`, `min_shifts_requested_units`, `max_shifts_requested_units`) in [apps/api/app/db/models/scheduling.py](../../apps/api/app/db/models/scheduling.py:245). The availability APIs correctly accept floats, normalize to half-shift units, and return `units / 2` in [apps/api/app/routers/provider_availability.py](../../apps/api/app/routers/provider_availability.py:90) and [apps/api/app/routers/provider_portal.py](../../apps/api/app/routers/provider_portal.py:592).

But downstream scheduling logic still reads the legacy integer fields:

- Solver input builder copies `first_row.min_shifts_requested` and `first_row.max_shifts_requested` in [apps/api/app/services/scheduling/solver_input_builder.py](../../apps/api/app/services/scheduling/solver_input_builder.py:204).
- Solver contracts type these values as `int` in [apps/api/app/services/scheduling/solver_contracts.py](../../apps/api/app/services/scheduling/solver_contracts.py:13).
- Publish warnings compare assignment count to integer fields in [apps/api/app/routers/schedules.py](../../apps/api/app/routers/schedules.py:779).
- Eligibility warning logic checks `weekly_availability.max_shifts_requested` in [apps/api/app/services/scheduling/provider_eligibility.py](../../apps/api/app/services/scheduling/provider_eligibility.py:281).
- Fairness scoring reads integer fields in [apps/api/app/services/scheduling/fairness.py](../../apps/api/app/services/scheduling/fairness.py:385).

Impact: a Provider can submit `3.5` requested shifts and see `3.5` echoed by the API/UI, but solver scoring, publish warnings, eligibility warnings, and fairness debt can treat it as `3` because writes currently store `minimum_units // 2` and `maximum_units // 2`. This is a cross-layer contract drift in a scheduling rule, so it can produce schedules and fairness events that do not match the Provider-visible request.

Recommended direction: make half-shift units the internal source of truth for scheduling calculations, or remove the unit columns and disallow fractional requests. If fractional requests remain, update solver contracts and fairness/eligibility/publish warning services to compare in units instead of legacy whole-shift fields. Keep the API field names Provider-friendly, but use explicit unit helpers at service boundaries.

### Medium: Scheduling route modules are carrying too much domain workflow

The route modules have grown into application services. Current sizes:

- `apps/api/app/routers/schedules.py`: 1,392 lines.
- `apps/api/app/routers/provider_portal.py`: 694 lines.
- `apps/api/app/routers/reports.py`: 738 lines.

This is more than style drift. `schedules.py` contains weekly availability cloning in [apps/api/app/routers/schedules.py](../../apps/api/app/routers/schedules.py:637), shift-request warning generation in [apps/api/app/routers/schedules.py](../../apps/api/app/routers/schedules.py:690), draft save orchestration in [apps/api/app/routers/schedules.py](../../apps/api/app/routers/schedules.py:857), and publish state transitions/fairness rebuilds in [apps/api/app/routers/schedules.py](../../apps/api/app/routers/schedules.py:1315). `provider_portal.py` similarly owns invite acceptance, preferences replacement, and weekly availability replacement in one router file, with persistence decisions embedded around [apps/api/app/routers/provider_portal.py](../../apps/api/app/routers/provider_portal.py:403) and [apps/api/app/routers/provider_portal.py](../../apps/api/app/routers/provider_portal.py:489).

Impact: route-level code now owns rules that also matter to the solver, publish path, reports, Provider Portal, and admin UI. That makes it harder to keep the backend as a single scheduling source of truth because new workflows can accidentally call one route helper while another path uses a slightly different helper.

Recommended direction: keep routers as HTTP orchestration and move cohesive services behind them:

- `availability_service.py`: read/build/replace weekly availability, default day behavior, lock checks, half-shift request normalization.
- `schedule_version_service.py`: duplicate/save/publish schedule versions and their state transitions.
- `shift_request_warning_service.py`: create min/max warning rows using the same unit model as solver/fairness.
- `provider_portal_service.py`: accept invites, resolve profile state, and expose current-provider operations.

### Medium: Provider Portal navigation state is split across server props and client-local records

The Provider Portal page passes the initial `availabilityRecords` into both the top-bar navigation and the workspace in [apps/web/app/provider-portal/page.tsx](../../apps/web/app/provider-portal/page.tsx:137). The workspace then stores its own mutable copy with `useState(availabilityRecords)` in [apps/web/components/providers/provider-portal-workspace.tsx](../../apps/web/components/providers/provider-portal-workspace.tsx:52) and updates that local copy after saves in [apps/web/components/providers/provider-portal-workspace.tsx](../../apps/web/components/providers/provider-portal-workspace.tsx:278) and [apps/web/components/providers/provider-portal-workspace.tsx](../../apps/web/components/providers/provider-portal-workspace.tsx:307).

The top-bar week selector, however, still renders from its original `records` prop in [apps/web/components/providers/provider-portal-top-bar-navigation.tsx](../../apps/web/components/providers/provider-portal-top-bar-navigation.tsx:38), and computes the selected week from that separate record list in [apps/web/components/providers/provider-portal-top-bar-navigation.tsx](../../apps/web/components/providers/provider-portal-top-bar-navigation.tsx:47).

Impact: Provider Portal state can diverge after a save. The workspace may show updated completion/count state while the top-bar week selector still reflects the server-loaded snapshot until navigation or refresh. This is a small UI issue today, but architecturally it is the start of two competing owners for the same Provider Portal session state.

Recommended direction: introduce a single client Provider Portal shell that owns records, selected week/view, and mutations, and renders both the top-bar controls and workspace content. If keeping top-bar content in `AppShell`, pass a client component that receives state from the same owner rather than separate server props. Alternatively, use URL + server refresh after mutations consistently.

### Medium: Invalid Provider Portal query params crash instead of resolving to a stable route state

`providerPortalSectionFromViewValue` throws for any unrecognized `view` query value in [apps/web/components/providers/provider-portal-utils.ts](../../apps/web/components/providers/provider-portal-utils.ts:34). Both the top-bar navigation and workspace call that helper from user-controlled search params in [apps/web/components/providers/provider-portal-top-bar-navigation.tsx](../../apps/web/components/providers/provider-portal-top-bar-navigation.tsx:44) and [apps/web/components/providers/provider-portal-workspace.tsx](../../apps/web/components/providers/provider-portal-workspace.tsx:48).

Impact: `/provider-portal?view=foo` becomes a runtime page error. The repo standard says not to add fallback behavior unless asked, but this is a URL boundary rather than hidden domain fallback. A public route should either reject the request intentionally with a controlled not-found/bad-request UI, or normalize to a documented default with a clear contract.

Recommended direction: parse the query with a small Zod contract near the route/view boundary. For invalid values, prefer `notFound()` or a controlled redirect to `/provider-portal?view=week`. Do not let a shared utility throw into rendering for ordinary malformed URLs.

### Medium: Organization resolution is still local/default despite Clerk org claims being parsed

`AuthenticatedUser` carries `organization_external_id` from Clerk claims in [apps/api/app/core/auth.py](../../apps/api/app/core/auth.py:120), but `get_current_organization_id` ignores the user and always resolves `LOCAL_ORGANIZATION_ID` through `get_default_organization` in [apps/api/app/dependencies.py](../../apps/api/app/dependencies.py:84). This is already documented as a known gap in `docs/project.md`, but it is now a central architecture risk because Provider Portal identity links, admin routes, schedules, reports, and preferences all depend on `organization_id` as their tenant boundary.

Impact: the code is shaped as multi-tenant, but the runtime boundary is single-tenant. If a second organization is introduced before this is resolved, the data model will look isolated while API dependencies still route users into the same local organization.

Recommended direction: prioritize an `OrganizationIdentityLink` or equivalent mapping from Clerk org/user claims to local organizations, then make `get_current_organization_id` resolve through that mapping. Keep local organization creation as development-only behavior.

### Low: Availability editing logic is duplicated across admin and Provider Portal views

The admin availability editor owns option toggling, exclusive option behavior, and shift request normalization around [apps/web/components/providers/provider-availability-editor.tsx](../../apps/web/components/providers/provider-availability-editor.tsx:287). The Provider Portal workspace implements very similar day and shift-request mutation logic in [apps/web/components/providers/provider-portal-workspace.tsx](../../apps/web/components/providers/provider-portal-workspace.tsx:90) and [apps/web/components/providers/provider-portal-workspace.tsx](../../apps/web/components/providers/provider-portal-workspace.tsx:172).

Impact: the admin and Provider experiences can drift in subtle ways, especially around `unset`, `none`, half-shift requests, and clamp behavior. This has already required visual parity work, and behavioral parity is more important than visual parity.

Recommended direction: extract a frontend availability draft helper with typed functions such as `toggleAvailabilityOption`, `normalizeShiftRequests`, and `replaceShiftRequest`. Keep it UI-framework-friendly, but make both admin and Provider Portal editors call the same logic. The backend should still remain authoritative.

## Strengths

- The core repo boundaries are healthy: `apps/api` owns FastAPI/Pydantic/SQLAlchemy, `apps/web` owns Next.js/Zod/Tailwind, and API access is centralized in [apps/web/lib/api.ts](../../apps/web/lib/api.ts:491).
- Frontend API responses are consistently parsed with Zod at the boundary, which is exactly the right direction for this app.
- The backend has meaningful domain services for eligibility, solver contracts, solver input/persistence, and fairness. The pieces that already live in `apps/api/app/services/scheduling` are a good model for extracting remaining router logic.
- Draft schedule invalidity and strict publish validation are represented in the data model and API shape, which matches the product philosophy.
- Provider Portal access uses an explicit `ProviderIdentityLink` via `require_current_provider`, which is a good domain concept even though organization mapping still needs to mature.

## Recommended Sequence

1. Fix the half-shift unit drift first. It affects solver behavior, publish warnings, fairness, and Provider-visible trust.
2. Extract weekly availability service logic from admin and Provider Portal routers. Use that service as the single backend owner for read/replace/default/lock behavior.
3. Extract schedule version publish/save logic from `schedules.py` into a service. Keep route functions thin.
4. Rework Provider Portal state ownership so top-bar navigation and workspace read from the same client state or from refreshed server state.
5. Add a small URL-state contract for Provider Portal `view` and `weekId`.
6. Resolve Clerk organization mapping before any multi-organization usage.
7. Share frontend availability draft mutation helpers across admin and Provider Portal views.

## Test Gaps To Add While Fixing

- A backend test proving `3.5` min/max shift requests produce correct solver input, publish warnings, and fairness events.
- Provider Portal URL tests for invalid `view` values and invalid `weekId` values.
- Frontend unit coverage for shared availability option toggling once extracted.
- Service-level tests around schedule publish state transitions once moved out of the router.
