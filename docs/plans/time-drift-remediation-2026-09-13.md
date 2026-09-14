# Schedule wall-clock time remediation

Updated: 2026-09-14. Status: implementation, tests, configured-database cleanup/migration, and Fly application deployment complete.

This plan addresses finding **1** in [the deep code review](../reviews/deep-code-review-2026-09-13.md) and [time-issues.md](../time-issues.md). It includes the time-related period and same-day validation gaps in findings 14 and 15. The other review findings remain separate work.

**Recommendation:** implement the explicit wall-clock contract and migrate assignments and shift requirements to `date + time + time` together. Clear the obsolete draft versions in a scoped rollout cleanup, then enforce fully validated database constraints and start fresh schedules from templates. Focus implementation on preventing future drift.

**User decision, 2026-09-13:** old schedule drafts will not be needed. Historical repair, successor-draft reconstruction, and special support for corrupt historical reads are out of scope. The scoped cleanup was subsequently completed as recorded below.

**Rollout conditions confirmed by the user:** a full database backup already exists, and no other users are currently writing to the database. Proceed as one coordinated implementation and cutover; no separate backup-preparation or multi-user rollout phase is needed. These conditions do not replace implementation tests or coordination of any running solver jobs.

## Implementation result

Implemented migration `202609130002`, strict Pydantic/Zod date and clock contracts, workspace/report clock handling, shared same-day validation, center-timezone instant conversion, and the explicit draft cleanup command. The full backend suite passed with **223 tests**, including **7 PostgreSQL integration cases**. PostgreSQL tests ran on a separate local 18.4 server; the original inspected database is 16.15. Frontend scheduling tests exercise **17 checks in each of four timezones**, including the actual board save handler.

The steps below record the implementation design and cutover procedure. See [time-issues.md](../time-issues.md) for the implemented contract, cleanup commands, and test commands. Cleanup, migration, and deployment followed implementation under separate explicit user requests.

## Migration execution result

Applied to the configured `bespoke` database at the user's request on September 13. Removed the 187 obsolete draft versions and 2,587 assignments plus their dependent violations/fairness records. Alembic advanced from `202609130001` to `202609130002`. Verification at 22:02:54 UTC confirmed all eight date/clock columns, all six validated CHECK constraints, zero remaining invalid ranges, and unchanged row counts/checksums for 22 retained tables. No Fly deployment was performed.

## Deployment execution result

Deployed the matching API and web application at the user's request on September 14 to `bespoke-web`, Fly release 134, image `deployment-01M2G15XBQ0H7MRJRK278JZ1AJ`. The remote production build and startup migration checks succeeded. Fly smoke and machine checks passed; public `/health` and `/api/health` both returned HTTP 200 with `{"status":"ok"}`. Existing browser sessions should reload before editing schedules.

## Database evidence

Inspected the API-configured `bespoke` PostgreSQL database through `localhost:16380`. The listener belongs to an existing `fly mpg proxy` process. The local configuration labels its environment `development`; the proxy's destination was not independently matched to the deployed application's connection, so this report identifies the inspected database explicitly rather than assuming a production designation.

Queries ran in read-only transactions; the aggregate audit used repeatable-read isolation and a 20-second statement timeout. The final audit transaction began at **2026-09-13 20:42:44 UTC**. PostgreSQL is **16.15**, the session timezone is **UTC**, and Alembic is at **202607050001**. No database rows or schema were changed.

