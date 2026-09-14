**Deep code review — September 13, 2026**

Reviewed the repository state ending at `a4de67b` (`upgraded packages`), including the edits present when the review started. This is a repository review, not just a review of that dependency upgrade. There are **19 actionable findings: 10 P1 and 9 P2**. P1 means a correctness, access, or data integrity issue to prioritize; P2 means a material defect with a narrower trigger or impact. These are not all newly introduced bugs.

The most urgent problems are schedule time corruption, availability being saved against the wrong provider, publication of a different version than the visible board, missing publish validation, and fairness state that does not reflect the newly published version. Passing existing checks does not cover these workflows.

Follow-up: findings **2, 3, and 4** are fixed in the working tree. The availability editor isolates state by provider/week and guards writes by record identity. Publication requires the current board and notes to match the saved draft, waits for pending schedule operations, and blocks only hard constraints. Regression coverage lives in `apps/web/tests/availability-editor.test.mjs` and `apps/web/tests/schedule-publication.test.mjs`; run `npm run test:workflows` from `apps/web`. The findings and line references below preserve the original review snapshot.

Second follow-up: findings **5–10** are fixed in the working tree. Shared eligibility now checks center/room status and ownership, including solver candidates. Publication rejects empty schedules and unresolved schedule-level hard violations, and flushes publication status changes before rebuilding fairness. Invites rotate on reset, expire after seven days, require a matching verified Clerk email, and serialize reset/acceptance on the invitation row. Active organization sessions must match the local Organization's Clerk binding. Token normalization supports version-2 organization claims and singular public-metadata roles, rejecting conflicting organization claims. Regression coverage includes `test_publish_integrity.py`, `test_invite_security.py`, and `test_auth_dependencies.py`. Migration `202609130001` must run before this code; it expires outstanding legacy invitation links. PostgreSQL migration SQL was checked; concurrency behavior was not exercised against a live PostgreSQL server.

Third follow-up (September 14): findings **11–19** are fixed in the working tree. Period deletion rebuilds remaining fairness and clears empty-history state; monthly reports retain unversioned weeks; template references trigger room deactivation. The wall-clock work already in progress provides period-bound checks and shared manual/solver same-day rules. Provider picking separates working-board conflicts from backend eligibility, and incompatible board operations are serialized. Assignment round trips preserve roomless slots and metadata, while linked requirements supply authoritative provider types. Saved backend assignment and schedule violations now appear in the table and blocker count, including preserved best-effort slots; edits mark validation pending until the next save. Regression coverage is in `test_review_integrity.py`, `test_schedule_times.py`, `schedule-publication.test.mjs`, and `schedule-times.test.mjs`. Backend verification: **229 passed, 7 skipped**; the skipped PostgreSQL checks require an explicitly configured isolated test server. No deployment or migration was performed for this follow-up.

Deployment follow-up (September 14, 19:27 UTC): deployed the review fixes to `bespoke-web`, Fly release **135**, image `deployment-01M2GP4BVSB2CS3E6TH8TH6830`. The deployed database was already at Alembic head `202609130002`; startup successfully ran `alembic upgrade head` with no additional schema changes. The remote production build, Fly smoke/machine checks, and public `/health` and `/api/health` checks passed; both endpoints returned HTTP 200 with `{"status":"ok"}`.

**1. [P1] Loading and saving a schedule changes its wall-clock times.**

