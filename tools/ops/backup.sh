#!/usr/bin/env bash
# 生产每日全量备份:craft-agent 数据目录 + 密钥文件 + phoenix docker 卷,
# 打成单个 tar.gz 落 /home/craft/backups/,只保留最近 7 份。
#
# 打包内容(缺一个跳过,不炸全局;详情见运行日志):
#   - /home/craft/.craft-agent          agent 数据目录:user-workspaces(不可重建)、
#                                        agent-state.db、config.json、credentials.enc、
#                                        drafts.json、phoenix-api.env 均在此目录下
#   - /etc/craft-agent.env               生产环境变量(含密钥)
#   - /home/craft/component-data-app/.env  平台采集凭证
#   - /home/craft/.lark-cli/              飞书 CLI 凭证(含 master.key)
#   - phoenix docker 卷(volume 名 phoenix-data)→ 先导出成 phoenix-data.tar.gz 再一起打包
#
# 建议 root crontab(需要读 /etc 下的密钥文件 + 跑 docker,只有 root 稳定有权限):
#   30 3 * * * /opt/craft-ops/backup.sh >> /var/log/craft-backup.log 2>&1
#
# 恢复:sudo tar xzPf /home/craft/backups/craft-YYYYMMDD.tar.gz -C /
#      (phoenix-data.tar.gz 单独解到卷:docker run --rm -v phoenix-data:/v -v $PWD:/backup alpine tar xzf /backup/phoenix-data.tar.gz -C /v)
set -euo pipefail

BACKUP_DIR=/home/craft/backups
KEEP=7
STAMP="$(date +%Y%m%d)"
OUT="$BACKUP_DIR/craft-$STAMP.tar.gz"
WORK="$(mktemp -d /tmp/craft-backup.XXXXXX)"

trap 'rm -rf "$WORK"' EXIT

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

log "==> craft 每日备份开始(stamp=$STAMP)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# 1. phoenix docker 卷:容器内数据用 alpine 中转打包,不直接碰运行中容器
if command -v docker >/dev/null 2>&1 && docker volume inspect phoenix-data >/dev/null 2>&1; then
  log "==> 导出 phoenix-data docker 卷"
  docker run --rm -v phoenix-data:/v -v "$WORK:/backup" alpine \
    tar czf /backup/phoenix-data.tar.gz -C /v .
else
  log "!! 跳过 phoenix-data 卷(docker 不可用或卷不存在,非致命)"
fi

# 2. 汇总打包清单:路径不存在就跳过并记日志,不让单个缺失项炸掉整份备份
TAR_ITEMS=()
add_if_exists() {
  if [[ -e "$1" ]]; then
    TAR_ITEMS+=("$1")
  else
    log "!! 跳过不存在的路径:$1"
  fi
}

add_if_exists /home/craft/.craft-agent
add_if_exists /etc/craft-agent.env
add_if_exists /home/craft/component-data-app/.env
add_if_exists /home/craft/.lark-cli
[[ -f "$WORK/phoenix-data.tar.gz" ]] && TAR_ITEMS+=("$WORK/phoenix-data.tar.gz")

if [[ ${#TAR_ITEMS[@]} -eq 0 ]]; then
  log "!! 没有任何可打包的路径,中止"
  exit 1
fi

log "==> 写入 $OUT"
tar czPf "$OUT" "${TAR_ITEMS[@]}"
chmod 600 "$OUT"

log "==> 清理旧备份(保留最近 $KEEP 份)"
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/craft-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

log "==> 完成:$(du -h "$OUT" | cut -f1) $OUT"
