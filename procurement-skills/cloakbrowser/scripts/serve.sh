#!/usr/bin/env bash
# Start a long-lived stealth Chromium with a CDP endpoint other tools connect to.
# Default port 9222. Logs to /tmp/cloakserve.log, PID written to /tmp/cloakserve.pid.
#
# Usage:
#   serve.sh [--port 9222] [--humanize] [--proxy URL] [--geoip]
#
# Stop:
#   kill "$(cat /tmp/cloakserve.pid)"
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
nohup "$HERE/serve.py" "$@" > /tmp/cloakserve.log 2>&1 &
PID=$!
echo "$PID" > /tmp/cloakserve.pid
echo "started pid=$PID  log=/tmp/cloakserve.log"
