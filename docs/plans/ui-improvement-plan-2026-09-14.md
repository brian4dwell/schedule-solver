# UI improvement plan

Date: September 14, 2026  
Status: Proposed; no application changes implemented.

## Review basis

A computer-use agent inspected the signed-in administrative UI at `https://bespoke-web.fly.dev` using browser interaction, accessibility snapshots, and screenshots. Desktop captures were approximately 1585–1600 px wide by 702–709 px high. Repository reads supplied component ownership and product constraints; the deployed revision was not verified against the local checkout.

The review used existing data and read-only navigation. No records were saved, created, deleted, deactivated, generated, or published. Findings below distinguish visible behavior from source-supported risks and proposed improvements.

**Coverage:** Provider detail/preferences, Provider roster, Setup navigation, Centers list, Schedules list, an empty October 5 schedule workspace, the seven-day Availability editor, Dashboard, and Availability Submission Monitor with a Provider row expanded. The browser was returned to the original Provider page.

**Limits:** Desktop only. No mobile or screen-reader session, populated schedule, drag-and-drop, save/error/dirty-state, solver, publication, Provider Portal, invitation, or other report flows were exercised. All 13 periods shown in the schedule list had no saved version, so populated scheduling behavior remains a required follow-up in local/test data. Screenshots were inspected during the review but are not attached to this plan.

## Direction

Keep the existing quiet, dense operational style: slate surfaces, teal primary actions, compact tables, restrained borders, and explicit status labels. The main opportunity is to make the scheduler's next action and current context easier to find. Prioritize usable workspace area, clear save boundaries, navigation behavior, and finding records before decorative changes.

## Findings and proposed changes

Priority P1 means address in the first improvement pass because the issue affects a central workflow or keyboard interaction. P2 means subsequent usability and consistency work. These priorities are usability judgments, not claims of a production outage.

### 1. Bring the schedule board into the first screen — P1

**Observed:** On the October 5 workspace, the header, action controls, expanded template form, and large empty Freeform notes panel pushed the schedule board entirely below the initial desktop viewport. The empty board showed five clear weekday columns and a room palette once scrolled into view.

**Proposed:**

- Use a compact period/version header with a persistent save state, Save draft, and Publish saved draft actions.
- Put templates and notes behind clearly labeled disclosures that show useful summaries, such as the selected template or whether notes exist.
- Place the board directly under the header. Keep layout and weekend controls next to the board; group generation and clear operations separately from routine save actions.
- Keep the room palette alongside the board where space permits and provide a clearly labeled room picker on narrower screens.
- Make the empty board explain the next action: add a room to a day or load a structure template.

**Acceptance:** At 1440×900 and at the reviewed roughly 1600×700 viewport, weekday headings and the first slot or empty-day actions are visible without scrolling. Notes and template tools remain discoverable. Sticky controls do not obscure focused content at browser zoom.

**Ownership:** `apps/web/components/schedules/schedule-workspace.tsx`.

### 2. Put schedule readiness beside publication — P1

**Observed:** The empty workspace reported zero assigned rooms and zero publish blockers. Eight minimum-shift warnings appeared farther down the page, while availability follow-up for eight of 22 Providers appeared separately near the top. The constraints table already exists and should remain the detailed explanation surface.

**Proposed:**

- Present room count, assigned/unassigned coverage, hard blockers, warnings, and availability follow-up in one compact summary.
- Show an explicit readiness message for an empty schedule instead of allowing zero blockers to imply readiness.
- Provide a visible reason whenever publication is unavailable, including an empty board, unsaved changes, pending validation, or hard violations.
- Link the blocker/warning totals to the corresponding constraints, and link actionable slot issues back to their slots.
- Explain generation modes in scheduler language: strict generation requires a feasible result; best effort may retain unresolved coverage for review. Confirm exact wording against the existing API behavior during implementation.

**Acceptance:** A scheduler can identify why publication is unavailable without searching below the board. Warnings never count as hard blockers; a changed board clearly indicates that saved validation is stale. All current backend publication checks remain authoritative.

**Ownership:** `schedule-workspace.tsx`; existing schedule contracts and publication workflow tests.

### 3. Make Provider sections and save boundaries explicit — P1

**Observed:** Provider details occupied only about the left 760 px of the desktop screen, with substantial unused space on the right. Two preference panels began below the long details form. The page had three separate Save actions and no visible breadcrumb or Back to Providers link. One panel used “Practitioner Preferences.”

**Source-supported risk, not reproduced live:** `ProviderForm` navigates to `/providers` after a successful save, while the two preference panels maintain separate draft state. Editing multiple sections before saving the details form could therefore discard preference edits.

**Proposed:**

- Add a Provider header with name, type, status, and Back to Providers.
- Add section navigation for Details & eligibility, Provider preferences, and Manager preferences. Use a consistent content width with grouped fields rather than stretching individual inputs across the entire screen.
- Preserve the existing independent save operations, with clear section-specific Save labels and dirty/saved state. Do not imply that one button saves all sections.
- Keep the user on the detail page after saving an existing Provider. Protect dirty edits when changing sections or leaving; validate behavior across all independently editable sections.
- Describe the audience and purpose of Manager preferences based on existing visibility rules. Use Provider terminology consistently.

