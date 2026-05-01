# Provider Needs UI Plan

## Goal

Create a Provider availability and needs CRUD system that lets schedulers capture when a Provider can work, when they cannot work, how much they should work, and what they prefer.

This feature should support statements like:

- I am only available Monday, Wednesday, and Friday.
- I need at least 2 shifts per week.
- I can work at most 4 shifts per week.
- I prefer Peds.
- I will work anything else in my skills.
- I need vacation time on April 12.

The UI should make hard constraints visually and structurally different from soft preferences.

The backend should remain the source of truth for whether a Provider can be assigned to a schedule slot.

## Product Language

Use `Provider Needs` as the user-facing feature name.

Use these concepts in the UI:

- Availability: when the Provider can work.
- Time off: dates or times the Provider cannot work.
- Workload limits: minimum and maximum shifts or hours over a period.
- Preferences: assignments the Provider likes or dislikes but can still work.
- Skills: work the Provider is qualified to do.

Do not make the user think about solver terms while editing these records.

## Placement In The App

Add Provider Needs inside the existing Provider workflow first.

Recommended navigation:

```text
Providers
  Provider detail
    Profile
    Credentials
    Skills
    Needs
```

The first implementation can keep Profile, Credentials, Skills, and Needs on one Provider edit page if tabs are too much for the current UI.

The Needs area should be the first durable CRUD surface for Provider constraints.

Later, add a schedule-wide view:

```text
Scheduling
  Provider Needs
```

That page should help schedulers review missing availability, conflicting limits, and upcoming time off across all Providers before generating a schedule.

## Information Architecture

The Provider Needs screen should have four sections.

### Weekly Availability

Purpose:

Capture the normal weekly pattern for when a Provider can work.

Recommended UI:

- A weekly grid with Monday through Sunday as rows.
- A checkbox or toggle for each day.
- Start and end time inputs for each enabled day.
- A quick action to copy one day's time range to selected days.
- A summary line showing the current rule in plain language.

Example:

```text
Available Monday, Wednesday, and Friday from 7:00 AM to 3:00 PM.
```

For the first pass, support one availability window per weekday.

Do not infer missing weekdays as available.

If the organization wants availability to be optional later, add an explicit Provider-level availability mode instead of relying on missing rows.

Recommended availability modes:

```text
available_only
unavailable_blocks_only
```

For this feature, use `available_only` when a Provider says "I only have M/W/F".

### Workload Limits

Purpose:

Capture how many shifts or hours the Provider should work in a scheduling period.

Recommended UI:

- A period selector with `Per week` as the first option.
- Numeric stepper for minimum shifts.
- Numeric stepper for maximum shifts.
- Optional numeric fields for minimum hours and maximum hours later.
- A validation message when maximum is lower than minimum.
- A summary line showing the current workload rule.

Example:

```text
Minimum 2 shifts per week. Maximum 4 shifts per week.
```

Initial fields:

```text
period
minimum_shifts
maximum_shifts
```

Recommended period values:

```text
week
schedule_period
```

Only add hours after shifts work end to end.

### Assignment Preferences

Purpose:

Capture soft assignment preferences without changing Provider skills.

Recommended UI:

- A list of room types the Provider is skilled for.
- A preference selector for each skill.
- A clear indication that unselected skills remain assignable.
- Optional notes for preference context.

Recommended preference values:

```text
prefer
neutral
avoid_if_possible
```

Example:

```text
Peds: Prefer
GI: Neutral
Ortho: Neutral
```

The statement "I prefer Peds but will work anything else in my skills" should be modeled as:

- Peds preference is `prefer`.
- Other skilled room types remain `neutral`.
- No skill is removed.
- No hard disallow rule is created.

Do not use preferences to decide whether the Provider is qualified.

Provider skills and credentials remain separate hard eligibility inputs.

### Time Off

Purpose:

Capture specific dates or date ranges when the Provider cannot work.

Recommended UI:

- A compact list of upcoming time-off records.
- Add button that opens a form or drawer.
- Date picker for start date.
- Date picker for end date.
- Full-day toggle.
- Start and end time inputs when full-day is off.
- Notes field.
- Edit and delete actions per record.

