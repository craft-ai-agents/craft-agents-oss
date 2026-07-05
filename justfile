# craft-agents 运维/评测命令入口。装 just:sudo pacman -S just(CachyOS)
# 生产机 = craft-server(ubuntu@124.222.62.164,sudo 免密)

set shell := ["bash", "-cu"]

# 列出全部命令
default:
    @just --list

# ============ 部署 ============

# 全量部署(本机构建 webui + rsync + 服务器装依赖 + 重启 craft-agent)
deploy:
    ./scripts/quick-deploy.sh

# 快速部署(跳过构建和依赖:纯 TS/skill 改动)
deploy-fast:
    ./scripts/quick-deploy.sh --no-build --no-deps

# ops 脚本部署(healthcheck / trace-ingest → /opt/craft-ops,cron 引用那里,不随 quick-deploy)
deploy-ops:
    scp -q tools/ops/healthcheck.sh tools/ops/trace-ingest.sh tools/trace-ingest/ingest_sessions.py craft-server:/tmp/
    ssh craft-server 'sudo install -m 755 -o root -g root /tmp/healthcheck.sh /opt/craft-ops/healthcheck.sh \
      && sudo install -m 755 -o craft -g craft /tmp/trace-ingest.sh /opt/craft-ops/trace-ingest.sh \
      && sudo install -m 644 -o craft -g craft /tmp/ingest_sessions.py /opt/craft-agents/tools/trace-ingest/ingest_sessions.py \
      && rm -f /tmp/healthcheck.sh /tmp/trace-ingest.sh /tmp/ingest_sessions.py && echo ops-deployed'

# ============ 评测(Phoenix @ https://phoenix.inotoday.asia)============

# 回归池实跑(发版闸,真 agent;需先 just eval-workspace 且本地有 LLM 连接)
eval *ARGS:
    cd packages/eval && env $(grep -v '^#' .env.phoenix | xargs) \
      bun run src/cli.ts --dataset craft-regressions --experiment "reg-$(date +%m%d-%H%M)" {{ARGS}}

# 回归池干跑(判分器/接线冒烟,不起 agent、experiment 不落库)
eval-dry:
    cd packages/eval && env $(grep -v '^#' .env.phoenix | xargs) \
      bun run src/cli.ts --runner dry-run --dataset craft-regressions --phoenix-dry-run

# 替代料标注集(20 case 黄金参考答案)
eval-substitutes *ARGS:
    cd packages/eval && env $(grep -v '^#' .env.phoenix | xargs) \
      bun run src/cli.ts --cases cases/procurement-substitutes.yaml --scenario substitutes --dataset craft-substitutes {{ARGS}}

# 确保本地 eval workspace 存在(real runner 前置)
eval-workspace:
    cd packages/eval && bun run workspace:ensure

# ============ 生产观测 ============

# 健康巡检全量输出(13 项)
prod-health:
    ssh craft-server 'sudo /opt/craft-ops/healthcheck.sh -v'

# 服务/内存/子进程一眼看
prod-status:
    ssh craft-server 'systemctl is-active craft-agent browserdepot mihomo cloudflared | paste -sd" " -; \
      free -h | sed -n 2p; \
      echo "agent children: $(pgrep -cP $(systemctl show -p MainPID --value craft-agent) 2>/dev/null || echo 0)"'

# 追生产日志(craft-agent)
prod-logs *ARGS='-n 50':
    ssh craft-server 'sudo journalctl -u craft-agent --no-pager {{ARGS}}'

# 手动触发一班 trace 入库(平时 cron 每 15 分钟自动跑)
trace-ingest:
    ssh craft-server 'sudo -u craft /opt/craft-ops/trace-ingest.sh'

# trace 管道状态:最近入库日志 + Phoenix 计数
trace-status:
    ssh craft-server 'sudo -u craft tail -4 /home/craft/.craft-agent/trace-ingest.log'
    cd packages/eval && env $(grep -v '^#' .env.phoenix | xargs) bash -c \
      'curl -s -H "Authorization: Bearer $PHOENIX_API_KEY" -H "Content-Type: application/json" \
        -X POST "$PHOENIX_HOST/graphql" \
        -d "{\"query\":\"{ projects { edges { node { name traceCount } } } }\"}"' | head -c 400; echo

# 生产 searxng 实测(静默死自检)
searxng-test:
    ssh craft-server 'curl -s --max-time 25 "http://127.0.0.1:8080/search?q=resistor&format=json"' \
      | python3 -c 'import json,sys; print("results:", len(json.load(sys.stdin).get("results",[])))'

# ============ 质量 ============

# 三个动过刀的包的类型检查
typecheck:
    cd packages/shared && bun run tsc --noEmit
    cd packages/server-core && bun run tsc --noEmit
    cd packages/eval && bun run typecheck
