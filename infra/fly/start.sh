#!/bin/sh
set -eu

api_host="127.0.0.1"
api_port="8000"
web_port="$PORT"

cd /repo/apps/api
alembic upgrade head
uvicorn app.main:app --host "$api_host" --port "$api_port" &
api_pid="$!"

cd /repo/apps/web
PORT="$web_port" node server.js &
web_pid="$!"

terminate() {
  kill "$api_pid" 2>/dev/null || true
  kill "$web_pid" 2>/dev/null || true
}

trap terminate INT TERM

while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 1
done

terminate
wait "$api_pid" 2>/dev/null || true
wait "$web_pid" 2>/dev/null || true
exit 1
