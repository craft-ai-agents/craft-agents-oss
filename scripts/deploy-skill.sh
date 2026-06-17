#!/usr/bin/env bash
# =============================================================================
# 单 skill 精确部署：从 committed HEAD 取该 skill 目录 → rsync 到生产，不构建。
#
# 为什么单独一个脚本：日常改的多是 skill（无需 build/重启），而工作树里常有大量
# 无关 WIP——全量 quick-deploy 会把 WIP 一起推上生产。本脚本只从 HEAD 导出指定
# skill 一个目录，blast radius 最小，跟工作树脏不脏无关。
#
# 用法：
#   ./scripts/deploy-skill.sh procurement-platform-search          # 推该 skill（不重启）
#   ./scripts/deploy-skill.sh procurement-platform-search --restart # 推 + 重启
#     （新增 skill 或改了 SKILL.md 描述/触发词时要 --restart 让 <available_skills> 刷新；
#       只改脚本逻辑/正文不用重启，脚本每次调用都从磁盘新鲜执行。）
# =============================================================================
set -euo pipefail

SERVER="${CRAFT_DEPLOY_SERVER:-ubuntu@124.222.62.164}"
REMOTE_SKILLS=/home/craft/.agents/skills
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NAME="${1:-}"
if [[ -z "$NAME" || "$NAME" == --* ]]; then
  echo "用法: $0 <skill-name> [--restart]"; exit 1
fi
shift
RESTART=0
for a in "$@"; do [[ "$a" == "--restart" ]] && RESTART=1; done

SKILL_DIR="procurement-skills/$NAME"
if ! git cat-file -e "HEAD:$SKILL_DIR" 2>/dev/null; then
  echo "✋ HEAD 里没有 $SKILL_DIR —— 名字写错，或这个 skill 还没 commit。"
  echo "   现有 skill：" && git ls-tree --name-only HEAD procurement-skills/ | sed 's#procurement-skills/##; s/^/     /'
  exit 1
fi
if [[ -n "$(git status --porcelain -- "$SKILL_DIR")" ]]; then
  echo "⚠️  $SKILL_DIR 有未提交改动——部署的是已提交版本(HEAD)，未提交的不会上生产。"
fi

GIT_SHA="$(git rev-parse --short HEAD)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
# 从 HEAD 导出该 skill 目录（只含已提交内容）
git archive HEAD "$SKILL_DIR" | tar -x -C "$STAGE"

echo "==> 部署 skill '$NAME' @ HEAD $GIT_SHA → $SERVER:$REMOTE_SKILLS/$NAME"
rsync -az --delete --exclude=__pycache__ --exclude='*.pyc' --exclude='AGENTS.md' \
  -e ssh "$STAGE/$SKILL_DIR/" "$SERVER:/tmp/skill-sync-$NAME/"
ssh "$SERVER" "sudo rsync -a --delete /tmp/skill-sync-$NAME/ $REMOTE_SKILLS/$NAME/ \
  && sudo chown -R craft:craft $REMOTE_SKILLS/$NAME && rm -rf /tmp/skill-sync-$NAME"

if [[ "$RESTART" == 1 ]]; then
  echo "==> 重启 craft-agent"
  ssh "$SERVER" "sudo systemctl restart craft-agent && sleep 2 && sudo systemctl is-active craft-agent"
fi
echo "✅ 完成：skill '$NAME' @ $GIT_SHA 已上生产$([[ "$RESTART" == 1 ]] && echo '（已重启）')。"
