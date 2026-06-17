#!/usr/bin/env bash
# =============================================================================
# 裸机 systemd 快速部署：本机构建 → rsync 到服务器 → systemctl restart。
#
# 为什么不在服务器构建：服务器内存 3.3G，扛不住 vite build（开 4G 堆）。
# server 入口是 bun 直跑 TS（无需构建）；只有 webui dist + 几个 cjs bundle 要本机构建。
#
# 前提：
#   - 已配 SSH 免密登录服务器（ubuntu 用户，sudo 免密）
#   - 服务器已完成首次迁移（/opt/craft-agents、craft 用户、/etc/craft-agent.env、
#     mihomo.service、craft-agent.service 就位）。首次迁移见
#     docs/superpowers/plans/2026-06-08-docker-to-systemd-migration.md
#
# 用法：
#   ./scripts/quick-deploy.sh            # 构建 + rsync + 服务器 bun install + 重启
#   ./scripts/quick-deploy.sh --no-deps  # 跳过服务器 bun install（确定依赖没变、想快一点）
#   ./scripts/quick-deploy.sh --no-build # 跳过本机构建（改了纯 TS 逻辑）
#   ./scripts/quick-deploy.sh --allow-dirty  # 明知工作树脏仍部署（带 WIP，慎用）
#
# 正规化（2026-06-17）：单一全量部署路径，skill 跟随整体一起上（不单独部署）。
#   - 默认**拒绝脏工作树**：全量部署会把整个工作目录推上生产，未提交的 WIP 也会跟着上。
#     所以先 commit 再部署；确实要带 WIP 才加 --allow-dirty。
#   - 部署后在服务器写 /opt/craft-agents/DEPLOYED_SHA，记录现网是哪个 commit。
#   - 大二进制（vendor/bun、resources/bin 下的 uv 等）走 rsync 排除，不上服务器。
# =============================================================================
set -euo pipefail

SERVER="${CRAFT_DEPLOY_SERVER:-ubuntu@124.222.62.164}"
REMOTE_APP=/opt/craft-agents
REMOTE_SKILLS=/home/craft/.agents/skills
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# skill 真源现在在仓库内（procurement-skills/），便于版本化开发管理
SKILLS_SRC="${SKILLS_SRC:-$ROOT/procurement-skills}"
cd "$ROOT"

# 依赖默认装：依赖变了却忘了装 = 服务器起不来（Cannot find module）。这类崩溃靠默认消除，
# lockfile 没变时 --frozen-lockfile 是秒级空跑。确定没改依赖想快可 --no-deps。
DO_BUILD=1; DO_DEPS=1; ALLOW_DIRTY=0
for a in "$@"; do
  case "$a" in
    --no-build) DO_BUILD=0 ;;
    --no-deps) DO_DEPS=0 ;;
    --deps) DO_DEPS=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
  esac
done

# 正规化守卫：全量部署 rsync 的是整个工作树，脏 = WIP 会上生产。默认拒绝。
DIRTY="$(git status --porcelain)"
if [[ -n "$DIRTY" && "$ALLOW_DIRTY" == 0 ]]; then
  echo "✋ 工作树有未提交改动，全量部署会把它们一起推上生产。"
  echo "   先 commit 再部署；确需带 WIP 才加 --allow-dirty。"
  echo "   未提交/未跟踪文件："
  git status --short | sed 's/^/     /'
  exit 1
fi
GIT_SHA="$(git rev-parse --short HEAD)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
DEPLOY_STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
[[ "$ALLOW_DIRTY" == 1 && -n "$DIRTY" ]] && GIT_SHA="$GIT_SHA-dirty"
echo "==> 部署 $GIT_BRANCH @ $GIT_SHA（$DEPLOY_STAMP）"

