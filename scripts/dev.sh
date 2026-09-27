#!/usr/bin/env bash
# Stop/start/restart the local apps/api + apps/web dev servers in one
# command. Mirrors budget-terry's scripts/dev.sh — see its comments for the
# stale-.next-cache lesson this also clears defensively.
#
# Usage:
#   scripts/dev.sh restart   (default — stop then start)
#   scripts/dev.sh start
#   scripts/dev.sh stop

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/.dev-logs"
API_LOG="$LOG_DIR/api.log"
WEB_LOG="$LOG_DIR/web.log"
API_PORT="${API_PORT:-4001}"
WEB_PORT="${WEB_PORT:-4000}"

mkdir -p "$LOG_DIR"

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Stopping process(es) on port ${port}: ${pids}"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

stop() {
  kill_port "$API_PORT"
  kill_port "$WEB_PORT"
}

start() {
  rm -rf "$ROOT_DIR/apps/web/.next"
  echo "Starting API on :$API_PORT ..."
  (cd "$ROOT_DIR/apps/api" && PORT="$API_PORT" pnpm run start:dev >"$API_LOG" 2>&1 &)
  echo "Starting web on :$WEB_PORT ..."
  (cd "$ROOT_DIR/apps/web" && PORT="$WEB_PORT" pnpm run dev >"$WEB_LOG" 2>&1 &)
  echo "Logs: $API_LOG , $WEB_LOG"
}

case "${1:-restart}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  *) echo "Usage: $0 {start|stop|restart}"; exit 1 ;;
esac
