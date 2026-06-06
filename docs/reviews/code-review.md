# Code Review

Reviewed: 2026-06-06

Scope: `origin/main...HEAD` (`12ce222 ui polish`), focused on the provider portal calendar availability changes.

## Findings

### Medium: Calendar Cancel does not discard the day edit

The calendar option buttons mutate workspace state immediately, but the modal's Cancel button only closes the modal. A provider can select a new availability option, click Cancel, then later save the week request and persist an availability change they thought was discarded.

References:

- `apps/web/components/providers/provider-calendar-availability-view.tsx:262`
- `apps/web/components/providers/provider-calendar-availability-view.tsx:273`
- `apps/web/components/providers/provider-portal-workspace.tsx:189`

Impact: providers can accidentally submit availability changes after using a control that normally means "throw this edit away." That is especially risky because the new week-request column has its own Save button, so an unrelated min/max save can also persist the canceled day edit.

Recommendation: either rename Cancel back to Close, or stage modal edits locally and only commit them to workspace state on Save & close.

### Low: Calendar hides weekends while completion still includes weekend unset values

The new calendar view filters Saturday and Sunday out, but backend completion still marks any day with `unset` as incomplete. If weekend availability is ever unset, the calendar can show Incomplete for a week with no visible way to fix the missing days in that view.

References:

- `apps/web/components/providers/provider-portal-utils.ts:43`
- `apps/web/components/providers/provider-portal-utils.ts:181`
- `apps/api/app/routers/provider_portal.py:117`

Impact: providers can get stuck with an incomplete week from the calendar view even after all visible weekdays are set. The week view can still fix it, but the calendar view no longer makes the remaining incomplete fields discoverable.

Recommendation: keep weekends visible when they affect completion, or make completion ignore weekends if weekends are intentionally out of scope for provider entry.

## Healthy Parts

- The refactor compiles cleanly.
- The new per-week request controls save through the existing provider portal API path.
- Frontend save boundaries still parse through the existing Zod availability contracts.

## Checks Run

```powershell
Set-Location apps/web
npm run lint
npm run build
```

Results:

- Frontend lint: passed.
- Frontend production build: passed.
