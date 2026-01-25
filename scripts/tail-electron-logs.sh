#!/bin/bash
# Tail Vesper Electron logs in real-time

LOG_FILE="$HOME/Library/Logs/@vesper/electron/main.log"

echo "Tailing Vesper logs: $LOG_FILE"
echo "Press Ctrl+C to stop"
echo ""

tail -f "$LOG_FILE"
