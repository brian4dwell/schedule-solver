# Weekly Availability Notes

Status: Planned; not implemented by this document.
Created: 2026-09-14.

## Problem and outcome

Providers need a free-text box to explain availability for each week they submit. A Provider should be able to save a note with one week's availability, return to it later, and have the scheduler see that note when reviewing the week.

## Proposed first release

- Add an optional multiline "Notes for this week" field to each week's availability editor in the Provider Portal.
- Show the week dates beside the field so its scope is clear when several weeks are open.
- Save notes together with weekday availability and requested shift counts in one transaction.
- Allow Providers to edit or clear their own notes while the week is editable. Apply the existing published-week lock to notes as well.
- Show the saved note in the admin Provider week availability view, including when the week is locked.
- Preserve line breaks and render notes as plain text.
- Treat notes as context for the scheduler. Notes do not change availability completeness, eligibility, solver inputs, or publishing rules.

Example: A Provider submits September 21–27 availability and adds "Prefer an early finish on Thursday if possible." That note belongs only to that Provider and that schedule week.

## Existing implementation

- `ProviderScheduleWeekAvailability` in `apps/api/app/db/models/scheduling.py` stores one row per weekday, with no weekly note field.
- The separate `ProviderAvailability.notes` field belongs to time-range availability; it does not represent this weekly submission.
- `apps/api/app/routers/provider_availability.py` and `apps/api/app/routers/provider_portal.py` each replace weekly day rows during saves.
- Shared weekly contracts live in `apps/api/app/schemas/provider_availability_week.py` and `apps/web/lib/schemas/provider-weekly-availability.ts`.
- Relevant UI lives in `apps/web/components/providers/provider-availability-editor.tsx`, `provider-portal-workspace.tsx`, and the week/calendar availability views.

## Proposed persistence and contracts

Create a concrete `ProviderScheduleWeekNote` model and table with an ID, organization ID, schedule week ID, Provider ID, nullable note text, and timestamps. Enforce one record per organization, Provider, and schedule week. This stores the weekly text once instead of duplicating it across seven weekday rows. Keep the existing day storage intact for this feature.

Add a nullable `notes` field to the weekly read and replace contracts in Pydantic and Zod. Require the field in the updated replacement payload: `null` explicitly means no note. An absent note record reads as `null` by definition. Existing weekly submissions need no invented note content.

Proposed validation: a maximum of 2,000 characters; normalize blank or whitespace-only input to `null`; preserve internal line breaks. Keep backend and frontend validation aligned.

Share the note persistence behavior between admin and Provider save paths. Replacing day rows must not accidentally delete the week's note. A full availability reset should clear both the day rows and note in the same transaction, subject to the reset decision below.

## Implementation steps

1. Add the weekly note model, organization-scoped uniqueness, and Alembic migration.
2. Extend shared Pydantic and Zod contracts and the API client.
3. Update both save paths, read projections, and reset behavior; preserve the existing ownership checks and week locks.
4. Add the textarea, saved-note display, dirty-state tracking, and character validation to the week editing workflow.
5. Use `useToast()` for save success or request failures; keep note validation beside the field.
6. Check that submission monitoring timestamps still reflect a save where only the note changed, without changing completion semantics.
7. Update the Provider Portal documentation when implemented.

## Acceptance criteria and validation

- Notes survive save, reload, and subsequent availability edits, including a note-only edit submitted with the existing week data.
- Two weeks for the same Provider retain different notes; two Providers in the same week cannot overwrite each other's notes.
- Clearing a note persists after reload, and existing submissions display an empty field.
- Providers cannot read or write another Provider's notes or another organization's data.
- Locked weeks reject note changes through both write paths.
- A failed save leaves both availability and notes unchanged and preserves entered text for retry.
- Maximum-length, oversized, whitespace-only, multiline, and markup-like text behave consistently at both boundaries.
- Saving notes does not make incomplete availability complete through any new note-specific rule.
- Add focused persistence/API tests and a UI regression check covering save, reload, clear, and locked display. Run Python tests through `uv run pytest`.

## Decisions to confirm during refinement

- Is 2,000 characters the right limit?
- Should admins be able to edit a Provider's note, or only read it? Proposed first release: read-only for admins, with their existing availability saves preserving the note.
- Should resetting an entire week's availability clear the note? Proposed first release: yes, with that effect stated in the reset action.
- Should notes also appear in the availability submission monitor or monthly availability report? Proposed first release: the Provider week detail only.

## Out of scope

Per-day notes, threaded conversations, attachments, note history, notifications, and interpreting prose as scheduling constraints.
