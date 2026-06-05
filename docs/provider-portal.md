# Provider Portal Plan

## Goal

Give Providers a focused self-service experience where they can accept an invite, authenticate with Clerk, submit weekly availability, and manage provider-visible preferences.

Give Admins visibility into Provider onboarding and open-week availability completeness.

## Scope

Include:

- Invite acceptance and account creation through Clerk.
- Secure Provider access to Provider-only data.
- Weekly availability entry and editing for draft schedule weeks.
- Provider-visible preference entry and editing.
- Admin visibility into Provider onboarding and open-week availability completeness.

Exclude:

- Manager-only hidden preference editing by Providers.
- Profile-completion gating state.
- Any fallback identity-linking behavior.

## Primary Users

- Provider.
- Administrator.

## Account State Model

Track long-lived Provider account lifecycle with explicit states:

- `invited`.
- `accepted`.
- `linked`.

State semantics:

- `invited` means an invitation exists and has not been accepted.
- `accepted` means the invite was accepted and Clerk authentication is established.
- `linked` means the Clerk identity is connected to one internal Provider record within an Organization.

Do not include `profile_pending`.

Do not include weekly availability completion in the account state machine.

Use week-aware availability checks instead of profile-level completion checks.

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
- `unset` means incomplete availability for completion checks.
- `none` means explicitly unavailable and counts as complete input.
- `none` and `unset` are exclusive.
- Provider Portal saves must not convert `unset` to `none`.
- Any `unset` to `none` save normalization is admin-interface-only behavior.
- Published schedule weeks are read-only.
- Draft schedule weeks are editable.

Completion logic:

- A required week is complete when no weekday is `unset`.
- If any required weekday is `unset`, that required week is incomplete.
- If all required weekdays are set, that required week is complete.
- A Provider's open-week availability is complete when every open required week is complete.
- A Provider's open-week availability is incomplete when any open required week is incomplete.

## Preferences Experience

Allow Providers to edit provider-visible preferences only.

Keep manager-only preference inputs and influence details out of Provider APIs and Provider UI.

Use neutral language for provider-visible explanations.

## Identity And Access Model

Create a one-to-one link between a Clerk user identity and an internal Provider record within an Organization.

Require tenant-scoped authorization checks for every Provider portal request.

Enforce that a Provider can only view and update their own availability and provider-visible preferences.

Add Provider Portal `me` routes backed by a `require_current_provider` dependency.

Require admin authentication for every admin-facing Provider invite, link, status, and reporting route.

Do not auto-link by loose matching rules.

## Admin Operations View

Provide an admin-facing Provider status view with:

- Provider name.
- Account state.
- Last availability update timestamp.
- Open-week availability completeness indicator.
- Incomplete open required week count.

Allow filtering by:

- `invited`.
- `accepted`.
- `linked`.
- Open-week availability complete.
- Open-week availability incomplete.

## API And Contract Plan

Use explicit typed contracts at every boundary.

Frontend:

- Use Zod schemas for Provider portal form inputs and API response parsing.

Backend:

- Use Pydantic schemas for request and response contracts.
- Use explicit service-layer typed models for account state and availability completion inputs and outputs.
- Use Provider Portal `me` routes for Provider self-service APIs.
- Use admin-only route dependencies for admin APIs.
- Keep Provider Portal availability persistence truthful by preserving or rejecting `unset`, not normalizing it to `none`.

Suggested contract shapes:

- `ProviderAccountState` enum.
- `ProviderWeeklyAvailabilityCompletion` structure.
- `ProviderPortalAvailabilityUpsertRequest`.
- `ProviderPortalPreferencesUpsertRequest`.
- `AdminProviderStatusRow`.

## Data Model Additions

Add an admin Provider status projection that is derived from:

- Invite status.
- Identity link status.
- Open required week availability completeness.

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
- Account states and admin Provider status list.

### Phase 2

- Reminder notifications.
- Stronger admin filtering and reporting.
- Additional audit detail views.

### Phase 3

- Explainability enhancements for providers.
- Expanded exception workflows for late availability changes.

## Acceptance Criteria

- Provider can authenticate via Clerk and is linked to exactly one Provider record per Organization.
- Provider can only access their own Provider portal resources.
- Provider can edit weekly availability for draft weeks.
- Provider cannot edit weekly availability for published weeks.
- Required week availability is incomplete when any required weekday is `unset`.
- Required week availability is complete when no required weekday is `unset`.
- Admin can view and filter Providers by account state.
- Admin can view and filter Providers by open-week availability completeness.
- Provider UI and APIs never expose manager-only preference fields.