| Observation | Result | Consequence |
| --- | --- | --- |
| Assignments | 2,587 | Small enough for a rehearsed, coordinated schema conversion. |
| Invalid assignment ranges | **847**, across **129 versions** | Clear the obsolete drafts before adding fully validated range constraints. |
| Versions | 187, all `draft`: 113 manual and 74 solver | No published schedule was found in this database snapshot. |
| Invalid rows by version source | 531 manual; 316 solver | Both historical workflows contain bad data. This does not establish that today's solver still accepts those inputs. |
| Assignment timestamp dates disagreeing with `schedule_date` | 0 | Converting timestamp clock portions does not discard a different stored date in this snapshot. |
| Assignments outside their parent period | 0 | Still add the guard; review finding 14 reproduces the missing validation. |
| Assignment timestamps with nonzero seconds/fractions | 0 | Canonical minute precision can preserve all observed values. |
| Shift requirements / legacy provider availability | 0 / 0 rows | Requirement conversion has no current backfill ambiguity; legacy availability is not driving the observed drift. |
| Structure template slots | 11, all `full_shift`, `07:00–15:00` | Preserve templates for creating fresh schedules. |
| First-version assignments | 175, all `07:00–15:00` | Evidence of drift; historical reconstruction is unnecessary. |
| Relevant database range CHECK constraints | None | Persistence currently offers no last-line range protection. |
| Centers | 3, all `America/Denver` | Center timezone is available when an actual instant comparison is necessary. |
| Center credentials | 79; none has a start/expiry bound | Existing data does not exercise bounded credential datetime comparisons. Test these explicitly. |

Actual assignment and requirement columns are `timestamp without time zone`; their ORM fields declare `DateTime(timezone=True)`. Template slots already use `time without time zone`. Credential bounds use `timestamp with time zone`, so they cannot simply be compared with naive wall-clock datetimes after the fix.

Affected periods:

| Period starts | Versions | Assignments | Invalid assignments | Versions containing invalid assignments |
| --- | ---: | ---: | ---: | ---: |
| 2026-10-05 | 56 | 746 | 264 | 46 |
| 2026-10-12 | 24 | 357 | 95 | 21 |
| 2026-10-19 | 16 | 208 | 91 | 11 |
| 2026-10-26 | 7 | 109 | 39 | 5 |
| 2026-11-02 | 13 | 210 | 78 | 10 |
| 2026-11-09 | 12 | 144 | 46 | 6 |
| 2026-11-16 | 12 | 169 | 47 | 8 |
| 2026-11-23 | 13 | 175 | 45 | 6 |
| 2026-11-30 | 7 | 109 | 31 | 5 |
| 2026-12-07 | 10 | 152 | 50 | 4 |
| 2026-12-14 | 4 | 63 | 16 | 2 |
| 2026-12-21 | 8 | 99 | 30 | 4 |
| 2026-12-28 | 5 | 46 | 15 | 1 |

Twelve of the thirteen latest **nonempty** versions contain invalid ranges. The latest nonempty November 23 version has no reversed ranges; that alone does not establish correct intended times.

A concrete slot on November 5, identified by `room_slot_id = 013207e7-8991-4441-b17d-14864f114df7`, follows this history:

| Version | Stored clock range |
| --- | --- |
| 1 | 07:00–15:00 |
| 2 | 14:00–22:00 |
| 3 | 21:00–05:00, on the same date |
| 4 | 04:00–12:00 |
| 5 | 12:00–20:00 |
| 6 | 20:00–04:00, on the same date |

Parent/child slot comparisons also contain four-, six-, seven-, and eight-hour changes, including clock wraparound. These are consistent with the reported feedback loop, but stored history does not prove the browser timezone or intent of every edit. Valid-looking ranges can already be shifted, and no single inverse offset reliably repairs the database.

## 1. Define one contract before changing consumers

Use this JSON shape for assignment writes/reads, generation board inputs, eligibility requests, template application, and report assignment records:

```json
{
  "schedule_date": "2026-11-05",
  "start_time": "07:00",
  "end_time": "15:00"
}
```

Templates retain `weekday` in place of `schedule_date` until applied. Persisted requirements gain `schedule_date`.

- Define a reusable Pydantic wall-clock field with strict `HH:mm` input, no offset, and explicit `HH:mm` serialization. Reject datetime strings, `Z`, offsets, numeric coercion, `24:00`, malformed values, and seconds. Do not rely on Pydantic's permissive default time parsing or default `HH:mm:ss` output.
- Define matching Zod date and clock schemas and infer frontend types from them. Add range validation to write contracts, including template writes.
- Require `end_time > start_time`, with both clocks on the explicit schedule date. No overnight normalization, inferred next day, or missing-time defaults.
- Use the same valid wall-clock range contract for persisted assignment reads and writes. No special corrupt-history read contract is needed after cleanup.
- Leave audit/event instants such as `created_at`, `published_at`, and job timestamps as datetime fields. Their broader ORM/schema inconsistencies are separate from schedule clock storage.

