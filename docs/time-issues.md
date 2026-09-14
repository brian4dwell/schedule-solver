# Schedule Wall-Clock Times

Updated: 2026-09-14. Implemented and tested; cleanup and migration applied to the configured `bespoke` database. API and web deployed to `bespoke-web` as Fly release 134.

## Contract

Schedule slots represent a local calendar date and clock range:

```json
{
  "schedule_date": "2026-11-05",
  "start_time": "07:00",
  "end_time": "15:00"
}
```

Assignments and shift requirements use `date` plus `time without time zone` columns. Structure templates store a weekday and the same clock fields. API requests and responses use strict `YYYY-MM-DD` and `HH:mm` strings, validated by Pydantic and Zod. Datetimes, timezone suffixes, seconds, `24:00`, and ranges with `end_time <= start_time` are rejected.

The workspace passes clock strings directly through load, save, generation, eligibility, and template workflows. Monthly reports format the same clock values without JavaScript datetime conversion. Audit and publication timestamps remain instants.

The backend derives solver datetimes using each center's IANA timezone. Credential bounds and cross-center overlap use actual instants, while persistence and display retain the local clocks. Ambiguous or nonexistent DST clock values are rejected when resolving instants.

## Validation

- Validate assignment dates against their parent period before saving, generating, or checking eligibility; recheck at publication.
- Applying a template to a short period explicitly skips weekdays outside that period.
- Only a non-overlapping `first_half`/`second_half` pair at the same center is permitted for the same provider on the same schedule date. Manual eligibility, publish validation, and the solver share this rule.
- Database CHECK constraints enforce positive same-day ranges and minute precision.
- The solver retains invalid-range guards, and empty failed drafts cannot be published.
- Workspace saves preserve nullable rooms, requirement associations, provider restrictions, source, and notes.

## Migration Execution

On 2026-09-13, at the user's request, cleared the 187 obsolete drafts and their 2,587 assignments, 1,034 violations, 727 fairness events, and 3,876 fairness snapshots. Upgraded `bespoke` from `202609130001` to `202609130002`.

Verification at 22:02:54 UTC confirmed eight date/clock columns have the intended non-null types, all six new CHECK constraints are validated, and no invalid assignment ranges remain. Row counts and full-row checksums matched for all 22 retained tables, including 13 periods, 1,218 availability rows, and 11 template slots.

At the user's request, deployed the matching API and web application on September 14 as Fly release 134, image `deployment-01M2G15XBQ0H7MRJRK278JZ1AJ`. Startup migration checks completed successfully. Fly smoke and machine checks passed, and both public `/health` and `/api/health` returned HTTP 200 with `{"status":"ok"}`. Existing browser sessions should reload before editing schedules.

## Existing Drafts And Cutover

The inspected database contained 847 invalid assignments across 129 versions. All 187 versions were drafts. The user confirmed that old drafts are unnecessary, a full backup exists, and no other users are currently writing. Historical repair is intentionally omitted.

Migration `202609130002` follows the invitation-expiry migration `202609130001`. It converts valid retained values literally, fully validates the new constraints, and refuses invalid retained rows. It never deletes drafts automatically.

The separate cleanup command accepts an explicit selection file:

```json
{
  "organization_id": "<organization UUID>",
  "version_ids": ["<obsolete draft UUID>"]
}
```

From `apps/api`, using the intended database connection:

```powershell
uv run python -m app.cleanup_obsolete_drafts <selection.json>
uv run python -m app.cleanup_obsolete_drafts <selection.json> --apply
uv run alembic upgrade head
```

The first command previews counts without deleting rows. The apply command rechecks and locks selected versions, requires unpublished drafts, refuses external parent/job/fairness-state dependencies, and deletes only their dependent records in one transaction. Periods, provider availability, templates, and operational setup remain intact. Schema downgrade cannot recover deleted drafts; the existing backup is the recovery source.

Run cleanup and migration as part of a coordinated API/web cutover while app writes and solver jobs are idle. Old datetime clients must reload. Do not migrate the shared database while the deployed application still expects timestamp slot columns. Fly deployment requires an explicit request.

Create new schedules from the preserved templates after cutover. No clock-offset repair or old-draft reconstruction is necessary.

## Verification

Backend checks, from `apps/api`:

```powershell
# Optional isolated PostgreSQL server; tests create/drop a uniquely named test database.
$env:SCHEDULE_TEST_POSTGRES_URL = "postgresql+psycopg://postgres@127.0.0.1:<test-port>/postgres"
uv run pytest -q
uv run alembic heads
```

Without `SCHEDULE_TEST_POSTGRES_URL`, PostgreSQL integration tests are explicitly skipped. They never use the application's configured database implicitly.

Frontend checks, from `apps/web`:

```powershell
npm run test:scheduling
npm run test:workflows
npm run test:auth
npm run lint
npm run build
```

Scheduling tests run helpers and the actual board save handler in UTC, America/Denver, America/New_York, and Asia/Tokyo. They cover repeated round trips, DST transition dates, late evening times, template/report clocks, metadata preservation, and split-day rules. PostgreSQL tests cover the full migration chain, downgrade, invalid-data refusal, raw-write constraints, scoped cleanup, and save/read/generate/report round trips.

On September 13, all 223 backend tests passed, including seven PostgreSQL integration cases on a local PostgreSQL 18.4 test server. The inspected shared database runs PostgreSQL 16.15; the migration uses PostgreSQL 16-compatible SQL, but this run did not use a PostgreSQL 16 test server.

The detailed audit and implementation decisions are in [the remediation plan](plans/time-drift-remediation-2026-09-13.md). A configurable shift setup page remains separate future work.