Example:

```text
April 12, selected schedule year - Vacation - Full day
```

Use explicit time off records for vacation.

Do not treat vacation as a soft preference.

The UI must store a full calendar date with a year.

For example, on April 30, 2026, an unqualified "April 12" request would be in the past unless the user selects April 12, 2027 or another future schedule year.

## Provider Needs Summary

At the top of the Needs screen, show a read-only summary.

Example:

```text
Available M/W/F, 7:00 AM-3:00 PM
2-4 shifts per week
Prefers Peds
Upcoming time off: Apr 12
```

The summary should update after each save.

If a Provider has no Needs configured, show a clear empty state:

```text
No availability, workload limits, preferences, or time off are configured.
```

Do not imply that missing needs mean the Provider is available.

## CRUD Behavior

Every section should support create, read, update, and delete.

Recommended behavior:

- Save each section independently.
- Show section-level saving and error states.
- Keep unsaved edits local to that section.
- Refresh the Provider Needs summary after save.
- Do not erase other needs when one section is saved.
- Confirm destructive deletes for time off and weekly availability rules.

The UI should not require saving the whole Provider profile just to update vacation or weekly availability.

## Validation

Use Zod contracts at frontend boundaries.

Recommended frontend schema files:

```text
apps/web/lib/schemas/provider-needs.ts
```

Recommended UI schemas:

```ts
export const weekdaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export const providerAvailabilityModeSchema = z.enum([
  "available_only",
  "unavailable_blocks_only",
]);

export const weeklyAvailabilityRuleSchema = z.object({
  id: z.string().uuid().optional(),
  weekday: weekdaySchema,
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  isActive: z.boolean(),
});

export const workloadLimitSchema = z.object({
  id: z.string().uuid().optional(),
  period: z.enum(["week", "schedule_period"]),
  minimumShifts: z.number().int().min(0),
  maximumShifts: z.number().int().min(0),
});

export const roomTypePreferenceSchema = z.object({
  id: z.string().uuid().optional(),
  roomTypeId: z.string().uuid(),
  preference: z.enum(["prefer", "neutral", "avoid_if_possible"]),
  notes: z.string().optional(),
});

export const providerTimeOffSchema = z.object({
  id: z.string().uuid().optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  isFullDay: z.boolean(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  reason: z.enum(["vacation", "personal", "education", "other"]),
  notes: z.string().optional(),
});
```

Add refinements for:

- End time must be after start time.
- End date must be on or after start date.
- Maximum shifts must be greater than or equal to minimum shifts.
- Partial-day time off must include start and end time.

Keep API schemas separate from form schemas when field casing or persistence shape differs.

## Backend Concepts Needed

The existing `provider_availability` table can store one-time blocks, but it is not enough for the full Provider Needs UI.

Add meaningful typed concepts instead of overloading one table for every need.

Recommended backend models:

```text
provider_availability_rules
provider_workload_limits
provider_room_type_preferences
provider_time_off
```

Recommended first-pass fields:

```text
provider_availability_rules
  id
  organization_id
  provider_id
  weekday
  start_time
  end_time
  availability_type
  is_active
  notes

provider_workload_limits
  id
  organization_id
  provider_id
  period
  minimum_shifts
  maximum_shifts
  is_active
  notes

provider_room_type_preferences
  id
  organization_id
  provider_id
  room_type_id
  preference
  notes

provider_time_off
  id
  organization_id
  provider_id
  start_time
  end_time
  reason
  notes
```

Use the existing `provider_availability` table only if it is intentionally narrowed to one-time availability blocks.

Do not hide recurring weekly availability inside JSON metadata.

## API Surface

Prefer Provider-scoped routes.

Recommended routes:

