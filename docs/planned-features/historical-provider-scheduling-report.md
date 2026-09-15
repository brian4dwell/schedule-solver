# Historical Provider Scheduling Report

Status: Planned; not implemented by this document.
Created: 2026-09-14.

## Problem and outcome

Schedulers need to review scheduled shifts across a selectable number of past Schedule Periods, alongside each Provider's requested minimum and maximum shifts, weekly notes, and availability for those periods.

The report should make it easy to compare what a Provider offered and requested with what they were scheduled for. Scheduled shifts are not evidence of shifts actually worked; attendance and payroll are outside this report.

Example: Selecting a Provider and the last eight completed periods shows their assigned shifts for each week, the requested min/max range, all seven days of availability, and the note attached to that week. A week with offered availability but no assignments remains visible.

## Proposed first release

- Add an admin-only "Historical Provider Scheduling" report under Reports.
- Provide a positive integer "Past periods" control for X, with a proposed default of four. Show the actual selected periods and date range in the report header.
- Provide a searchable Provider selector and an "All Providers" option. Include inactive Providers with historical assignments, availability, notes, or snapshots in the selected periods.
- Group results by Schedule Period and Provider. Show the newest period first, then Providers by name, with daily detail ordered chronologically.
- For each Provider-period group, show requested minimum and maximum shifts, scheduled shift total, weekly notes, and the source of the historical availability information.
- Show a daily table with date, weekday, availability options, and scheduled shifts. Include availability-only days and days with no assignment, rather than starting the report from assignments alone.
- Show each scheduled shift's Center-local start/end times, shift type, Center, and Room, together with its source Schedule Version.
- Render weekly notes once per Provider-period group as plain text, preserving line breaks and wrapping long text. Distinguish a recorded empty note from unavailable historical note data.
- Keep the report read-only. Link to the source schedule where existing navigation supports it.

Related plans: [Provider Schedule Report](provider-schedule-report.md) covers future assignments; [Provider Future Availability Report](provider-future-availability-report.md) covers future availability and notes.

## Selecting X past periods

Proposed meaning of a past period: a Schedule Period whose end date is earlier than today in an explicit scheduling timezone. The current incomplete period is excluded, even if some of its shifts are already in the past.

- Choose the most recent X completed periods before filtering by Provider or whether assignments exist. Do not turn "last eight periods" into "last eight periods in which this Provider worked."
- Count Schedule Periods, not Schedule Versions, calendar months, or a fixed number of days. Order by end date, start date, and period ID for deterministic selection.
- If fewer than X completed periods exist, show all available periods and the requested versus returned count.
- Return the effective cutoff date and timezone so date selection is explainable and stable across browsers.
- When overlapping Schedule Periods are alternative schedules for the same dates, require explicit selection and show the resolved period list before aggregating. Do not silently merge alternatives or count both as independent weeks.
- Keep selected periods with no published schedule visible as "No published schedule." Do not replace them with older periods just to fill the report with assignments.
- Validate X at both boundaries. If an operational limit is necessary, disclose and validate it rather than silently capping results.

## Schedule source and counts

Proposed first release uses the current published Schedule Version for each selected period, excluding superseded versions. Show version number and publication timestamp. Select the version before filtering assignments by Provider, so a Provider removed from a later publication does not retain an older assignment in the report.

Do not substitute a draft when no published version exists. Report the missing publication explicitly; its scheduled count is unavailable, not zero. If an existing published version contains no assignments for the selected Provider, the scheduled count is zero.

Use the existing shift-request unit rules from `apps/api/app/services/scheduling/shift_request_units.py` when comparing scheduled totals with requested min/max values. Preserve half-shift precision. Label a raw assignment count separately if it is displayed; it is not interchangeable with the weighted shift total used for requests.

An optional "Below minimum / Within range / Above maximum" indicator may summarize the comparison. Show it only when the schedule and corresponding request data are available, identify the data source, and do not introduce new scheduling violations or publish rules.

Use stored schedule dates and wall-clock times without browser-timezone conversion. Keep separate assignments visible even if their times match; deduplication must not hide conflicts. Preserve references to now-inactive Providers, Centers, and Rooms.

## What "availability was" means

The existing weekday availability, requested min/max values, and weekly note are stored by Provider and Schedule Period. They are not versioned with each Schedule Version. Published weeks currently lock edits, but that lock alone does not establish a historical snapshot for every publication. Weekly notes were introduced on 2026-09-14; earlier notes cannot be reconstructed when they were never recorded.

The report must state which evidence it shows:

| Source | Meaning |
| --- | --- |
| Captured at publication | Availability, min/max requests, and weekly notes saved with the selected publication |
| Current saved period data | Values retained for the historical period when the report is loaded; not verified as the values at publication |
| Historical data unavailable | No publication snapshot exists for the selected Provider and version |