**Acceptance:** Each section is reachable directly, and each Save action clearly identifies its scope. Saving one section leaves other unsaved edits intact. Failed saves preserve inputs and identify the affected section. The user can return to the roster without losing work unexpectedly.

**Ownership:** `apps/web/app/providers/[providerId]/page.tsx`, `provider-form.tsx`, and `provider-preferences-editor.tsx` under `apps/web/components/providers`.

### 4. Finish navigation dismissal and keyboard behavior — P1

**Observed:** The Setup dropdown remained expanded after pressing Escape and after clicking the page heading outside the menu. Navigating to another page closed it.

**Proposed:** Close navigation disclosures on Escape, outside click, and route changes. Return focus to the trigger after Escape; preserve normal pointer focus behavior on outside click. Add a visible disclosure indicator and ensure expanded/current-page state is exposed appropriately. Review Reports and row action menus for equivalent behavior without assuming they share the reproduced defect.

**Acceptance:** Keyboard users can open, traverse, and dismiss each menu. Escape closes the active menu and restores focus. Outside click closes it without blocking the clicked target. Only one top-level menu is open at a time.

**Ownership:** `apps/web/components/layout/top-nav.tsx`; row action menus such as `apps/web/components/schedules/schedules-table.tsx`.

### 5. Offer an explicit alternative to dragging rooms — P1

**Observed:** The schedule board instructs the user to drag rooms into days. Room palette entries appeared as plain text in the accessibility snapshot, with no exposed Add-to-day action. Keyboard drag behavior was not exercised.

**Proposed:** Add a keyboard-operable Add room action that selects the Room and day, plus move/reorder controls for existing slots. Retain dragging as a shortcut. Keep the same eligibility checks, operation locking, and draft behavior for both input methods.

**Acceptance:** In a local fixture, complete room placement, movement, Provider selection, and draft saving using only a keyboard. Focus follows the affected slot, and each action has an accessible name that includes its Room/day context.

**Ownership:** `apps/web/components/schedules/schedule-workspace.tsx`.

### 6. Make operational lists easier to search and scan — P2

**Observed:** The Provider roster contained 22 rows and offered Show inactive, but no visible search, type filter, or sorting controls. Provider type and employment values appeared as lowercase tokens. The repeated visible row action was Deactivate; editing relied on discovering the Provider name link. The schedule list contained 13 weeks, all showing Never published / No saved version.

**Proposed:**

- Add Provider search by name/email, type and Center filters, a result count, and Clear filters. Preserve active-only as the initial roster scope.
- Use display labels such as CRNA, Doctor, and Employee while preserving API values.
- Make the normal edit/open action explicit and move infrequent status-changing actions into a row menu.
- Add date/status filtering to the schedule list as the number of periods grows. Treat saved-version availability and publication status as distinct facts.
- For new filters, distinguish no records from no matches and expose a clear next action.

**Acceptance:** A user can find a named Provider or Providers credentialed for a Center without scanning all rows. A credential filter must not imply full scheduling eligibility. Filtering never silently changes records. Clearing filters restores the list. Action labels identify their target for assistive technology.

**Ownership:** `apps/web/components/providers/providers-table.tsx`, `apps/web/components/schedules/schedules-table.tsx`; apply proven list patterns to other tables where useful.

### 7. Standardize status and page language — P2

**Observed:** Centers rendered Active as plain text, while Providers used a green status pill. Provider preferences used Practitioner terminology despite the rest of the administrative UI using Provider.

**Proposed:** Share a small typed status presentation pattern and a consistent page-heading/breadcrumb treatment. Keep status text visible alongside color. Reserve red for hard errors, amber for warnings, emerald for valid/active states, and teal for actions/selection. Remove raw enum tokens from human-facing labels.

**Acceptance:** Equivalent states have equivalent visual treatment across reviewed pages. Status meaning is understandable without color. Each page has a clear primary heading and detail pages provide an obvious route back to their list.

**Ownership:** `apps/web/components/layout/page-header.tsx`, relevant feature tables/forms, and small shared components under `apps/web/components/ui` only where repeated behavior warrants them.

### 8. Clarify and compact weekly availability — P1

**Observed:** Weekdays used different rainbow tints regardless of selection. Two Full shift days had different colors, as did several Unset days. Full-width rows placed day labels far from their six small checkbox controls. All seven days plus Save/Delete required scrolling. No visible explanation distinguished None from Unset or explained shift options. In the accessibility snapshot, repeated option names such as First half, None, and Unset did not consistently include weekday context; this needs a screen-reader check.

**Proposed:**

- Keep the selected Provider, week date range, completion state, and Save availability action together.
- Use a compact aligned weekday/options matrix on desktop and grouped day controls on narrow screens. Use fieldsets/legends or equivalent explicit accessible naming for each day and option.
- Replace decorative weekday colors with neutral rows; emphasize selected choices and meaningful completion/locked states through both text and restrained color.
- Label None as Unavailable and Unset as Not provided, retaining the underlying contract values. Explain that work options may be combined and these two states are exclusive.
- Explain shift options using the application's actual definitions; do not invent clock times or change availability semantics.
- Keep Save availability reachable while editing and rename Delete to identify exactly what it clears. Show published-week locking clearly.

