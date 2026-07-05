#!/bin/bash
# 生产健康巡检:9 项检查,状态翻转才告警(卡死失败每 6h 重提醒),searxng 连挂 2 班才报。
# root cron 每 5 分钟一班。告警通道:journald(必发)+ 飞书(配置了 /etc/craft-alert.env 才发)。
#
# /etc/craft-alert.env(可选,二选一):
#   FEISHU_CHAT_ID=oc_xxx    # 告警发到群
#   FEISHU_USER_ID=ou_xxx    # 或私聊某人
set -u
STATE_DIR=/var/lib/craft-ops
STATE="$STATE_DIR/health.state"          # 每行: name|status|consec_fails|last_alert_epoch
mkdir -p "$STATE_DIR"
touch "$STATE"
NOW=$(date +%s)
REALERT_S=$((6 * 3600))

declare -A PREV CONSEC LASTA
while IFS='|' read -r n s c a; do
  [ -n "${n:-}" ] || continue
  PREV[$n]=$s; CONSEC[$n]=${c:-0}; LASTA[$n]=${a:-0}
done < "$STATE"

notify() { # $1=level(❌/✅) $2=msg
  logger -t craft-health "$1 $2"
  if [ -f /etc/craft-alert.env ]; then
    # shellcheck disable=SC1091
    . /etc/craft-alert.env
    local target=()
    if [ -n "${FEISHU_CHAT_ID:-}" ]; then target=(--chat-id "$FEISHU_CHAT_ID")
    elif [ -n "${FEISHU_USER_ID:-}" ]; then target=(--user-id "$FEISHU_USER_ID")
    else return 0; fi
    sudo -u craft lark-cli im +messages-send --as bot "${target[@]}" \
      --text "[craft-prod] $1 $2" >/dev/null 2>&1 \
      || logger -t craft-health "feishu notify failed"
  fi
}

RESULTS=""  # name|status|detail 逐行累积
check() { RESULTS+="$1|$2|$3"$'\n'; }

# 1. systemd 单元
for u in craft-agent browserdepot mihomo cloudflared; do
  st=$(systemctl is-active "$u" 2>/dev/null)
  [ "$st" = active ] && check "svc.$u" ok "" || check "svc.$u" fail "systemd=$st"
done

# 2. docker 容器
for c in phoenix craft-docker-searxng-1; do
  st=$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)
  [ "$st" = true ] && check "docker.$c" ok "" || check "docker.$c" fail "running=$st"
done

# 3. 内存
avail_kb=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
if [ "${avail_kb:-0}" -lt 409600 ]; then
  check mem fail "available=$((avail_kb / 1024))MB (<400MB)"
else
  check mem ok ""
fi

# 4. 磁盘
pct=$(df --output=pcent / | tail -1 | tr -dc 0-9)
[ "${pct:-100}" -lt 85 ] && check disk ok "" || check disk fail "root=${pct}%"

# 5. 公网 webui
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://agent.inotoday.asia/ || echo 000)
case "$code" in 200|302) check webui ok "" ;; *) check webui fail "http=$code" ;; esac

# 6. 代理链(mihomo → 境外)
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 -x http://127.0.0.1:7899 https://www.gstatic.com/generate_204 || echo 000)
[ "$code" = 204 ] && check proxy ok "" || check proxy fail "generate_204=$code"

# 7. searxng 实测(静默死检测:0 结果 = 挂,连挂 2 班才告警)
n=$(curl -s --max-time 25 'http://127.0.0.1:8080/search?q=resistor%20datasheet&format=json' \
  | python3 -c 'import json,sys;print(len(json.load(sys.stdin).get("results",[])))' 2>/dev/null || echo 0)
[ "${n:-0}" -gt 0 ] && check searxng ok "" || check searxng fail "results=0"

# 8. larkdepot 缓存新鲜度(cron 0:17/12:17 双班,>15h = 至少缺一班)
age=$(sudo -u craft larkdepot status 2>/dev/null \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["cache"]["freshness"]["age_s"] or 10**9)' 2>/dev/null || echo err)
if [ "$age" = err ]; then
  check larkdepot fail "status 命令失败"
elif [ "$age" -gt 54000 ]; then
  check larkdepot fail "cache age $((age / 3600))h (>15h,sync cron 断了?)"
else
  check larkdepot ok ""
fi

# 9. craft-agent 子进程数(泄漏回归探测)
main=$(systemctl show -p MainPID --value craft-agent 2>/dev/null)
if [ -n "$main" ] && [ "$main" != 0 ]; then
  kids=$(pgrep -cP "$main" 2>/dev/null || true)  # pgrep -c 无匹配也打印 0(且退出 1),别再补一个
  kids=${kids:-0}
  [ "$kids" -lt 20 ] && check children ok "" || check children fail "count=$kids (回收器失效?)"
fi

# —— 状态机:翻转才告警;卡死失败 6h 重提醒;searxng 连挂 2 班才首报 ——
NEWSTATE=""
while IFS='|' read -r name st detail; do
  [ -n "$name" ] || continue
  prev=${PREV[$name]:-ok}
  consec=${CONSEC[$name]:-0}
  lasta=${LASTA[$name]:-0}
  if [ "$st" = fail ]; then
    consec=$((consec + 1))
    threshold=1; [ "$name" = searxng ] && threshold=2
    if [ "$prev" != fail ] && [ "$consec" -ge "$threshold" ]; then
      notify "❌" "$name 挂了:$detail"
      lasta=$NOW; prev=fail
    elif [ "$prev" = fail ] && [ $((NOW - lasta)) -ge $REALERT_S ]; then
      notify "❌" "$name 仍未恢复:$detail(持续告警)"
      lasta=$NOW
    elif [ "$consec" -lt "$threshold" ]; then
      prev=ok  # 还没到阈值,不算翻转
    fi
  else
    if [ "$prev" = fail ]; then
      notify "✅" "$name 已恢复"
    fi
    consec=0; prev=ok
  fi
  NEWSTATE+="$name|$prev|$consec|$lasta"$'\n'
done <<< "$RESULTS"
printf '%s' "$NEWSTATE" > "$STATE"

# 无参数吵闹模式:手动跑时看全貌
if [ "${1:-}" = "-v" ]; then printf '%s' "$RESULTS"; fi