Location: [schedule-workspace.tsx:245](../../apps/web/components/schedules/schedule-workspace.tsx#L245), [initial migration:183](../../apps/api/alembic/versions/202604290001_initial_schema.py#L183).

The migration creates assignment timestamps without a timezone, while the ORM declares timezone-aware fields. `timeLabelFromDateTime()` parses a timezone-less API timestamp with `new Date()`, then extracts UTC hours. In an America/New_York runtime, the actual helper turns `2026-09-14T07:00:00` into `11:00`; `dateTimeForAssignment()` sends back `2026-09-14T11:00:00.000Z`. A save can therefore permanently change shift times without a time edit. Repeated round trips can drift again and eventually make the same-day range invalid. The checked-in migrations do not correct this mismatch. The issue is already described in `docs/time-issues.md` and remains present.

Preserve the documented wall-clock contract through storage, API, and UI. Add a migration consistent with that decision and round-trip checks across timezone and daylight-saving boundaries. Do not fix display alone while leaving save conversion inconsistent. Reproduced using the actual frontend helper functions; production database column types were not inspected.

**2. [P1] Switching providers can save the previous provider's availability onto the new provider.**

Location: [provider-availability-editor.tsx:206](../../apps/web/components/providers/provider-availability-editor.tsx#L206), [save:420](../../apps/web/components/providers/provider-availability-editor.tsx#L420), [button:614](../../apps/web/components/providers/provider-availability-editor.tsx#L614).

Changing the selection updates `providerId` or `scheduleWeekId` immediately, but retains the previous `record` during the new request. Save ignores `isLoading` and uses the new selection IDs with the old record. The API client sends only the availability fields, so the backend has no record identity to reject. With B's load deliberately pending, the actual component's Save button remained enabled and its handler sent provider A's record to provider B. The equivalent race exists when changing weeks. An older save response can also replace the currently selected record.

Clear or separate records by their provider/week identity, require the record identity to match the selected identity before saving, and invalidate stale read/write completions. Disable dependent operations while the selection is unresolved.

**3. [P1] “Publish changes” publishes the saved board while validating the unsaved board.**

Location: [schedule-workspace.tsx:1966](../../apps/web/components/schedules/schedule-workspace.tsx#L1966), [publish call:2012](../../apps/web/components/schedules/schedule-workspace.tsx#L2012), [button eligibility:2789](../../apps/web/components/schedules/schedule-workspace.tsx#L2789).

After saving a valid draft, change its provider or room without saving. Publication validates `workingVersion`, then sends `savedVersionDetail.version.id`. `canPublish` does not require `scheduleDraftIsSaved`, even though that comparison already exists. A success toast therefore appears while the database publishes the earlier assignments. The visible changes remain unsaved. Reproduced by executing the actual publication handler with distinct working and saved states.

Make publication target the exact reviewed snapshot: require an unchanged saved draft, or save the current snapshot and publish the returned version. Guard this condition in the handler as well as the button.

**4. [P1] Warning-only schedules are blocked from publication by the frontend.**

Location: [schedule-workspace.tsx:1982](../../apps/web/components/schedules/schedule-workspace.tsx#L1982), [validation status:1089](../../apps/web/components/schedules/schedule-workspace.tsx#L1089).

`validationStatusForSelection()` returns `warning` for an eligible provider accommodating a shorter shift. The publication handler rejects every status other than `valid`. Thus a provider offering full-day availability and covering a half-day slot produces zero hard blockers, enables the publish button, and then gets “Resolve publish blockers.” This contradicts the backend's warning semantics and the documented scheduling rules. Executing the handler with an eligible, warning-only option confirmed that no publish request is made.

Use provider presence and hard eligibility violations to decide publication. Keep accommodation warnings visible without treating them as blockers.

**5. [P1] Publish validation accepts inactive rooms and mismatched room/center pairs.**

Location: [provider_eligibility.py:317](../../apps/api/app/services/scheduling/provider_eligibility.py#L317), [credential lookup:334](../../apps/api/app/services/scheduling/provider_eligibility.py#L334), [context:473](../../apps/api/app/services/scheduling/provider_eligibility.py#L473).

The shared checker loads a room without checking its active status, does not load/check the center's active status, and does not require `room.center_id == request.center_id`. Credentials are checked against the caller-supplied center. Reproductions successfully published both an inactive room and a room belonging to center B while the assignment claimed center A, where the provider alone held a credential. The solver rejects inactive rooms, so manual publication and generation already disagree. A saved draft can also outlive a room or center deactivation.

Validate the scoped room/center relationship and operational status in a shared structural eligibility step. Preserve invalid drafts with structured violations, but enforce these checks at publication and generation.

**6. [P1] Failed solver versions with hard blockers can be published.**

Location: [schedules.py:1529](../../apps/api/app/routers/schedules.py#L1529), [infeasible result:1567](../../apps/api/app/services/scheduling/solver.py#L1567), [solver persistence](../../apps/api/app/services/scheduling/solver_persistence.py).

An infeasible solve persists a draft with `assignments=[]` and hard violations, then the strict generation route returns 409. Publication checks only existing assignments; it does not examine schedule-level solver failures or validate required coverage. For that empty version, the loop produces no violations and publication succeeds. The reproduction generated a 409 with `missing_shift_requirements` and `infeasible_solver_model`, then published the persisted version successfully. Empty versions are reachable through the API even though the normal UI disables publication of an empty board.

Revalidate schedule-level feasibility/coverage as part of publication. Preserve explainable failed drafts, but do not equate “no assignment violations” with a publishable schedule. Distinguish stale assignment-level violations from unresolved schedule-level blockers.

**7. [P1] The first publication omits the new schedule from fairness accounting.**

Location: [schedules.py:1586](../../apps/api/app/routers/schedules.py#L1586), [session configuration:12](../../apps/api/app/db/session.py#L12), [published version query:841](../../apps/api/app/services/scheduling/fairness.py#L841).

The session has `autoflush=False`. Publication changes version statuses in memory and calls `rebuild_published_fairness_state()` before flushing. Its SQL query therefore sees the previous published set. On the first publish, no provider fairness state was created; publishing the same version a second time produced the expected 1.5 debt in the reproduction. On replacement, the query can select the superseded version instead of the newly published draft. The next solve consequently uses missing or outdated fairness inputs.

Flush status transitions before selecting the published set, within the same coherent transaction. Test first publication, replacement, and idempotent repeat publication against a real SQLAlchemy session configured like the application.

**8. [P1] Resetting an invite does not revoke access held by the previous recipient.**

Location: [provider_portal_service.py:118](../../apps/api/app/services/provider_portal_service.py#L118), [reset:140](../../apps/api/app/services/provider_portal_service.py#L140), [acceptance:164](../../apps/api/app/services/provider_portal_service.py#L164).

The reset branch changes the email and acceptance fields but keeps `invite_token`. Acceptance checks neither expiration nor invited status and does not bind the account to the invited verified email. Reproduced: create an invite for one address, reset it to another address, then use the original token with a different account; that account successfully claims the provider. The identity-link conflict check protects an already-linked active provider, but does not revoke an outstanding link when its intended recipient changes. This confirms an unresolved earlier security-review concern.

Rotate and revoke tokens on reset, enforce expiry and consumption atomically, and verify the intended identity if invitations are meant for a specific email. Store a digest instead of the reusable raw secret where possible.

**9. [P1] Organization-scoped admin roles grant access to the fixed local organization.**

Location: [dependencies.py:84](../../apps/api/app/dependencies.py#L84), [admin role check](../../apps/api/app/core/auth.py#L131).

`get_current_organization_id()` ignores the authenticated organization and always returns `LOCAL_ORGANIZATION_ID`. A verified session accepted as an organization admin is never checked against the local organization's Clerk mapping. Passing an unmapped organization's admin through the actual authorization and organization dependencies returned the local tenant. Exploitability requires such a user to obtain an accepted admin claim in the configured Clerk instance; this review did not inspect its organization-creation settings. This is a known single-organization implementation gap, not a new dependency-upgrade regression.

Either bind the local deployment to its explicitly configured Clerk organization or resolve a verified organization through `Organization.clerk_org_id`. Reject unknown organizations before accessing operational records. An org-scoped role must not become an application-global grant.

**10. [P1] The backend drops current Clerk organization-admin claims.**

Location: [auth.py:46](../../apps/api/app/core/auth.py#L46), [user conversion:113](../../apps/api/app/core/auth.py#L113), [frontend role recognition](../../apps/web/lib/auth.ts).

The backend reads legacy `org_id`/`org_role` fields and ignores unknown claims. Clerk's current version-2 token stores organization identity and role in `o.id` and `o.rol`; the latter omits the `org:` prefix. A version-2 admin token without a separate custom application role therefore becomes a non-admin and receives 403 from operational APIs, while Clerk's frontend SDK recognizes the user as an admin. Validating the documented claim shape reproduced this loss. See [Clerk's session-token contract](https://clerk.com/docs/guides/sessions/session-tokens).

There is another mismatch in the same normalization boundary: `public_metadata.role = "admin"` is accepted by the frontend but ignored by `authenticated_user_from_claims()`, which only merges `public_metadata.roles`. This was also reproduced. Normalize supported verified claims through an explicit contract and test the same role representations across both layers; do not solve the mismatch by broadening authorization indiscriminately.

**11. [P2] Deleting a published period leaves its fairness debt in the solver's state.**

Location: [schedules.py:1281](../../apps/api/app/routers/schedules.py#L1281), [link clearing:362](../../apps/api/app/routers/schedules.py#L362).

Deletion removes fairness events/snapshots and clears their state references, but never recalculates the numerical ledger. After deleting the only published period, the reproduction retained exactly the same 1.5 fairness debt despite there being no published schedule left. Solver input loads that stale value. Merely calling the current rebuild is insufficient for the empty-history case because an empty list of ledger states does not reset existing rows.

Rebuild the remaining published ledger after deletion and explicitly reset providers with no remaining history. Preserve any separately modeled manual adjustments rather than leaving deleted schedule contributions behind.

**12. [P2] Saving one week's schedule hides other weeks' availability from the monthly report.**

Location: [reports.py:681](../../apps/api/app/routers/reports.py#L681), [candidate selection:175](../../apps/api/app/routers/reports.py#L175).

Candidates come from an inner join to schedule versions. Once any candidate exists in a month, `availability_period_ids` restricts all availability to those version-bearing periods. An open week with submitted availability but no saved schedule vanishes. Reproduced: September 21 showed one available provider before saving September 14's draft, then zero afterward; September 21's availability rows were unchanged.

Select availability periods independently of whether a version exists. Apply version/duplicate-period selection only to the relevant overlapping period group, keeping unversioned open weeks visible.

**13. [P2] A room referenced only by a structure template cannot be deleted.**

Location: [rooms.py:177](../../apps/api/app/routers/rooms.py#L177), [delete:367](../../apps/api/app/routers/rooms.py#L367), [template migration](../../apps/api/alembic/versions/202607050001_schedule_structure_templates.py).

The decision to hard-delete checks assignments and shift requirements, but not `ScheduleStructureTemplateSlot`. A template slot has a non-cascading room foreign key. Create a template referencing an otherwise unused room, then delete the room: the handler takes the hard-delete branch and commit fails with an integrity error. This was reproduced with foreign-key enforcement enabled.

Include template references in the deletion policy. Soft deletion fits the existing template-apply behavior, which already reports inactive rooms as skipped slots.

**14. [P2] An assignment outside the schedule period can be saved and published.**

Location: [schedules.py:915](../../apps/api/app/routers/schedules.py#L915), [date stabilization:754](../../apps/api/app/routers/schedules.py#L754), [assignment contract](../../apps/api/app/schemas/schedule.py#L46).

Save verifies that the period exists and that end time is after start time, but never checks the assignment date against the period's date range. Availability is looked up by weekday and period ID, so the same weekday in a different week can borrow the original week's availability. A September 21 assignment successfully published inside the September 14–20 period in the reproduction. Short periods and applied templates are also exposed to the missing range check.

Validate assignment dates against the parent period at save/generation boundaries and publication. If an invalid draft is retained, persist an explicit blocker; do not silently reinterpret its date.

**15. [P2] Manual publication and the solver enforce different same-day rules.**

Location: [provider_eligibility.py:451](../../apps/api/app/services/scheduling/provider_eligibility.py#L451), [solver.py:831](../../apps/api/app/services/scheduling/solver.py#L831).

Manual eligibility only checks timestamp overlap. The solver additionally prohibits multiple assignments on the same day unless they form a first-half/second-half pair at the same center. Two non-overlapping `full_shift` slots on Monday successfully saved and published manually, while strict solving of the same two locked assignments returned infeasible. The UI likewise does not enforce that solver-only restriction for non-overlapping slots.

Resolve which rule is intended, then express it in shared eligibility logic used by all paths. A manually publishable schedule should not become infeasible solely because it was sent through the solver.

**16. [P2] Provider reassignment is blocked by assignments already cleared from the working board.**

Location: [schedule-workspace.tsx:2622](../../apps/web/components/schedules/schedule-workspace.tsx#L2622), [selection rejection:2676](../../apps/web/components/schedules/schedule-workspace.tsx#L2676).

The picker checks the working board locally but sends the last saved version ID to backend eligibility. Clear a provider from saved slot A and select that provider for overlapping slot B before saving: the backend still sees A and reports a double booking. The frontend merges that stale conflict and refuses the otherwise valid selection. Checking a replacement slot against the unchanged saved snapshot reproduced `provider_double_booked`.

Evaluate conflicts against a defined working snapshot, or separate provider/room checks from draft conflict checks until the complete draft is submitted. Do not merge conflict results from two different schedule states.

**17. [P2] Async schedule operations can overwrite edits made while they run.**

Location: [schedule-workspace.tsx:2112](../../apps/web/components/schedules/schedule-workspace.tsx#L2112), [generation completion:2213](../../apps/web/components/schedules/schedule-workspace.tsx#L2213), [provider selection:2689](../../apps/web/components/schedules/schedule-workspace.tsx#L2689).

Save and generation replace the entire working version when their request completes. The board remains editable; their buttons disable only their own operation, and version selection and other operations remain available. Provider selection also resumes after an await and reconstructs assignments from the old captured `workingVersion`. An edit made during a slow solve/save/check can therefore disappear when the earlier operation finishes, even within one browser session. This finding is established by the state-transition and control-enablement code, not a live browser timing test.

Serialize incompatible actions or use a working revision token so stale completions cannot replace newer edits. For provider selection, update the current state only if the target assignment and checked inputs still match. Preserve edits made after a save snapshot rather than marking them saved.

**18. [P2] Editing a saved version discards assignment requirements and some assignments.**

Location: [schedule-workspace.tsx:309](../../apps/web/components/schedules/schedule-workspace.tsx#L309), [payload:1952](../../apps/web/components/schedules/schedule-workspace.tsx#L1952).

The backend contract supports `required_provider_type`, `shift_requirement_id`, notes, and nullable rooms. Loading a saved version drops roomless assignments entirely and does not retain the requirement fields in the UI model. Saving sends `required_provider_type: null`, `shift_requirement_id: null`, and `notes: null` for every remaining assignment. A draft generated from a typed shift requirement can lose that hard restriction on an ordinary UI save; a doctor-only requirement is then no longer enforced unless the room independently has `md_only`. This is conditional on those supported backend fields being populated.

Preserve all persisted fields through the UI round trip, including records the current board cannot edit, or reject unsupported editing explicitly. Derive immutable requirement rules from their authoritative requirement when that association exists.

**19. [P2] The constraint table hides backend-only hard blockers.**

Location: [schedule-workspace.tsx:1258](../../apps/web/components/schedules/schedule-workspace.tsx#L1258), [constraint aggregation:1344](../../apps/web/components/schedules/schedule-workspace.tsx#L1344), [row rendering:3219](../../apps/web/components/schedules/schedule-workspace.tsx#L3219).

`versionFromDetail()` reads persisted violation messages, but the table and rendered provider status recompute their messages from local provider options. Those options know only credential and skill IDs, not credential validity windows or proficiency levels. They also do not consume schedule-level solver violations. A backend-saved `inactive_center_credential` or `insufficient_required_skill_level` blocker can therefore disappear from the displayed constraints and hard-blocker count, even though the API correctly refuses publication. The loaded validation messages are not used to render those rows.

Include authoritative backend violations in the review model, linked to assignment or schedule scope, and refresh their validity when the working snapshot changes. Avoid both hiding current blockers and keeping obsolete ones indefinitely.

**Verification and limits**

Completed checks:

- `uv run pytest -q` from `apps/api`: **138 passed**.
- `npm run lint`, `npm run test:auth`, and `npm run build` from `apps/web`: passed. The six authentication checks passed; the build also ran route type generation and TypeScript checking.
- `npm audit --omit=dev`: **zero reported vulnerabilities**. The earlier review's frontend dependency advisory finding is not reproduced in this dependency tree.
- Exported locked production Python requirements with `uv export --frozen --no-dev --no-hashes --no-emit-project`, then audited them using `uvx pip-audit -r ... --no-deps --disable-pip`: **no known vulnerabilities found**.
- `uv run alembic heads`: one head, `202607050001`.
- Executed isolated route/service reproductions with real SQLAlchemy sessions, `autoflush=False`, and foreign-key enforcement. The temporary in-memory SQLite harness adapts PostgreSQL UUID/JSONB types for execution. It exercises application control flow and SQLAlchemy persistence behavior; it is not a PostgreSQL migration or concurrency test.
- Executed the actual TypeScript time helpers and publication handler, plus an isolated component/hook harness with deferred availability loading. The frontend harness replaces API calls and rendering dependencies; it does not contact accounts or production systems.

Temporary reproduction scripts are available for this workspace session:

```powershell
# From apps/api
uv run python "$env:TEMP/schedule_solver_deep_review.py"

# From apps/web
node "$env:TEMP/schedule_solver_frontend_review.cjs"
```

Reviewed the scheduling services and routes, auth and provider invitation boundaries, operational CRUD, availability editing, reporting/fairness flows, request/response contracts, relevant migrations, frontend workflow state, and build/deployment configuration. The existing backend tests primarily cover helpers, solver contracts, route registration, and mocked sessions; they do not exercise the complete publication/persistence transactions that exposed several findings above.

No production database, live Clerk configuration, real invitation delivery, PostgreSQL migration execution, or full authenticated browser workflow was tested. No application fixes or deployments were made. This report is the only repository file added by the review.

Prioritize the data corruption and publication issues first, then auth/invitation normalization and fairness transactions. Add focused integration coverage around these failures before further scheduling changes; another clean lint/build run alone will not protect these behaviors.
