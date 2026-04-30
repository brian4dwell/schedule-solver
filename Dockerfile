# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS web-deps

WORKDIR /repo/apps/web

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS web-builder

ENV INTERNAL_API_BASE_URL=http://127.0.0.1:8000
ENV NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /repo/apps/web

COPY --from=web-deps /repo/apps/web/node_modules ./node_modules
COPY apps/web ./
RUN npm run build

FROM python:3.12-slim AS api-deps

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

COPY --from=ghcr.io/astral-sh/uv:0.8.13 /uv /uvx /bin/

WORKDIR /repo/apps/api

COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.12-slim AS runner

ENV HOSTNAME=0.0.0.0
ENV INTERNAL_API_BASE_URL=http://127.0.0.1:8000
ENV NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PATH=/repo/apps/api/.venv/bin:$PATH
ENV PORT=3000

WORKDIR /repo

COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=api-deps /repo/apps/api/.venv /repo/apps/api/.venv
COPY apps/api /repo/apps/api
COPY --from=web-builder /repo/apps/web/.next/standalone /repo/apps/web
COPY --from=web-builder /repo/apps/web/.next/static /repo/apps/web/.next/static
COPY --from=web-builder /repo/apps/web/public /repo/apps/web/public
COPY infra/fly/start.sh /repo/infra/fly/start.sh

RUN chmod +x /repo/infra/fly/start.sh

EXPOSE 3000

CMD ["/repo/infra/fly/start.sh"]
