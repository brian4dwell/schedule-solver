# Schedule Solver

Internal scheduling foundation for CRNA and anesthesia coverage across surgery centers.

## Repo Layout

```text
apps/web      Next.js frontend
apps/api      FastAPI backend
apps/worker   Future background worker
packages      Future shared packages
infra/fly     Future Fly.io deployment notes
```

## Local Services

Start Postgres and Redis:

```bash
docker compose up -d postgres redis
```

## API

Python tooling is managed with `uv`.

Install and run the API:

```bash
cd apps/api
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Run migrations:

```bash
cd apps/api
uv run alembic upgrade head
```

Health check:

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{ "status": "ok" }
```

## Web

Run the frontend:

```bash
cd apps/web
npm run dev
```

The app expects the API at `http://localhost:8000` unless `NEXT_PUBLIC_API_BASE_URL` is set.

## First-Pass Scope

This implementation includes Centers, Rooms, and Providers CRUD. Availability, shift requirements, schedule generation, Clerk auth, and worker processing are intentionally left for later milestones.
