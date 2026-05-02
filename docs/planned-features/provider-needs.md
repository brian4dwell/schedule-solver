# Provider Availability Per Schedule Week Plan

## Goal

Create a weekly Provider availability flow that is requested and captured per schedule week.

Availability is not a global repeating weekly pattern.

Each new schedule week asks for that specific week's availability.

Each week can be different.

Each new week should default to the Provider's most recently saved week to reduce data entry.

## Product Decisions

Use `Availability` as the user-facing label in this first slice.

Do not add vacation or time-off records for this feature.

If a Provider does not submit availability for a schedule week, treat that as no provided availability for that week.

The schedule-week availability record is the only availability input in scope.

## Placement In The App

Add an `Availability` section to the current app menu.

For now, only managers use this section.

Managers can open a schedule week and set availability for each Provider.

Practitioner self-service UI is out of scope for this slice.

Practitioner email notifications are out of scope for this slice.

## Weekly Availability Model

Availability is captured per Provider per schedule week.

For each day in that week, the user must select exactly one option.

Allowed daily options:

- `full_shift`
- `first_half`
- `second_half`
- `short_shift`
- `none`

Use these values consistently across UI contracts and API contracts.

## Editing Rules

A Practitioner can edit their weekly availability response until the schedule is drafted.

A Manager can edit a Provider's weekly availability until the schedule is drafted.

After draft creation, the schedule week availability becomes locked for this slice.

## Information Architecture

The Availability screen should be schedule-week first.

Recommended flow:

1. Select schedule week.
2. Select Provider.
3. Edit Monday through Sunday availability choices.
4. Save.

The editor should show all seven days in one view.

Each day should use a single-select control with the five allowed values.

Show a clear badge for draft lock state.

## Defaults And Copy Behavior

When creating availability for a Provider in a new schedule week:

1. Look up the most recent prior saved week for that Provider.
2. Prefill all seven day selections from that prior week.
3. Allow the user to adjust any day before saving.

If no prior week exists, initialize all days to `none`.

Do not add fallback inference beyond this defaulting behavior.

## CRUD Behavior

Support create, read, update, and delete at the schedule-week availability record level.

Recommended behavior:

- Save one Provider week at a time.
- Keep unsaved edits local to the current Provider.
- Show section-level saving and error states.
- Refresh data after successful save.
- Block edits when schedule status is drafted.

Delete should clear the saved week record.

Delete should only be allowed before draft.

## Validation

Prefer Zod contracts for frontend boundaries.

Recommended schema file:

```text
apps/web/lib/schemas/provider-weekly-availability.ts
```

Recommended core contracts:

```ts
export const availabilityOptionSchema = z.enum([
  "full_shift",
  "first_half",
  "second_half",
  "short_shift",
  "none",
]);

export const weekdaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export const providerWeeklyAvailabilityDaySchema = z.object({
  weekday: weekdaySchema,
  option: availabilityOptionSchema,
});

export const providerWeeklyAvailabilitySchema = z.object({
  scheduleWeekId: z.string().uuid(),
  providerId: z.string().uuid(),
  days: z
    .array(providerWeeklyAvailabilityDaySchema)
    .length(7),
});
```

Add refinement to enforce one unique row per weekday.

Keep API contracts separate if persistence fields differ from form fields.

## Backend Concepts Needed

Add typed schedule-week availability storage.

Recommended model:

```text
provider_schedule_week_availability
  id
  organization_id
  schedule_week_id
  provider_id
  weekday
  availability_option
  created_at
  updated_at
```

Use enums for weekday and availability option.

Do not store this as opaque JSON.

## API Surface

Prefer schedule-week scoped routes.

Recommended routes:

```http
GET    /schedule-weeks/{schedule_week_id}/provider-availability
GET    /schedule-weeks/{schedule_week_id}/providers/{provider_id}/availability
PUT    /schedule-weeks/{schedule_week_id}/providers/{provider_id}/availability
DELETE /schedule-weeks/{schedule_week_id}/providers/{provider_id}/availability
```

`PUT` replaces all seven day values for that Provider and week.

The read response should include lock state from schedule status.

## Scheduling Semantics

This availability input is schedule-week specific.

`none` means the Provider is unavailable for that day.

Other options mean limited or full availability based on shift segmentation rules.

Exact slot-level eligibility mapping for `first_half`, `second_half`, and `short_shift` should be defined in scheduling rule contracts.

Do not invent fallback assignment outside the selected daily option.

## First UI Slice

Build in this order:

1. Add Zod schemas for provider weekly availability.
2. Add API client for schedule-week provider availability endpoints.
3. Add `Availability` menu section visible to managers.
4. Add schedule-week and Provider selector.
5. Add seven-day editor with five-option daily selector.
6. Add default-from-prior-week prefill on create.
7. Enforce draft lock in UI.

Practitioner-facing UI and notifications come later.

## Acceptance Criteria

This plan is ready when:

- Manager can open a schedule week and set availability for any Provider.
- Each day requires one of five allowed options.
- New week defaults to the Provider's prior saved week when available.
- Availability can be edited until the schedule is drafted.
- Availability becomes locked after draft.
- No vacation/time-off feature is required for this slice.
- Contracts use typed models with Zod validation at frontend boundaries.
