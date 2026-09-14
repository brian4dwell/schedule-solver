# Provider Schedule Report

Status: Planned; not implemented by this document.
Created: 2026-09-14.

## Problem and outcome

Schedulers need to select a Provider and see all of that Provider's future assigned shifts across Schedule Periods, using published schedules or the latest drafts.

Example: Selecting a Provider shows their upcoming shifts across September, October, and November without opening each schedule separately.

## Proposed first release

- Add an admin report with a searchable Provider selector.
- Default to today onward, with an optional end date. With no end date, include all future stored assignments; do not silently impose a monthly or yearly cutoff.
- Provide explicit "Published" and "Latest draft" source modes, with Published as the proposed default.
- Show a chronological list with date, Center-local start/end times, shift type, Center, Room, Schedule Period, version number, and draft/published status.
- Link each assignment to its source schedule where the existing workspace supports that navigation.
- Show the total matching shift count and a clear empty state when the selected source contains no upcoming assignments for the Provider.
- Preserve assigned shifts even if the selected Provider or a referenced Center/Room is now inactive. Mark inactive records rather than hiding scheduled work.

## Schedule source rules

For each included Schedule Period:

| Mode | Selected source | When no source exists |
| --- | --- | --- |
| Published | The current published Schedule Version, excluding superseded publications | Show that the period has no published version; do not substitute a draft |
| Latest draft | The saved draft with the highest version number among versions whose status is draft | Show that the period has no draft; do not substitute a published version |

Select the source version before filtering its assignments by Provider. If the newest selected version removes the Provider from a shift, that shift must disappear from the report; an older assignment cannot reappear because it matched the Provider filter.

Include at most one version per period. Do not deduplicate distinct assignments simply because date and time match: that could hide an actual conflict. If multiple Schedule Periods represent alternatives for the same dates, require an explicit period selection, using the existing monthly report's candidate selection concept where appropriate.

Label draft results prominently as tentative. Unsaved schedule workspace edits are not report data. A refresh should read the latest saved state and return its version metadata consistently with the assignment rows.

The wording "published or latest draft" could also mean a combined mode that uses a draft when present and a publication otherwise. That behavior is an open product decision, not an implicit fallback in this plan.

## Date and time behavior

Use stored `schedule_date`, `start_time`, and `end_time` values and the existing shared schedule-time contracts and formatting helpers. Display Center-local wall clocks without browser-timezone conversion.

Proposed meaning of "future": assignments whose schedule date is today or later, including earlier shifts on today's date. Derive today in an explicit scheduling timezone, with the policy confirmed below. Include that cutoff in the response and UI so filtering is explainable.

Sort by schedule date, start time, Center, Room, and assignment ID for deterministic results. If pagination is needed, paginate the full matching result and return a total; never silently truncate future shifts.

## Existing implementation and technical approach

- Existing reports are admin-only in `apps/api/app/routers/reports.py` and already project assignments with Schedule Period and Schedule Version metadata.
- The monthly availability report selects latest schedule candidates; its selection rules need an explicit extension or a separate helper to support these two source modes.
- Add a dedicated provider-schedule report service and endpoint accepting Provider ID, source mode, optional start/end dates, and explicit period choices when needed.
- Use typed Pydantic request/query and response contracts for filters, selected source versions, missing-source periods, assignment rows, and result count. Mirror them with Zod in `apps/web/lib/schemas/reports.ts` and extend `apps/web/lib/api.ts`.
- Scope Provider, Schedule Period, Schedule Version, Assignment, Center, and Room queries to the current organization. Reject inaccessible filter IDs rather than broadening the query.
- Load version selections and assignments in a consistent database read so concurrent saves or publication cannot mix source metadata and rows.
- Add a thin report page, an interactive report component, and report navigation entry using existing frontend conventions.
- Use `useToast()` for load failures. Keep empty results and missing-source explanations in the report itself, and prevent stale responses from a previously selected Provider from replacing current results.
- This is a read-only projection and should not require a schema migration.

## Acceptance criteria and validation

- Selecting a Provider returns only their assigned shifts across all included future periods.
- Published mode returns the current publication even when a newer draft exists.
- Latest draft mode returns the highest-numbered draft and visibly marks the result tentative.
- A missing requested source never triggers substitution with another status.
- A Provider removed in the selected version does not retain an assignment from an older version.
- Superseded versions, other Providers, and other organizations cannot contribute rows.
- Inactive Providers with future assignments remain selectable and their assignments remain visible.
- Explicitly resolve alternative periods without duplicating versions or concealing distinct conflicting assignments.
- Date filtering handles today, year boundaries, and a Provider working at Centers in different timezones according to the confirmed cutoff policy.
- No future assignment is lost to a hidden date horizon or result limit.
- Changing Provider or source mode clears/reloads the appropriate result; request failures cannot leave an old result mislabeled as current.
- Add focused report/service tests with `uv run pytest` and frontend checks for selection changes, source labels, date formatting, and empty/error states.

## Decisions to confirm during refinement

- Should published and latest draft be separate modes as proposed, a combined selection policy, or an explicit choice per Schedule Period?
- If a draft predates the current publication, should Latest draft still show it or only drafts created after that publication?
- Should "future" include all of today or only shifts that have not started? Which scheduling timezone defines the date cutoff across Centers?
- Should the first release support printing? A printable table would fit this report, but it was explicitly requested only for the backup Provider report.
- Should Providers eventually see their own published schedule in the Provider Portal? Proposed first release: admin report only; draft visibility for Providers requires a separate decision.

## Out of scope

Schedule editing, publication, calendar subscriptions, email delivery, availability-only days, and shift acceptance workflows.
