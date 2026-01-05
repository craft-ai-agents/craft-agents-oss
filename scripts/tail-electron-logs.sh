#!/bin/bash
# Tail Electron main process logs with formatted output
tail -f ~/Library/Logs/Craft\ Agents/main.log | jq -r '(.timestamp | split("T")[1] | split(".")[0]) + " [" + (.level | ascii_upcase) + "] " + .scope + ": " + (.message | if type == "array" then .[0] else . end)'
