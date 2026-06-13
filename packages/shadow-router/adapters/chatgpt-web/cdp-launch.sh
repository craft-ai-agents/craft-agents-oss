#!/bin/bash
# Activate the free chatgpt-web lane: relaunch YOUR Chrome with a CDP port so the
# adapter can drive your real (logged-in, human-looking) chatgpt.com session.
# Your normal profile/tabs are preserved. Quits Chrome first (CDP needs a fresh start).
set -e
PORT="${1:-9222}"
osascript -e 'quit app "Google Chrome"' 2>/dev/null || true
sleep 2
open -a "Google Chrome" --args --remote-debugging-port="$PORT"
echo "Chrome relaunched with CDP on :$PORT."
echo "Make sure you're logged into chatgpt.com, then set in the gateway env:"
echo "  SHADOW_CHATGPT_CDP=http://127.0.0.1:$PORT"
echo "and enable providers.chatgpt-web in the config."