```http
GET    /providers/{provider_id}/needs

GET    /providers/{provider_id}/availability-rules
POST   /providers/{provider_id}/availability-rules
PATCH  /providers/{provider_id}/availability-rules/{rule_id}
DELETE /providers/{provider_id}/availability-rules/{rule_id}

GET    /providers/{provider_id}/workload-limits
POST   /providers/{provider_id}/workload-limits
PATCH  /providers/{provider_id}/workload-limits/{limit_id}
DELETE /providers/{provider_id}/workload-limits/{limit_id}

GET    /providers/{provider_id}/room-type-preferences
POST   /providers/{provider_id}/room-type-preferences
PATCH  /providers/{provider_id}/room-type-preferences/{preference_id}
DELETE /providers/{provider_id}/room-type-preferences/{preference_id}

GET    /providers/{provider_id}/time-off
POST   /providers/{provider_id}/time-off
PATCH  /providers/{provider_id}/time-off/{time_off_id}
DELETE /providers/{provider_id}/time-off/{time_off_id}
```

`GET /providers/{provider_id}/needs` should return a composed read model for the screen.

The write routes should remain specific so each section can save independently.

## Scheduling Semantics

Treat these as hard constraints:

- Provider is outside weekly availability when availability mode is `available_only`.
- Provider overlaps approved time off.
- Provider exceeds maximum shifts for the configured period.
- Provider is below minimum shifts in a complete generated schedule.

Treat these as soft constraints:

- Provider is assigned to a neutral skilled room type.
- Provider is not assigned to a preferred room type.
- Provider is assigned to `avoid_if_possible`.

Minimum shifts are special:

- During assignment eligibility for one slot, minimum shifts should not block selection.
- During solver generation and schedule publish validation, minimum shifts should be evaluated against the full schedule period.

Maximum shifts can be checked during single-slot assignment when enough schedule context is available.

Do not add fallback behavior that assigns a Provider outside hard constraints.

## UI Flow For The Example

For "I only have M/W/F":

1. Open Provider detail.
2. Go to Needs.
3. In Weekly Availability, enable Monday, Wednesday, and Friday.
4. Set the available time window for each enabled day.
5. Save Weekly Availability.

For "I want two shifts per week minimum, 4 maximum":

1. In Workload Limits, choose `Per week`.
2. Set minimum shifts to `2`.
3. Set maximum shifts to `4`.
4. Save Workload Limits.

For "I prefer Peds but will work anything else in my skills":

1. In Assignment Preferences, set Peds to `Prefer`.
2. Leave other skilled room types as `Neutral`.
3. Save Assignment Preferences.

For "I need vacation time on April 12th":

1. In Time Off, choose Add.
2. Set start date to April 12 in the correct schedule year.
3. Set end date to April 12 in the same schedule year.
4. Leave full-day enabled.
5. Set reason to Vacation.
6. Save Time Off.

## First UI Slice

Build the smallest useful version in this order:

1. Add Provider Needs schemas in the frontend.
2. Add Provider Needs API client functions.
3. Add a Needs section to the Provider detail page.
4. Add Weekly Availability CRUD.
5. Add Time Off CRUD.
6. Add Workload Limits CRUD.
7. Add Assignment Preferences CRUD.
8. Add the Provider Needs summary.
9. Add a schedule-wide Provider Needs review page.

Weekly Availability and Time Off should come before preferences because they affect hard eligibility immediately.

## Solver And Assignment Integration

Provider assignment eligibility should consume Provider Needs through one backend service.

Weekly availability and time off should extend the existing Provider eligibility checks.

Workload limits and preferences should feed solver candidate scoring and publish validation.

The solver should:

- Reject candidates outside hard availability.
- Reject candidates that overlap time off.
- Avoid candidates that exceed maximum workload.
- Prefer assignments that satisfy room type preferences.
- Prefer schedules that meet minimum workload when possible.
- Report unmet minimum workload as a structured violation when a full schedule cannot satisfy it.

## Acceptance Criteria

This feature plan is ready when:

- A scheduler can record normal weekly availability for a Provider.
- A scheduler can record Provider vacation or other time off.
- A scheduler can record minimum and maximum weekly shifts.
- A scheduler can mark Peds or another room type as preferred without removing other skills.
- The UI distinguishes hard constraints from soft preferences.
- Missing availability is not silently treated as available.
- Provider Needs are saved independently from the Provider profile.
- Zod contracts validate the frontend form and API boundaries.
- Backend contracts use typed request and response models.
- Schedule assignment validation and solver generation use the same Provider Needs rules.