PostgreSQL has distinct date, time, and timestamp types; the proposed types directly encode the scheduling decision already recorded in `time-issues.md`. See [PostgreSQL 16 date/time types](https://www.postgresql.org/docs/16/datatype-datetime.html).

## 2. Carry the contract through every scheduling path

| Area | Primary files | Planned change |
| --- | --- | --- |
| API and UI contracts | `apps/api/app/schemas/schedule.py`, `apps/web/lib/schemas/schedule.ts`, `apps/web/lib/api.ts` | Change both sides together; give eligibility its missing explicit schedule date. |
| Workspace | `apps/web/components/schedules/schedule-workspace.tsx` | Replace `timeLabelFromDateTime`, `dateTimeForAssignment`, and `assignmentDateTimeRange` usage with clock strings; derive weekday from `schedule_date`. Cover load, save, template apply, generation, and provider selection. |
| Persistence | `apps/api/app/db/models/scheduling.py`, new Alembic revision | Use `Date` plus `Time(timezone=False)` for assignments and requirements. |
| Route orchestration | `apps/api/app/routers/schedules.py` | Remove UTC-labelled template datetime construction and datetime date-rewriting helpers. Preserve existing slot-date identity rules explicitly using dates. |
| Solver | `solver_contracts.py`, `solver_input_builder.py`, `solver.py`, `solver_persistence.py` under `apps/api/app/services/scheduling` | Construct typed internal ranges backend-side; filter requirements by date; persist the explicit schedule date and clocks. |
| Eligibility | `provider_eligibility_contracts.py`, `provider_eligibility.py` | Validate ranges before availability, credential, and conflict checks; update database overlap predicates for separate date/time fields. |
| Reporting/fairness | `apps/api/app/routers/reports.py`, report schemas, `apps/web/components/reports/monthly-availability-report.tsx`, `fairness.py` | Include explicit schedule dates, format clock values without `Date`, and replace weekday/date extraction from assignment timestamps. |

Extract frontend clock parsing/formatting and payload construction into small typed helpers that can be tested directly. Keep calendar-only date arithmetic separate from clock formatting. Continue using `useToast()` for save/generate failures and success feedback; show invalid clock ranges in their assignment rows.

Preserve provider, room, center, room-slot identity, shift type, requirement association, required provider type, source, and notes while rebuilding payloads. The inspected rows have no nullable-room or requirement/notes examples, but the API supports them; tests must cover them so this refactor does not perpetuate review finding 18.

Use a typed internal range derived from validated date/time values. Naive datetimes are acceptable for local calendar calculations, but do not label them UTC to satisfy a type. For actual instant comparisons, such as timezone-aware credential bounds or provider overlap between centers, explicitly resolve the range through the center's IANA timezone and compare UTC instants. Use the same conversion for solver and manual eligibility. Reject ambiguous/nonexistent local times where instant conversion is needed until a disambiguation policy exists; do not silently choose an offset. Retain the wall-clock values as the stored and displayed schedule.

## 3. Complete the shared time validation

Some safeguards from the July document already exist: `require_slot_end_after_start`, template range validation, the solver's `invalid_shift_time_range`, and solver same-day pair constraints. Extend and share these; do not build competing rules.

1. Reject malformed or reversed ranges at manual save, template create/update, template apply, generation input, and eligibility boundaries, including unassigned slots.
2. Check assignment dates against the parent period at save, apply, generation, and publish. A template weekday outside a short period must be reported explicitly as skipped with a reason, never silently moved to another date.
3. Recheck ranges before generation and publication, including unassigned slots. Surface authoritative violations in the review UI; retain solver guards as defense against invalid internal inputs.
4. Share the same-day rule across manual save validation, eligibility, publish, and solver: only one `first_half` plus one `second_half`, same provider, date and center, with non-overlapping ranges. Reject two full shifts, cross-center split pairs, overlapping halves, and three-slot combinations. Drafts may retain eligibility violations; publish remains strict.
5. Ensure a failed solve with schedule-level time blockers cannot become publishable merely because it has zero assignments. This is the time-related intersection with finding 6; the broader feasibility/coverage publication defect also needs its own fix.

## 4. Perform a coordinated persistence migration

Prefer the final model now. This database already has assignment dates, contains only 2,587 assignment rows, and has no persisted requirements. A separate temporary API adapter over timestamp storage would create a second conversion to maintain without materially simplifying the complete consumer changes.

Clear the obsolete drafts as a separate, explicit rollout operation before the schema migration. Keep environment-specific cleanup out of the reusable Alembic revision:

1. Use the full backup the user has already confirmed. Rehearse on an isolated PostgreSQL copy; no additional backup or bespoke lineage export is required for the confirmed scope.
2. Keep app writes idle during cutover, drain any running solver jobs, and run the scoped draft cleanup described below. No coordination with other users is currently needed. Under the migration transaction and appropriate locks, recheck column types and any remaining rows: valid ranges, timestamp dates equal to `schedule_date`, minute precision, and requirement same-day/date integrity. Abort on unexpected retained data rather than extending the deletion scope.
3. Change assignment `start_time` and `end_time` to `time without time zone`. The inspected obsolete assignment set should now be empty. For any separately retained valid rows, convert their literal clock portions and keep `schedule_date` unchanged. Do not use `AT TIME ZONE` for this conversion.
4. Add nullable `shift_requirements.schedule_date`; derive it from the original start timestamp where rows exist, after same-day preflight. Convert its clocks, then make the date non-null. Update dependent query ordering/index definitions as needed.
5. Add named, fully validated CHECK constraints for minute precision, valid clock bounds including exclusion of `24:00`, and `end_time > start_time` on assignments, requirements, and template slots. No `NOT VALID` constraint or deferred historical debt is needed. See [PostgreSQL ALTER TABLE constraint behavior](https://www.postgresql.org/docs/16/sql-altertable.html).
6. Verify the targeted obsolete versions and assignments are gone, invalid-range count is zero, all new constraints are validated, and preserved operational records and templates are unchanged. Verify exact date/clock preservation for any separately retained valid schedule data.

The schema migration must remain usable on other databases: it validates and converts retained valid data, and fails clearly if invalid data needs an explicit cleanup decision. It must not automatically delete every draft wherever Alembic runs.

Use one coordinated API/web cutover; a separately scheduled multi-user maintenance window is unnecessary under the confirmed conditions. Reload the user's browser after the update. Old clients will send datetime payloads and must receive a clear reload-required error, with no permissive dual-format parser. Keep writes idle and drain any solver jobs before changing column types, then resume with matching API and frontend contracts. The existing Fly startup path runs migrations automatically, so the release procedure must prevent old processes from writing during the change.

Implement and rehearse a downgrade that reconstructs timezone-less timestamps from `schedule_date + clock`, restores prior column types, and removes new constraints before dropping the added requirement date. The schema downgrade does not recreate deleted drafts; the backup is the recovery path if cleanup targeted the wrong data. Restoring the old application also restores its drift bug; keep writes paused if rollback is necessary. No Fly deployment is part of this planning task.

## 5. Clear obsolete drafts and start fresh

Use a one-time cleanup command scoped to the inspected organization and an explicit set of obsolete version IDs. Preview affected counts before execution and recheck the selected versions under the cleanup transaction. The audit found 187 draft versions, but do not hardcode that count or include newly created schedules automatically.

- Clear all selected obsolete drafts, including valid-looking shifted ranges. There is no need to identify their originally intended times.
- Require every selected version to remain a draft. Abort if a selected version has been published or has unexpected references from records outside the cleanup scope.
- Delete dependent constraint violations and draft fairness events/snapshots before assignments and versions. Inspect fairness-state links and parent-version links explicitly; preserve unrelated state and refuse unexpected published-history dependencies.
- Delete associated completed/failed jobs only when they belong exclusively to the selected drafts and have no remaining references. Drain active jobs before cleanup. Perform the cleanup in one transaction.
- Preserve schedule periods and provider weekly availability, along with providers, centers, rooms, credentials, preferences, and structure templates. Do not call the existing period-deletion endpoint: it also deletes weekly availability and the period itself.
- After the fixed release, create new boards from the preserved templates, then assign providers or generate schedules normally. Do not clone or regenerate from the discarded board snapshots.

No repair proposal types, offset inference, lineage reconstruction, historical inspection UI, or successor-draft workflow is required.

## 6. Verification and release gates

Add behavioral tests while implementing each layer:

- **Frontend:** run actual load/payload/formatting helpers in UTC, America/Denver, America/New_York, and a positive-offset zone. Repeat at least ten load/save cycles and assert exact date/clock equality. Cover late evening values and dates around the 2026 March and November DST transitions. Verify reports and template application too.
- **API:** test canonical JSON serialization, rejection of old datetime payloads and invalid clocks, reversed/equal ranges, period bounds, and eligibility requests with explicit dates.
- **PostgreSQL integration:** rehearse scoped cleanup followed by migration on representative old-schema data, including reversed ranges. Verify preserved operational data, correct column types, fully validated constraints, and rejection of raw invalid inserts/updates. Test migration preservation of retained valid data, explicit failure on retained invalid data, downgrade, and transaction rollback. Run under UTC and a non-UTC database session timezone; results must match.
- **Scheduling:** cover template → board → save → read → generate → save → report, same-day split rules, invalid persisted inputs, timezone-aware credential bounds, and manual/solver agreement. Verify publish blocks invalid ranges even on empty failed-solver versions.
- **Cleanup:** preview writes nothing; deletion remains scoped to selected obsolete drafts; published versions or external dependencies abort; periods, availability, and templates survive; transaction failure rolls back the cleanup.

Run backend tests through `uv run pytest` from `apps/api`. Add a dedicated frontend scheduling test command; the existing `test:auth` command does not cover this behavior. Run that command, `npm run lint`, `npm run test:auth`, and `npm run build` from `apps/web`. Use an isolated PostgreSQL test database, not the inspected shared database.

Before any deployment, require passing cleanup/migration rehearsal and complete round-trip tests. After an explicitly requested release, verify one newly created `07:00–15:00` draft through repeated reads/saves from a Denver browser, template application, generation, and reporting. Re-run the audit: invalid-range count must be zero and remain zero after these workflows.

Update `docs/project.md` and `docs/time-issues.md` when implementation lands. Record the new contract and the decision to discard obsolete drafts. A shift setup page remains separate later work.

## Audit queries to repeat before implementation

Run via the configured API connection using `uv run python`, with credentials kept out of output. These are read-only examples for the current timestamp schema:

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '20s';

SELECT current_database(), current_setting('TimeZone'), version_num
FROM alembic_version;

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('assignments', 'shift_requirements', 'schedule_structure_template_slots')
  AND column_name IN ('schedule_date', 'start_time', 'end_time')
ORDER BY table_name, column_name;

SELECT count(*) AS assignment_count,
       count(*) FILTER (WHERE end_time <= start_time) AS invalid_ranges,
       count(*) FILTER (
           WHERE start_time::date <> schedule_date
              OR end_time::date <> schedule_date
       ) AS mismatched_dates
FROM assignments;

SELECT sp.start_date, sv.status, sv.source,
       count(DISTINCT sv.id) AS version_count,
       count(a.id) AS assignment_count,
       count(a.id) FILTER (WHERE a.end_time <= a.start_time) AS invalid_count
FROM schedule_versions sv
JOIN schedule_periods sp ON sp.id = sv.schedule_period_id
LEFT JOIN assignments a ON a.schedule_version_id = sv.id
GROUP BY sp.start_date, sv.status, sv.source
ORDER BY sp.start_date, sv.status, sv.source;

ROLLBACK;
```

The audit results above describe this snapshot only. Implementation must recheck them under the migration lock; none of the zero-count findings is a permanent assumption.
