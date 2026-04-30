#!/bin/sh
set -eu

api_host="127.0.0.1"
api_port="8000"
web_port="$PORT"
api_health_url="http://$api_host:$api_port/health"
api_startup_attempts="30"
api_startup_sleep_seconds="1"

cd /repo/apps/api
echo "Running API migrations"
alembic upgrade head
echo "Starting API on $api_health_url"
uvicorn app.main:app --host "$api_host" --port "$api_port" &
api_pid="$!"

api_startup_attempt="1"

while [ "$api_startup_attempt" -le "$api_startup_attempts" ]; do
  if python -c "import urllib.request; urllib.request.urlopen('$api_health_url', timeout=1).read()" 2>/dev/null; then
    echo "API health check passed"
    break
  fi

  if ! kill -0 "$api_pid" 2>/dev/null; then
    echo "API exited before health check passed"
    wait "$api_pid"
  fi

  api_startup_attempt="$((api_startup_attempt + 1))"
  sleep "$api_startup_sleep_seconds"
done

if [ "$api_startup_attempt" -gt "$api_startup_attempts" ]; then
  echo "API did not become healthy at $api_health_url"
  kill "$api_pid" 2>/dev/null || true
  wait "$api_pid" 2>/dev/null || true
  exit 1
fi

cd /repo/apps/web
echo "Starting web on port $web_port"
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
