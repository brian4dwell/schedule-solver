# Provider Future Availability Report

Status: Implemented.
Created: 2026-09-14.

## Implementation

The report is available at `/reports/provider-future-availability` under the admin Reports menu. Both API endpoints are admin-only and organization-scoped:

- `GET /reports/provider-future-availability/providers` supplies the searchable selector, including inactive Providers and all employment types.
- `GET /reports/provider-future-availability?provider_id=<uuid>` returns the selected Provider, cutoff date, timezone, and every matching week.

`SCHEDULING_TIMEZONE` defines today on the API and defaults to `America/New_York`. Configuration rejects invalid IANA timezones. The report displays date-only values directly, preserving dates across browser timezones. Unset daily availability displays as a blank cell; submission and completion status remain at the week level. Print / Save as PDF opens browser printing with a portrait layout, hides navigation and controls, and includes Provider details, dates, requests, and complete multiline notes.

PDF for All Providers loads fresh reports for every Provider in the selector, including inactive Providers and Providers hidden by the current search. It works without selecting a Provider and opens one browser print dialog to save the combined report as a PDF, with each Provider starting on a new page. Requests run in batches of five. Any failed request stops printing and displays an app-wide error toast; retry reloads all reports. Closing the print dialog restores the selected Provider's print view.

Periods, day rows, and independent weekly notes are loaded in one outer-joined query so they share a database read snapshot. Shared weekly projection and completion rules supply day defaults and full-week completion; each dated row also identifies whether it was saved. Provider selection stays in the URL. Switching Providers discards previous requests; refresh clears old results and request failures use the app-wide toast system.

Regression coverage lives in `apps/api/tests/test_provider_future_availability_report.py` and `apps/web/tests/provider-future-availability-report.test.mjs`. No migration is required.

## Problem and outcome

Schedulers need to select an employee and see all of that person's future availability and weekly notes in one report, without opening each week separately. Use the existing Provider entity and Provider terminology for the employee selector.

Example: Selecting a Provider shows their availability for the remaining days of this week and every stored future schedule week, including requested shifts and the note saved for each week.

## First release requirements

- Add an admin-only "Provider Future Availability" report under Reports.
- Provide a searchable, single-Provider selector. Identify the selected Provider clearly in the report header.
- Show all future Schedule Periods for that Provider, in chronological order, without a required month selection or a hidden date horizon.
- Group results by schedule week. Show the week name, date range, draft/published status, and availability completion status using existing completion rules.
- Within each week, show each included date, weekday, and saved availability options: full shift, first half, second half, short shift, or none. Leave unset availability blank. Preserve multiple selected work options.
- Show the minimum and maximum requested shifts, including half-shift values, once per week. Label these as requests for the entire week, even when only its remaining dates are shown.
- Show "Notes for this week" once per week, beside the availability it describes. Preserve line breaks, wrap long text, and render markup-like content as plain text.
- Show a clear "No notes for this week" state when the note is null.
- Include published weeks and their notes as read-only results, alongside editable draft weeks. The report itself does not edit availability or notes.
- Provide a refresh action that retrieves the latest saved availability and notes.

This report shows submitted availability, not assigned shifts or inferred scheduling eligibility. The separate [Provider Schedule Report](provider-schedule-report.md) covers assigned shifts.

## Date and inclusion rules

"Future" means today and later. Include the current week when its end date is today or later, but show only daily availability dated today or later. Always retain the whole week's note and requested shift counts, with the full week range visible so their scope is clear.

Derive today using `SCHEDULING_TIMEZONE`. Return the effective cutoff date and timezone in the report metadata and display the cutoff in the UI. Do not let browser timezone conversion change stored availability dates.

