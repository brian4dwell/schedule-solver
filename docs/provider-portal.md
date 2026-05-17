# Provider Portal Plan

## Goal

Give Providers a focused self-service experience where they can accept an invite, authenticate with Clerk, submit weekly availability, and manage provider-visible preferences.

Give Schedulers visibility into invite progress and week-by-week availability completion.

## Scope

Include:

- Invite acceptance and account creation through Clerk.
- Secure Provider access to Provider-only data.
- Weekly availability entry and editing for draft schedule weeks.
- Provider-visible preference entry and editing.
- Scheduler visibility into invite state and per-week availability status.

Exclude:

- Manager-only hidden preference editing by Providers.
- Profile-completion gating state.
- Profile-level availability state.
- Any fallback identity-linking behavior.

## Primary Users

- Provider.
- Scheduler.
- Administrator.

## Invite State Model

Track only invite and identity lifecycle state at the provider profile level.

Use explicit invite states:

- `invited`.
- `accepted`.

State semantics:

- `invited` means an invitation exists and has not been accepted.
- `accepted` means the invite was accepted and Clerk authentication is established.

Do not add profile-level readiness states for availability.

## Weekly Availability Status Model

Track availability status per schedule week.

Evaluate status separately for each required planning week.

Suggested per-week statuses:

- `availability_pending`.
- `availability_complete`.

Status semantics:

- `availability_pending` means at least one weekday remains `unset` for the required week.
- `availability_complete` means all weekdays were intentionally set for the required week.

This status is week-scoped and must not be persisted as a profile-level state machine.

## Weekly Availability Experience

Use schedule-week availability as the first-class workflow.

Use existing availability options:

- `full_shift`.
- `first_half`.
- `second_half`.
- `short_shift`.
- `none`.
- `unset`.

Rules:

- Providers must intentionally set each weekday.
- `unset` means incomplete availability for that week.
- `none` means explicitly unavailable and counts as complete input.
- `none` and `unset` are exclusive.
- Published schedule weeks are read-only.
- Draft schedule weeks are editable.

## Preferences Experience

Allow Providers to edit provider-visible preferences only.

Keep manager-only preference inputs and influence details out of Provider APIs and Provider UI.

Use neutral language for provider-visible explanations.

## Identity And Access Model

Create a one-to-one link between a Clerk user identity and an internal Provider record within an Organization.

Require tenant-scoped authorization checks for every Provider portal request.

Enforce that a Provider can only view and update their own availability and provider-visible preferences.

Do not auto-link by loose matching rules.

## Scheduler Operations View

Provide a scheduler-facing provider operations view with:

- Provider name.
- Invite state.
- Required planning weeks.
- Per-week availability status for each required week.
- Last availability update timestamp per week.

Allow filtering by invite state:

- `invited`.
- `accepted`.

Allow filtering by week availability status:

- `availability_pending`.
- `availability_complete`.

## API And Contract Plan

Use explicit typed contracts at every boundary.

Frontend:

- Use Zod schemas for Provider portal form inputs and API response parsing.

Backend:

- Use Pydantic schemas for request and response contracts.
- Use explicit service-layer typed models for weekly availability status evaluation inputs and outputs.

Suggested contract shapes:

- `ProviderInviteState` enum.
- `ProviderWeekAvailabilityStatus` enum.
- `ProviderWeeklyAvailabilityCompletion` structure.
- `ProviderPortalAvailabilityUpsertRequest`.
- `ProviderPortalPreferencesUpsertRequest`.
- `SchedulerProviderWeekAvailabilityRow`.

## Data Model Additions

Add week-scoped availability status projection derived from:

- Required planning week.
- Weekday availability values for that week.
- Invite state.

Use explicit columns or a materialized projection only if needed for query performance.

Keep source-of-truth availability in existing weekly availability tables.

Do not persist profile-level availability readiness state.

## Notification Plan

Support notification triggers for:

- Invite sent.
- Invite reminder.
- Weekly availability reminder for each required planning week with `availability_pending` status.
- Weekly availability completion confirmation when a week changes from `availability_pending` to `availability_complete`.
- Scheduler digest of providers with pending availability by week.

## Audit And Observability

Record audit events for:

- Invite acceptance.
- Identity link creation.
- Weekly availability updates.
- Weekly availability status transitions.
- Preference updates.

Include actor id, organization id, provider id, schedule week id, timestamp, and change summary.

## Delivery Phases

### Phase 1

- Clerk invite acceptance and authentication.
- Provider-to-identity link.
- Provider weekly availability CRUD for draft weeks.
- Provider-visible preferences CRUD.
- Scheduler view for invite state and per-week availability status.

### Phase 2

- Reminder notifications for pending weekly availability.
- Scheduler filtering and weekly status reporting.
- Additional audit detail views.

### Phase 3

- Explainability enhancements for providers.
- Expanded exception workflows for late availability changes.

## Acceptance Criteria

- Provider can authenticate via Clerk and is linked to exactly one Provider record per Organization.
- Provider can only access their own Provider portal resources.
- Provider can edit weekly availability for draft weeks.
- Provider cannot edit weekly availability for published weeks.
- A required week is `availability_pending` when any weekday is `unset`.
- A required week is `availability_complete` when no weekday is `unset`.
- Scheduler can view and filter providers by invite state.
- Scheduler can view and filter providers by per-week availability status.
- Provider UI and APIs never expose manager-only preference fields.
- System does not persist profile-level availability readiness state.
