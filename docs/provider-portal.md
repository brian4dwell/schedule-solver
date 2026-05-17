# Provider Portal Plan

## Goal

Give Providers a focused self-service experience where they can accept an invite, authenticate with Clerk, submit weekly availability, and manage provider-visible preferences.

Give Schedulers visibility into whether a Provider is ready for scheduling operations.

## Scope

Include:

- Invite acceptance and account creation through Clerk.
- Secure Provider access to Provider-only data.
- Weekly availability entry and editing for draft schedule weeks.
- Provider-visible preference entry and editing.
- Scheduler visibility into Provider onboarding and readiness state.

Exclude:

- Manager-only hidden preference editing by Providers.
- Profile-completion gating state.
- Any fallback identity-linking behavior.

## Primary Users

- Provider.
- Scheduler.
- Administrator.

## Readiness State Model

Track onboarding and readiness with explicit states:

- `invited`.
- `accepted`.
- `availability_pending`.
- `active`.

State semantics:

- `invited` means an invitation exists and has not been accepted.
- `accepted` means the invite was accepted and Clerk authentication is established.
- `availability_pending` means the Provider account is linked but required week availability is incomplete for the active planning week.
- `active` means the Provider account is linked and required week availability is complete for the active planning week.

Do not include `profile_pending`.

Use week-aware readiness checks instead of profile-level completion checks.

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
- `unset` means incomplete availability for readiness checks.
- `none` means explicitly unavailable and counts as complete input.
- `none` and `unset` are exclusive.
- Published schedule weeks are read-only.
- Draft schedule weeks are editable.

Readiness logic:

- A required week is complete when no weekday is `unset`.
- If any required weekday is `unset`, readiness is `availability_pending`.
- If all required weekdays are set, readiness is `active`.

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

Provide a scheduler-facing readiness view with:

- Provider name.
- Readiness state.
- Last availability update timestamp.
- Active planning week completeness indicator.

Allow filtering by:

- `invited`.
- `accepted`.
- `availability_pending`.
- `active`.

## API And Contract Plan

Use explicit typed contracts at every boundary.

Frontend:

- Use Zod schemas for Provider portal form inputs and API response parsing.

Backend:

- Use Pydantic schemas for request and response contracts.
- Use explicit service-layer typed models for readiness evaluation inputs and outputs.

Suggested contract shapes:

- `ProviderReadinessState` enum.
- `ProviderWeeklyAvailabilityCompletion` structure.
- `ProviderPortalAvailabilityUpsertRequest`.
- `ProviderPortalPreferencesUpsertRequest`.
- `SchedulerProviderReadinessRow`.

## Data Model Additions

Add a Provider readiness projection that is derived from:

- Invite status.
- Identity link status.
- Required week availability completeness.

Use explicit columns or a materialized projection only if needed for query performance.

Keep source-of-truth availability in existing weekly availability tables.

## Notification Plan

Support notification triggers for:

- Invite sent.
- Invite reminder.
- Weekly availability reminder for required planning weeks.
- Availability completion confirmation.

## Audit And Observability

Record audit events for:

- Invite acceptance.
- Identity link creation.
- Weekly availability updates.
- Preference updates.

Include actor id, organization id, provider id, timestamp, and change summary.

## Delivery Phases

### Phase 1

- Clerk invite acceptance and authentication.
- Provider-to-identity link.
- Provider weekly availability CRUD for draft weeks.
- Provider-visible preferences CRUD.
- Readiness states and scheduler readiness list.

### Phase 2

- Reminder notifications.
- Stronger scheduler filtering and reporting.
- Additional audit detail views.

### Phase 3

- Explainability enhancements for providers.
- Expanded exception workflows for late availability changes.

## Acceptance Criteria

- Provider can authenticate via Clerk and is linked to exactly one Provider record per Organization.
- Provider can only access their own Provider portal resources.
- Provider can edit weekly availability for draft weeks.
- Provider cannot edit weekly availability for published weeks.
- Provider readiness is `availability_pending` when required week availability has any `unset` weekday.
- Provider readiness is `active` when required week availability has no `unset` weekdays.
- Scheduler can view and filter Providers by readiness state.
- Provider UI and APIs never expose manager-only preference fields.