**Acceptance:** Users can distinguish no response from explicit unavailability, see which days need attention, and understand the current Provider/week save scope. Every control announces day plus option. Min/max shift requests remain soft requests, and the UI adds no inferred availability defaults.

**Ownership:** `apps/web/components/providers/provider-availability-editor.tsx`; existing availability workflow tests and contracts.

### 9. Turn availability monitoring into a compact follow-up workflow — P2

**Observed:** Last update showed raw UTC ISO timestamps with six fractional-second digits. The report had no visible week/status filter or summary. Incomplete rows could expand but had no obvious disclosure icon. One expanded Provider produced 12 large yellow week cards over several screens, without a direct action to open that Provider/week's availability.

**Proposed:** Format update timestamps for people and expose the time zone. Add a clearly labeled week/date scope, incomplete/complete filters, and summary counts. Use an explicit disclosure button and a compact nested week table showing missing days. Add Open availability actions that preselect the exact Provider and Schedule Period using validated route/query state.

**Acceptance:** A scheduler can find an incomplete Provider for a selected week and open the correct editor directly. Counts match the displayed scope, not an unexplained all-period total. Disclosure controls work with keyboard and screen readers. Dates remain unambiguous, and audit timestamps are not confused with schedule wall-clock dates.

**Ownership:** `apps/web/components/providers/availability-submission-monitor-table.tsx`, `apps/web/app/reports/availability-submission-monitor/page.tsx`, and `apps/web/app/availability/page.tsx`. Start with the records already supplied; add a typed API contract only if additional data is required.

### 10. Make the Dashboard start with daily scheduling work — P2

**Observed:** Six equal first-row cards put Schedules last after setup entities, with reports in a second row. The introductory copy referred to the “first operational slice.”

**Proposed:** Lead with an explicit current/next-period selection, Continue schedule, and availability follow-up. Keep setup links in a smaller secondary group. Replace implementation-stage copy with instructions for the scheduler. Use existing period/status data where available; display an honest no-period state rather than guessing which period should be current.

**Acceptance:** A scheduler can identify the intended period and reach its schedule or availability follow-up directly. Setup remains easy to find. Any counts are derived from a clearly stated period scope.

**Ownership:** `apps/web/app/dashboard/page.tsx` and existing typed period/status data access.

## Delivery sequence

1. **Navigation and Provider editing:** Address findings 3–4 first. This gives a bounded initial change with directly reproducible navigation checks and a focused multi-section save regression scenario.
2. **Schedule and availability:** Address findings 1–2, 5, and 8 in focused changes, using empty and populated local schedules. Establish the compact header and board placement before moving controls or adding input methods. Reuse the clarified availability language in schedule follow-up.
3. **Lists, monitoring, and Dashboard:** Address findings 6–7 and 9–10. Build scoped follow-up links before surfacing those actions on the Dashboard.
4. **Verification:** Perform a fresh browser review of the changed flows and finish the checks below. Deploy only if explicitly requested.

## Implementation constraints

- Follow `docs/architecture/coding_standards.md` and the applicable `AGENTS.md` files. Read the installed Next.js guides before writing framework code.
- Use `useToast()` from `apps/web/components/ui/toast-provider.tsx` for workflow outcomes. Keep field/row-specific validation and persistent workflow context inline; avoid duplicating transient success messages across multiple surfaces.
- Preserve backend eligibility, immutable Schedule Versions, invalid-but-saveable drafts, strict publication, and the distinction between availability and soft shift requests.
- Keep data shapes explicit and typed. Use Zod at frontend boundaries, and change Pydantic/API contracts in tandem only when a proposed feature actually needs new data.
- Do not introduce silent defaults or fallback behavior, auto-save, a new component library, or a broad redesign as incidental work.

## Validation plan for future implementation

- Browser checks at 1440×900, approximately 1600×700, 1024×768, and a narrow 390×844 viewport; check 200% zoom and keyboard focus. For dense calendars, keep any intentional horizontal scroll inside the board/report rather than the entire page.
- Use local/test data for one empty schedule, one populated draft with a hard blocker, one warning-only draft, a published locked period, and dirty/failed-save states. Do not manufacture these states in the shared deployment.
- Verify empty, loading, error, disabled, and no-match states for the affected controls. Live review of a populated page does not establish that these other states work.
- Add focused behavioral tests for menu dismissal, independent Provider section drafts, keyboard room placement, and meaningful filtering. Avoid snapshot tests that merely reproduce the new markup.
- Run relevant existing workflow tests, `npm run lint`, `npm run typecheck`, and `npm run build` from `apps/web` for the eventual changes. Run Python tests through `uv run` only if backend behavior/contracts change.
- No application tests are required for this planning-only document; no implementation or deployment is part of this review.
