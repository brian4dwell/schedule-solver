# Shift Backup Provider Report

Status: Implemented.
Created: 2026-09-14.

## Implementation and release decisions

Open **Reports → Shift Backup Providers** at `/reports/shift-backup-providers`. Enter an inclusive date range, load schedule choices, select a draft or published version (or explicitly exclude) for each period, optionally filter shift rows by Center, and generate the report. Generate again to refresh qualifications and availability; printing is disabled until the current selections have a generated report.

The report uses existing Center credentials, Provider types, and Room Type skills. It does not verify a separate licensing registry. Both available and qualified-but-scheduled candidates appear on screen and in print. Contact details and weekly notes are omitted.

The selection step includes periods overlapping the requested dates plus two neighboring calendar days on either side. This accounts for simultaneous shifts in Centers as far apart as UTC+14 and UTC-12. Each period requires an explicit version or exclusion, including overlapping alternatives and neighboring periods. Selecting overlapping periods treats their chosen versions as concurrent work. Every assignment in a selected version participates in the schedule context across all Centers; the date and Center filters only control displayed shifts. Full-version assignments also supply weekly requested-shift counts. Unselected versions and explicitly excluded periods never create conflicts. The generated report discloses both selections and exclusions, and claims conflict-free status only within that chosen context.

`GET /reports/shift-backup-providers/options` loads scoped period/version and Center choices. `POST /reports/shift-backup-providers` is a read-only report request with `start_date`, `end_date`, nullable `center_id`, `selected_version_ids`, and `excluded_period_ids`. The backend revalidates every choice on generation. Both endpoints require admin authorization. The service in `apps/api/app/services/shift_backup_report.py` batches data loading and uses the shared eligibility evaluator, credential interval check, overlap check, and same-day pairing rule. No persistence migration is needed.

Invalid target shift data is displayed with blockers and no replacement recommendations. Existing assignments with unresolved time or Center data prevent affected candidates from being labeled available. Typed conflict codes and warnings survive into the response. Browser print repeats each shift's identity and table headings on continuation pages, hides controls/navigation, and prints every candidate without pagination.

Regression tests: `apps/api/tests/test_shift_backup_report.py` and `apps/web/tests/shift-backup-provider-report.test.mjs`. Print QA covers empty results, mixed draft/published sources, long names, and an 80-candidate list.

## Problem and outcome

Schedulers need a printable shift list that answers: "If the assigned Provider cannot work, who else was available and satisfies the hard licensing and location requirements?"

The report should put each shift, its assigned Provider, and potential replacements together so a scheduler can use it during an unexpected absence.

## First release requirements

- Add an admin report with a date range, optional Center filter, and explicit Schedule Version selection for the relevant Schedule Periods.
- Offer published and draft versions with visible status and version numbers. Select exactly one version for each included period; never combine assignments from multiple versions of the same period.
- Show date, Center-local start/end times, Center, Room, shift type, and assigned Provider on each shift row.
- Under each shift, list other Providers whose submitted weekly availability covers that shift and whose hard credential, Provider type, MD-only, and Room Type skill requirements are met.
- Exclude the assigned Provider from their own replacement list.
- Distinguish Providers who can cover without a scheduling conflict from qualified Providers who are already booked or violate the same-day assignment rule. Proposed presentation: a primary "Available replacements" list and a separately labeled "Qualified but already scheduled" list with conflict details.
- Show "No eligible replacements" when the primary list is empty. Do not broaden eligibility automatically.
- Include unassigned shifts in the selected schedule, labeled "Unassigned," with the same candidate evaluation.
- Sort shifts by date, time, Center, and Room; sort candidates alphabetically for a stable first release.

## Eligibility semantics

The current application models relevant qualifications through Provider Center Credentials, Provider type, and Provider Room Type Skills. The first release uses these records and does not claim to verify a separate licensing registry.

Reuse the backend rules in `apps/api/app/services/scheduling/provider_eligibility.py` and its typed contracts:

- Active Provider, Center, and Room; valid Room-to-Center relationship.
- Center credential active for the full shift interval, including effective and expiry boundaries.
- Required Provider type, MD-only restrictions, and required skill proficiency.
- Weekly availability for the shift's own Schedule Period and day, including existing full/half/short-shift compatibility rules. Missing, unset, or unavailable input cannot qualify.
- Double-booking and same-day restrictions evaluated as a proposed replacement, excluding the target assignment from existing assignments.
- Existing warnings, such as exceeding requested weekly shifts, remain visible warnings rather than new hard exclusions.

Preserve typed violation codes and severity when classifying candidates; do not identify conflicts by parsing message text. Do not change the shared eligibility rules solely to populate this report.

Conflict checks must use a coherent schedule context across the relevant periods. Historical and superseded versions must not create phantom conflicts. The report must disclose which versions were considered, and any overlap between competing Schedule Periods must be resolved explicitly before claiming a candidate is free.

The first release evaluates the selected schedule against current saved availability and qualification data at report generation time. It does not reconstruct what was known at publication. Show the generation timestamp and explain this basis in the report header.

## Print layout

- Provide browser print / Save as PDF with navigation and controls hidden.
- Repeat table headers and include the selected dates, Centers, version/status information, and generation timestamp.
- Print Center-local clocks and identify the timezone where needed; do not shift times into the browser's timezone.
- Wrap long names and candidate lists. Keep a shift with its candidates where practical; allow oversized groups to continue clearly on another page without clipping.
- Use text labels that remain clear in black and white. Print every filtered result, including rows beyond any on-screen pagination.

## Technical approach

- Add an admin-only report endpoint under `apps/api/app/routers/reports.py`, backed by a dedicated service that loads assignments and candidate eligibility data in batches.
- Add Pydantic response structures for report metadata, selected versions, shift rows, replacement candidates, conflicts, and warnings. Mirror the response in `apps/web/lib/schemas/reports.ts` and parse it through `apps/web/lib/api.ts`.
- Reuse the existing monthly report's selection UI patterns where useful, but make the source version explicit instead of assuming its current latest-version behavior matches this report.
- Add a report page and component under the existing reports directories and link it from report navigation.
- Keep report generation read-only. Derive results from scheduling data rather than persisting another set of assignments or eligibility flags.
- Use app-wide toasts for request failures and contextual empty states for shifts without replacements.

## Acceptance criteria and validation

- Each selected shift appears once with the correct assigned Provider and source version.
- A Provider with matching availability and all qualifications appears; the assigned Provider does not.
- Missing, inactive, or expired credentials; insufficient skills; MD-only/type mismatches; and missing or incompatible availability exclude a candidate.
- A qualified but booked Provider is never labeled an available replacement. Exercise conflicts across Centers and selected periods, plus valid and invalid half-shift pairs.
- Weekly requested-shift warnings remain visible without incorrectly excluding candidates.
- Invalid draft shift data is shown as a blocker rather than producing a misleading available-replacements list.
- Changes to availability or credentials are reflected on regeneration, with no claim of historical reconstruction.
- Organization isolation and admin authorization apply to report data and all selected IDs.
- Print preview covers empty results, long lists, multiple pages, and mixed draft/published selections without clipped content.
- Run focused backend report and eligibility tests with `uv run pytest`, plus frontend checks appropriate to the implemented UI and contracts.

## Future extensions

- Separate license registry data, if required in addition to the existing credential/type/skill records.
- Optional print filters for booked candidates or contact details.
- Optional weekly notes from [Weekly Availability Notes](weekly-availability-notes.md).

## Out of scope

Automatic reassignment, contacting Providers, constraint overrides, historical eligibility snapshots, and ranking by preferences or fairness.