- Include every existing Schedule Period whose end date meets the cutoff, including weeks with no saved availability. Clearly distinguish "Not submitted" from explicit `none` availability.
- Reuse existing weekly availability projection and completion semantics for missing day rows; do not treat a missing submission as offered work or infer availability from notes.
- A note must remain visible even if the week has no saved day rows. Load notes independently of weekday rows.
- Do not invent future schedule weeks beyond those created in the application. Explain an empty result as "No upcoming schedule weeks" when applicable.
- Keep different Schedule Periods with overlapping dates separate and label each by name and status. Availability and notes belong to a specific period; do not merge them by date or choose a Schedule Version.
- Keep inactive Providers with future availability or notes discoverable, and label them inactive instead of hiding their saved information.
- If pagination is needed, paginate by whole week, return a total, and provide access to every matching week. Never silently truncate future results.

## Data sources and technical approach

- Read weekday choices and requested shifts from `ProviderScheduleWeekAvailability`.
- Read weekly notes from `ProviderScheduleWeekNote`, keyed by organization, Provider, and schedule week. This feature builds on the deployed [Weekly Availability Notes](weekly-availability-notes.md) feature.
- Do not use Provider profile notes, time-range `ProviderAvailability.notes`, or schedule-version notes as substitutes for weekly notes.
- Add a dedicated admin report endpoint under `apps/api/app/routers/reports.py`, accepting a required Provider ID and returning report metadata plus typed weekly groups.
- Use Pydantic contracts for the selected Provider, effective cutoff, week metadata, submission/completion state, dated availability rows, requested shifts, and nullable weekly notes. Mirror the contracts with Zod under `apps/web/lib/schemas` and parse responses through `apps/web/lib/api.ts`.
- Scope the Provider lookup and every period, availability, and note query to the current organization. Reject inaccessible Provider IDs rather than broadening the query.
- Load periods, day rows, and notes in batches using a consistent database read so concurrent saves cannot mix old availability with a newly saved note.
- Reuse the shared weekly read projection, note-reading behavior, and date-formatting conventions where appropriate. Avoid one HTTP request or one note query per week.
- Add a thin report page, a feature component under `apps/web/components/reports`, and an entry in report navigation. Keep the selected Provider in the URL so the view can be reloaded or shared with another authorized admin.
- Use `useToast()` for request failures. Keep loading, no-selection, missing-submission, and empty-result messages in the report. A late response for a previously selected Provider must not replace the current selection's results.
- This is a read-only projection of existing data and should not require a new persistence table or migration.

## Acceptance criteria and validation

- Selecting a Provider displays only that Provider's future availability and weekly notes across month and year boundaries.
- Weeks beyond the next month or year remain accessible; no arbitrary future cutoff is introduced.
- Today is included, past daily rows are excluded, and the current week's note and full-week requested counts remain correctly labeled.
- Two weeks retain their own notes; two Providers in the same week never share or overwrite report content.
- Draft and published weeks both appear, with published notes visible and all report content read-only.
- Explicit `none` displays as None, while `unset` displays as a blank cell. Missing submissions remain labeled at the week level. Notes do not change availability completion or eligibility.
- A week with notes but no day rows still displays its note. Cleared notes display the empty-note state after refresh.
- Multiline, 2,000-character, and markup-like notes remain readable and render safely as plain text.
- Half-shift requested counts and multiple daily availability options survive report projection unchanged.
- Inactive Providers with future saved data and overlapping Schedule Periods do not lose records through filtering or deduplication.
- Admin authorization and organization isolation cover the selector, report endpoint, and URL-selected Provider IDs.
- Switching Providers during a pending request cannot show the previous Provider's data under the new name. Failed refreshes cannot leave stale results mislabeled as current.
- Add focused backend report tests through `uv run pytest` and UI regression checks for selection, date boundaries, notes, empty states, and request races. Run the relevant frontend typecheck, lint, and build checks.

## Release decisions

- The selector includes all Providers regardless of employment type or active status.
- The API's configurable scheduling timezone defines today, defaulting to `America/New_York`. Date scope is today onward, including the remaining days of the current week.
- Browser printing and Save as PDF use a portrait layout with complete multiline notes and week sections kept together when they fit on a page. CSV export remains out of scope.

## Out of scope

Editing availability or notes from the report, assigned-shift reporting, interpreting notes as constraints, eligibility ranking, historical note versions, notifications, and generating future schedule weeks.