Proposed approach: capture publication snapshots going forward and show an explicit legacy-data section for periods without snapshots. In that section, current saved period values may be displayed under "Current saved period data" to keep older periods useful, but must never be presented as verified publication-time values. This is an explicit reporting policy, not an implicit substitution for a missing snapshot.

For new publications:

- Capture all seven weekday choices, submission/missing-row state, raw selected min/max request units, and the nullable weekly note for each included Provider in the same transaction as successful publication.
- Include Providers with availability or notes but no assignments, and active Providers whose missing submission needs to be represented. Preserve explicit missing data rather than inventing zero requests or offered availability.
- Use concrete organization-scoped snapshot models keyed by Schedule Version and Provider, with typed daily records and a capture timestamp. Keep weekly values and notes once per snapshot rather than duplicating them across days.
- Take a new snapshot for a new published version and retain the older version's snapshot. Repeated publication of the same version must not overwrite its original snapshot.
- A failed publication must leave no completed snapshot. A concurrent availability save must not produce a snapshot mixing day rows, requests, and notes from different saves.
- Subsequent availability changes or resets must not modify captured history. Review existing schedule deletion and cascade behavior so snapshots are not silently lost; define retention before implementation.
- Do not backfill current data into a publication-time snapshot or assign a fabricated historical capture timestamp.

The initial historical baseline is publication time, not the moment the schedule was generated or the moment a shift was worked. Supporting those other baselines requires an explicit additional design.

## Technical approach

- Add a dedicated report service and an admin-only endpoint under `apps/api/app/routers/reports.py` accepting period count, optional Provider ID, and explicit period choices when needed.
- Query periods, selected versions, assignments, Provider records, weekly availability, notes, and snapshots in batches. Use a consistent database read for report rows and source metadata.
- Scope every query and filter ID to the current organization. Reject inaccessible IDs rather than returning a broader report.
- Add Pydantic contracts for filters, selected periods, version metadata, Provider-period summaries, availability-source status, daily choices, shift rows, nullable request values, and notes. Mirror these with Zod and extend `apps/web/lib/api.ts`.
- Reuse `ProviderScheduleWeekAvailability` and `ProviderScheduleWeekNote` for the explicitly labeled current-data view. Do not substitute Provider profile notes, time-range notes, assignment notes, or schedule-version notes for the Provider's weekly note.
- Add an Alembic migration and publication-service integration for the snapshot models. Historical request values must be preserved as captured, without recalculating or clamping them against today's data.
- Add a thin report page, a report component, and navigation entry. Keep Provider and X filters in the URL for reloadable report selections.
- Use `useToast()` for request failures and contextual messages for missing publications, missing history, and empty results. Late responses must not overwrite results for newer filters.
- If pagination is needed, preserve complete Provider-period groups and make every selected period accessible. Report totals must cover the complete selected dataset.

## Acceptance criteria and validation

- Changing X selects exactly the requested number of eligible past periods when available; invalid, zero, negative, and fractional values are rejected.
- The current period is excluded under the proposed completed-period rule, with correct behavior around month/year and timezone boundaries.
- Provider selection never changes which past periods were selected. Periods with zero assignments still show the Provider's availability, requests, and notes where recorded.
- All Providers mode includes historical records for inactive Providers without mixing organizations.
- Each period uses one selected publication. Superseded assignments and draft-only shifts do not inflate scheduled totals.
- Missing publication differs visibly from a published week with zero assignments. Alternative periods do not double-count the same scheduling week.
- Full, half, and short shifts use existing request units; requested min/max values retain their recorded half-shift precision.
- Each daily row displays the correct availability and all scheduled shifts for that Provider, date, period, and selected version.
- Missing, unset, explicitly unavailable, and work-available states are distinguishable. A note never implies availability or completion.
- Weekly notes remain attached to the correct Provider-period group, including multiline and markup-like text. Missing historical evidence differs from a captured null note.
- New successful publications capture coherent snapshots, including Providers with no assignments. Failed or repeated publication cannot create partial history or overwrite an original snapshot.
- Later edits or resets cannot change captured history. Legacy periods are labeled honestly and never receive fabricated historical values.
- Request races, empty results, missing history, and long notes are covered by UI regression checks.
- Run focused report, snapshot persistence, and publication tests through `uv run pytest`, plus relevant frontend typecheck, lint, and build checks.

## Decisions to confirm during refinement

- Is publication time the desired historical baseline, and should the default source be the current publication or a publication selected by the scheduler?
- Should older periods show explicitly labeled current saved values as proposed, or only show that publication-time history is unavailable?
- Should X count completed periods only, or also include the elapsed portion of the current period? Which scheduling timezone defines the cutoff?
- Should the report start with All Providers or require a single Provider selection? Is four a useful default for X?
- What retention policy should protect captured history when a published schedule or Provider is deleted?
- Are the min/max comparison indicator, printing, or exports needed in the first release?

## Out of scope

Attendance or payroll reconciliation, editing schedules or availability, reconstructing unrecorded history, note interpretation as scheduling rules, automatic fairness adjustments, and notifications.
