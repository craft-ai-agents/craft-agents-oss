#!/bin/bash
# trace 增量入库班车(craft cron 每 15 分钟)。
# 会话静默 30 分钟后灌入 Phoenix,灌过记档不重灌;Phoenix 不可达则本班跳过。
set -u
cd /home/craft
set -a
. /home/craft/.craft-agent/phoenix-api.env
set +a
export PATH=/home/craft/.local/bin:/usr/local/bin:/usr/bin:/bin
export UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple
exec uv run --with opentelemetry-sdk --with opentelemetry-exporter-otlp-proto-http \
  python3 /opt/craft-agents/tools/trace-ingest/ingest_sessions.py \
  --state /home/craft/.craft-agent/trace-ingest-state.json \
  --quiesce-min 30 --project craft-prod
