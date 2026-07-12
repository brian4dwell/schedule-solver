# Time Drift Fix Plan

Updated: 2026-07-12

## Problem

Schedule assignment times are drifting after save/load cycles.

Examples observed in saved drafts:

- A normal `07:00-15:00` shift became `12:00-20:00`.
- A later manual save turned `12:00-20:00` into `19:00-03:00`.
- Invalid same-day ranges such as `2026-11-05 23:00` to `2026-11-05 07:00` were persisted.
- The solver then treated those invalid ranges as non-overlapping because the stored end time was earlier than the stored start time.

There are no supported overnight shifts, so any `end_time <= start_time` schedule slot is invalid.

## Likely Root Cause

The app is mixing schedule wall-clock times with JavaScript and database datetime behavior.

Current facts:

- Schedule templates store `start_time` and `end_time` as `time without time zone`.
- Assignment and shift requirement migrations created `start_time` and `end_time` as `timestamp without time zone`.
- The SQLAlchemy model declares some of those fields as `DateTime(timezone=True)`, but the actual database columns are timezone-less.
- The API can serialize a timezone-less database timestamp as a string like `2026-11-05T12:00:00`.
- Browser JavaScript parses that string as local time when passed to `new Date(...)`.
- The UI then reads it with UTC methods such as `getUTCHours()`.
- Saving the board writes the shifted time back to the backend.

That creates a feedback loop where every reload/save can shift the time again.

## Product Decision

Schedule slot times should be modeled as local wall-clock schedule times, not absolute instants.

A schedule slot means:

```text
Thursday, 2026-11-05, 07:00-15:00
```

It should not mean:

```text
An instant range converted through the browser's local timezone.
```

Until overnight shifts become a real product requirement, the system should enforce:

```text
end_time > start_time
```

on the same schedule date.

## Correct Target Model

Prefer explicit wall-clock fields at API and UI boundaries:

```json
{
  "schedule_date": "2026-11-05",
  "start_time": "07:00",
  "end_time": "15:00"
}
```

The backend may construct datetimes internally for solver comparisons, but those datetimes should be derived from validated wall-clock values.

The frontend should not use JavaScript `Date` parsing to extract schedule clock labels.

## Implementation Plan

### 1. Stop Time Drift At The UI Boundary

Update schedule workspace time formatting so it does not use `new Date(value)` and `getUTCHours()` to display schedule times.

Instead:

- If the API still returns datetime strings, parse the `HH:mm` portion directly.
- Prefer returning `start_time` and `end_time` as `HH:mm` strings for assignment and template UI contracts.
- Use string/time helpers for schedule clock values.
- Keep browser timezone out of schedule clock rendering.

### 2. Stop Time Drift On Save

Update save payload construction so it sends stable wall-clock values.

The frontend should send:

```json
{
  "schedule_date": "2026-11-05",
  "start_time": "07:00",
  "end_time": "15:00"
}
```

or an equivalent backend contract that clearly treats those fields as wall-clock values.

Avoid building ISO datetimes in the browser for schedule slots.

### 3. Validate Backend Inputs Strictly

At all assignment and template write boundaries:

- Require `schedule_date`.
- Require `start_time`.
- Require `end_time`.
- Reject `end_time <= start_time`.
- Reject missing or malformed wall-clock times.

This applies to:

- Manual draft save.
- Template create/update.
- Template apply.
- Generate requests that include current board assignments.
- Provider eligibility checks.

### 4. Build Solver Input Backend-Side

The solver can keep using concrete datetime values for overlap comparison.

Those values should be constructed on the backend from:

```text
schedule_date + start_time
schedule_date + end_time
```

after validation.

Do not rely on frontend-generated ISO datetimes as the source of truth for solver time ranges.

### 5. Keep Hard Solver Guards

The solver should reject invalid ranges even if bad data slips through.

Keep or add:

- `invalid_shift_time_range` hard violation when a shift requirement has `end_time <= start_time`.
- Same-day provider assignment constraint so a provider cannot receive two same-day slots unless it is an explicitly allowed split-day pair.
- Existing overlap constraints for true time overlaps.

Allowed split-day pair should be narrow:

```text
first_half + second_half
same center
same schedule date
non-overlapping times
```

Everything else on the same day for the same provider should be rejected unless product requirements change.

### 6. Add Regression Tests

Backend tests:

- Reject template slot with `end_time <= start_time`.
- Reject saved assignment with `end_time <= start_time`.
- Solver returns `invalid_shift_time_range` for bad shift inputs.
- Solver rejects two full shifts for the same provider on the same day.
- Solver allows only the intentional first-half/second-half same-center split pair.
- Solver rejects first-half/second-half if the times overlap or centers differ.

Frontend tests:

- Time label helper returns `07:00` for a `07:00` API value in non-UTC timezones.
- Save payload preserves `07:00-15:00` exactly.
- Repeated load/save/load cycles do not change times.
- Tests should run with a non-UTC timezone such as `America/Denver`.

### 7. Audit Existing Data

Run a read-only audit for existing persisted bad data:

```sql
select
  sp.name,
  sv.version_number,
  sv.source,
  count(*) as invalid_count
from assignments a
join schedule_versions sv on sv.id = a.schedule_version_id
join schedule_periods sp on sp.id = sv.schedule_period_id
where a.end_time <= a.start_time
group by sp.name, sp.start_date, sv.version_number, sv.source
order by sp.start_date, sv.version_number;
```

Do not silently mutate old drafts.

Decide one of:

- Regenerate affected solver drafts.
- Delete throwaway drafts.
- Repair selected manual drafts with an explicit admin/data script.

Any repair script should report what it intends to change before writing.

### 8. Consider A Schema Migration

The current model and database are inconsistent:

- SQLAlchemy model says `DateTime(timezone=True)`.
- Existing database columns are `timestamp without time zone`.

Options:

1. Move assignment and shift requirement slot fields to `date + time + time` columns.
2. Keep datetime columns but make them explicitly timezone-aware and always serialize with offsets.
3. Add API-only wall-clock contracts while leaving persistence as datetime for now.

Preferred long-term model for scheduling is option 1:

```text
schedule_date date
start_time time without time zone
end_time time without time zone
```

This matches the domain and avoids browser timezone conversion entirely.

If option 1 is too large for the immediate fix, use option 3 first and keep strict backend validation.

## Shift Setup Page

A setup page is useful, but it should come after the time drift fix.

The page should define organization or center shift windows:

```text
Full shift: 07:00-15:00
1st half: 07:00-11:00
2nd half: 11:00-15:00
Short shift: configurable
```

Then:

- New dragged rooms use the configured full-shift window instead of hardcoded `07:00-15:00`.
- Selecting a shift type can update the slot's time window from setup values.
- Templates store references or resolved wall-clock times from those definitions.
- Provider availability options stay semantic: `full_shift`, `first_half`, `second_half`, `short_shift`.

The setup page should not be used as the primary fix for time drift. It reduces manual ambiguity, but timezone-safe contracts are still required.

## Rollout Order

1. Fix API/UI wall-clock contracts.
2. Add strict backend validation.
3. Add solver guards.
4. Add regression tests.
5. Audit existing bad data.
6. Repair or regenerate selected historical drafts.
7. Add shift setup page.
8. Consider persistence migration to `date + time + time`.

## Success Criteria

- A `07:00-15:00` slot remains `07:00-15:00` after repeated save/load cycles.
- No new assignments can be saved with `end_time <= start_time`.
- No solver run can produce or accept invalid time ranges.
- The same provider cannot be assigned to two same-day slots except an intentional valid split-day pair.
- Tests cover behavior in a non-UTC timezone.
