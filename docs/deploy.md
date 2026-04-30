# Deployment

This app deploys to Fly.io as a single machine named `bespoke-web` in the `ord`
region. The Docker image runs both services:

- Next.js listens on port `3000`.
- The Fly health check uses the Next.js `/health` endpoint.
- FastAPI listens inside the container on `127.0.0.1:8000`.
- Next.js proxies browser requests from `/api/*` to FastAPI.
- Alembic migrations run during container startup before the services boot.
- Fly keeps one machine running so health checks do not flap while all machines
  are stopped.

## Prerequisites

Install the Fly CLI and sign in:

```powershell
fly auth login
```

Make sure Docker Desktop is running before deploying from a local machine.

## Create the Fly App

The repository already includes `fly.toml` with:

```toml
app = "bespoke-web"
primary_region = "ord"
```

Create the app once:

```powershell
fly apps create bespoke-web --org personal
```

Use a different Fly org if this app belongs somewhere other than `personal`.

## Create Postgres

Create a Fly Postgres database in the same region:

```powershell
fly postgres create --name bespoke-db --region ord
```

Attach it to the app:

```powershell
fly postgres attach bespoke-db --app bespoke-web
```

The attach command sets `DATABASE_URL` on `bespoke-web`. The API reads this
value through `apps/api/app/core/config.py`.

## Configure Secrets

Confirm the app has a production database URL:

```powershell
fly secrets list --app bespoke-web
```

If a Redis instance is added later, set `REDIS_URL` as a secret:

```powershell
fly secrets set REDIS_URL="redis://example.internal:6379/0" --app bespoke-web
```

Do not set `NEXT_PUBLIC_API_BASE_URL` for Fly unless intentionally overriding
the checked-in `/api` proxy behavior.

## Deploy

Deploy from the repository root:

```powershell
fly deploy --app bespoke-web
```

The deploy uses:

- `Dockerfile` for the production image.
- `fly.toml` for Fly service settings.
- `infra/fly/start.sh` for migrations and process startup.

## Verify

Open the health endpoint:

```powershell
fly open /health --app bespoke-web
```

Expected response:

```json
{ "status": "ok" }
```

Confirm the API proxy is also healthy:

```powershell
fly open /api/health --app bespoke-web
```

Check logs if startup fails:

```powershell
fly logs --app bespoke-web
```

Common issues:

- `DATABASE_URL` is missing or points at an unavailable database.
- Alembic migration fails during startup.
- Docker Desktop is not running for local deploy builds.
- The Fly CLI is not installed or not authenticated.

## Update Deploys

After code changes, run local checks:

```powershell
Set-Location apps/web
npm run lint
$env:NEXT_PUBLIC_API_BASE_URL = "/api"
$env:INTERNAL_API_BASE_URL = "http://127.0.0.1:8000"
npm run build
Set-Location ../..
```

Then deploy:

```powershell
fly deploy --app bespoke-web
```