if [[ "$DO_BUILD" == 1 ]]; then
  echo "==> [1/4] 本机构建 bundle + webui"
  bun build packages/session-mcp-server/src/index.ts \
    --outfile packages/session-mcp-server/dist/index.js --target node --format cjs
  bun build packages/pi-agent-server/src/index.ts \
    --outfile packages/pi-agent-server/dist/index.js --target node --format cjs
  bun run scripts/build-wa-worker.ts
  NODE_OPTIONS="--max-old-space-size=4096" bunx vite build --config apps/webui/vite.config.ts
else
  echo "==> [1/4] 跳过构建（--no-build）"
fi

echo "==> [2/4] rsync 源码 + dist 到 $SERVER:$REMOTE_APP（排除 .git/node_modules）"
# 用 ubuntu 落到 /tmp 中转再 sudo 同步到 craft 属主目录（REMOTE_APP 属 craft）
rsync -az --delete \
  --exclude='.git/' --exclude='node_modules/' --exclude='build-skills/' \
  --exclude='.env' --exclude='*.tar.gz' \
  --exclude='vendor/' --exclude='resources/bin/' \
  -e ssh ./ "$SERVER:/tmp/craft-app-sync/"
ssh "$SERVER" "sudo rsync -a --delete \
  --exclude='node_modules/' \
  /tmp/craft-app-sync/ $REMOTE_APP/ && sudo chown -R craft:craft $REMOTE_APP"

echo "==> [3/4] rsync skill 真源 → $REMOTE_SKILLS（排除 AGENTS.md，它走全局指令位置）"
rsync -az --delete --exclude=__pycache__ --exclude='*.pyc' --exclude='AGENTS.md' \
  -e ssh "$SKILLS_SRC/" "$SERVER:/tmp/craft-skills-sync/"
ssh "$SERVER" "sudo mkdir -p $REMOTE_SKILLS && sudo rsync -a --delete \
  /tmp/craft-skills-sync/ $REMOTE_SKILLS/ && sudo chown -R craft:craft /home/craft/.agents"

# 业务总则 AGENTS.md → 全局指令位置（CRAFT_CONFIG_DIR/AGENTS.md），注入每个会话的 <global_instructions>
if [[ -f "$SKILLS_SRC/AGENTS.md" ]]; then
  echo "==> [3.6/4] 部署业务 AGENTS.md → /home/craft/.craft-agent/AGENTS.md"
  scp -q "$SKILLS_SRC/AGENTS.md" "$SERVER:/tmp/craft-agents-md"
  ssh "$SERVER" "sudo cp /tmp/craft-agents-md /home/craft/.craft-agent/AGENTS.md && sudo chown craft:craft /home/craft/.craft-agent/AGENTS.md && rm /tmp/craft-agents-md"
fi

if [[ "$DO_DEPS" == 1 ]]; then
  echo "==> [3.5/4] 服务器 bun install --frozen-lockfile"
  ssh "$SERVER" "cd $REMOTE_APP && sudo -u craft BUN_CONFIG_REGISTRY=https://registry.npmmirror.com /usr/local/bin/bun install --frozen-lockfile"
fi

echo "==> [4/4] 记录现网版本 + 重启 craft-agent"
# 写 DEPLOYED_SHA：现网到底跑哪个 commit，一眼可查
ssh "$SERVER" "echo '$GIT_SHA $GIT_BRANCH $DEPLOY_STAMP' | sudo tee $REMOTE_APP/DEPLOYED_SHA >/dev/null && sudo chown craft:craft $REMOTE_APP/DEPLOYED_SHA"
ssh "$SERVER" "sudo systemctl restart craft-agent && sleep 2 && sudo systemctl --no-pager -l status craft-agent | head -12"
echo "==> 完成（现网 $GIT_BRANCH @ $GIT_SHA）。验证："
HTTP="$(curl -s -o /dev/null -w '%{http_code}' https://agent.inotoday.asia/ || echo 000)"
echo "    HTTP $HTTP  （200/302 为正常；现网版本：ssh $SERVER 'cat $REMOTE_APP/DEPLOYED_SHA'）"
