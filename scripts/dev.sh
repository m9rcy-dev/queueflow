#!/usr/bin/env bash
# Stop/start/restart the local apps/api + apps/web dev servers in one
# command. Mirrors budget-terry's scripts/dev.sh — see its comments for the
# stale-.next-cache lesson this also clears defensively.
#
# Usage:
#   scripts/dev.sh restart   (default — stop then start)
#   scripts/dev.sh start
#   scripts/dev.sh stop
#   scripts/dev.sh lan       (restart for testing from a phone on the same Wi-Fi:
#                             email links use this Mac's IP instead of localhost)

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
  # WEB_APP_URL (email links) and API_PUBLIC_URL (email QR images) are only overridden in
  # `lan` mode; otherwise apps/api/.env decides.
  (cd "$ROOT_DIR/apps/api" && env PORT="$API_PORT" ${LAN_WEB_URL:+WEB_APP_URL="$LAN_WEB_URL"} ${LAN_API_URL:+API_PUBLIC_URL="$LAN_API_URL"} pnpm run start:dev >"$API_LOG" 2>&1 &)
  echo "Starting web on :$WEB_PORT ..."
  (cd "$ROOT_DIR/apps/web" && PORT="$WEB_PORT" pnpm run dev >"$WEB_LOG" 2>&1 &)
  echo "Logs: $API_LOG , $WEB_LOG"
}

case "${1:-restart}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  lan)
    LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
    if [ -z "$LAN_IP" ]; then echo "Couldn't find this Mac's Wi-Fi IP address."; exit 1; fi
    LAN_WEB_URL="http://${LAN_IP}:${WEB_PORT}"
    LAN_API_URL="http://${LAN_IP}:${API_PORT}"
    stop; start
    echo ""
    echo "On your phone (same Wi-Fi), open: ${LAN_WEB_URL}"
    echo "Email links now point there too. QR codes printed from that address work on the phone."
    ;;
  *) echo "Usage: $0 {start|stop|restart|lan}"; exit 1 ;;
esac
