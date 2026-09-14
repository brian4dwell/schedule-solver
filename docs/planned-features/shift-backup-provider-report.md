# Shift Backup Provider Report

Status: Planned; not implemented by this document.
Created: 2026-09-14.

## Problem and outcome

Schedulers need a printable shift list that answers: "If the assigned Provider cannot work, who else was available and satisfies the hard licensing and location requirements?"

The report should put each shift, its assigned Provider, and potential replacements together so a scheduler can use it during an unexpected absence.

## Proposed first release

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

The current application models relevant qualifications through Provider Center Credentials, Provider type, and Provider Room Type Skills. Do not claim that the report verifies a separate licensing registry. Confirm whether "licensing" requires additional data beyond these existing records.

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

## Decisions to confirm during refinement

- Does licensing mean the existing credential/type/skill checks, or are additional license records needed?
- Should qualified-but-booked Providers appear in print, or should print contain only conflict-free replacements?
- Should contact details be printed, and which existing contact field should be used?
- Should the report include weekly notes from [Weekly Availability Notes](weekly-availability-notes.md)? Proposed first release: no dependency on that feature.
- Define how competing or overlapping Schedule Periods are selected and which additional scheduled work participates in conflict checks.

## Out of scope

Automatic reassignment, contacting Providers, constraint overrides, historical eligibility snapshots, and ranking by preferences or fairness.
