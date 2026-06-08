# Security Review

Reviewed: 2026-06-06

Scope: current working tree for the Schedule Solver FastAPI API, Next.js app, provider portal invite flow, auth dependencies, deployment entrypoint, and dependency audit posture.

## Findings

### High: Organization scoping ignores the Clerk organization claim

`AuthenticatedUser` captures `organization_external_id` from Clerk `org_id`, but `get_current_organization_id` always returns the local default organization instead of resolving the Clerk organization to an internal `Organization` row. See `apps/api/app/core/auth.py:70`, `apps/api/app/core/auth.py:123`, `apps/api/app/dependencies.py:84`, and `apps/api/app/dependencies.py:88`.

Impact: any authenticated user from the configured Clerk instance is evaluated against the same internal tenant. For admin routes, an `org:admin` role from a Clerk organization is enough to administer the default Schedule Solver organization even though the backend does not prove that this Clerk org maps to the internal organization. For provider routes, invite acceptance also happens in the default organization.

Recommendation: require a Clerk `org_id` for production requests, resolve it through `Organization.clerk_org_id`, and return 403 or 404 when the org is missing or unmapped. Keep the fixed local organization path only for `auth_mode = "local"` in development. Add route tests proving users from unknown Clerk orgs cannot access admin routes, provider invite acceptance, or provider self-service routes.

### High: Provider invite tokens are long-lived and not single-use

The provider invite table stores `invite_token` in plaintext and has no expiry column. `create_or_reset_provider_invite` creates a token only when the invite row is first inserted; resetting an existing invite keeps the same token while clearing acceptance fields. `accept_provider_invite` looks up only by token and organization, then accepts it without checking invite status or expiration. See `apps/api/app/db/models/scheduling.py:160`, `apps/api/app/db/models/scheduling.py:171`, `apps/api/app/routers/provider_portal.py:273`, `apps/api/app/routers/provider_portal.py:283`, `apps/api/app/routers/provider_portal.py:298`, `apps/api/app/routers/provider_portal.py:403`, `apps/api/app/routers/provider_portal.py:411`, and `apps/api/app/routers/provider_portal.py:445`.

Impact: a leaked invite URL remains valid indefinitely. Re-sending or resetting an invite does not invalidate old copies. If a provider identity link is ever removed or recreated later, an old accepted token could become useful again.

Recommendation: add `expires_at`, `accepted_at`, and status checks to the acceptance path. Rotate the token on every reset. Accept only `status = "invited"` and unexpired invites, then consume the token atomically. Prefer storing a token digest rather than the raw token, with lookup by digest.

### High: Current Next.js and Clerk dependency tree has known high-severity advisories

`npm audit --omit=dev` reports high-severity vulnerabilities for `next` and `js-cookie` through `@clerk/shared`. This is especially relevant because protected page access depends on Clerk middleware in `apps/web/proxy.ts:1`, `apps/web/proxy.ts:10`, and `apps/web/proxy.ts:17`. The installed direct versions are `@clerk/nextjs` at `apps/web/package.json:12` and `next` at `apps/web/package.json:13`; the lockfile includes `js-cookie` at `apps/web/package-lock.json:339`.

Impact: the audit includes Next.js middleware/proxy bypass advisories, cache poisoning, XSS, SSRF, and denial-of-service advisories. A middleware bypass would directly affect this app's route protection model.

Recommendation: upgrade Next.js to a patched release and update Clerk packages so `@clerk/shared` no longer pulls the vulnerable `js-cookie` version. Re-run `npm audit --omit=dev`, `npm run lint`, and `npm run build` after the upgrade.

### Medium: Invite acceptance is not bound to the intended provider email

The invite record stores `email`, but acceptance only requires a valid Clerk session and the token. The backend does not compare the signed-in Clerk user's verified email address to `ProviderInvite.email`. See `apps/api/app/schemas/provider_portal.py:22`, `apps/api/app/schemas/provider_portal.py:25`, `apps/api/app/routers/provider_portal.py:403`, and `apps/api/app/routers/provider_portal.py:405`.

Impact: anyone who obtains the invite link can sign in with their own Clerk account and claim the provider profile. The token has high entropy, so guessing is unlikely; the risk is leakage through forwarded email, browser history, logs, screenshots, or copied generated links.

Recommendation: include verified email claims in `AuthenticatedUser` or fetch the Clerk user during acceptance, then require the authenticated user's verified email to match the invite email. If admins need to invite a different address, make that address explicit in the invite creation request and audit it.

### Medium: Security-sensitive account actions are not audited

The provider portal plan calls for audit events for invite acceptance, identity link creation, weekly availability updates, and preference updates in `docs/provider-portal.md`, but the current routes commit those changes without persisting an actor/timestamp/change summary audit record. Relevant write paths include `apps/api/app/routers/provider_portal.py:403`, `apps/api/app/routers/provider_portal.py:489`, and `apps/api/app/routers/provider_portal.py:568`.

Impact: account linking and provider-entered availability are security-sensitive and operationally sensitive. Without an audit trail, incident response and accidental-change investigation depend on database timestamps and application logs rather than a reliable domain record.

Recommendation: add an explicit audit event table or service with typed Pydantic inputs. Record actor user id, organization id, provider id, action type, timestamp, and a concise change summary for invite acceptance, identity link creation, provider preference replacement, and provider availability replacement.

## Positive Observations

- Most operational API routers use `dependencies=[Depends(require_admin_user)]`, and provider self-service routes use `require_current_provider`.
- Clerk session tokens are verified with RS256 and issuer validation when the frontend API URL or publishable key is configured.
- Production starts Uvicorn on `127.0.0.1:8000` behind the Next.js server, so the API is not directly exposed by the Fly service entrypoint.
- HTML email bodies escape user-controlled provider and schedule names before inserting them into markup.
- No live secrets were found in the repository search. Local Postgres defaults appear limited to development configuration and Alembic defaults.

## Checks Run

```powershell
rg -n "Depends\(|get_current|require_admin|require_current_provider|APIRouter|@router|@admin_router|@provider_router" apps/api/app/routers apps/api/app/dependencies.py apps/api/app/core/auth.py
rg -n "password|secret|token|api[_-]?key|PRIVATE|BEGIN|GMAIL|CLERK|DATABASE_URL|postgres:postgres" -S --glob '!apps/api/uv.lock' --glob '!apps/web/package-lock.json'
npm audit --omit=dev
uvx pip-audit --strict
```

Results:

- `npm audit --omit=dev`: 4 vulnerabilities reported, including high-severity Next.js and `js-cookie` advisories.
- `uvx pip-audit --strict`: no known Python vulnerabilities found.
- Secret scan: no committed live credentials found; only documented secret names, local defaults, and test values appeared.

## Recommended Fix Order

1. Bind backend organization scoping to Clerk `org_id`.
2. Patch the Next.js and Clerk dependency advisories.
3. Harden provider invite tokens with rotation, expiration, status checks, single-use acceptance, and digest storage.
4. Bind invite acceptance to the invited email address.
5. Add audit events for account linking, availability writes, and preference writes.
