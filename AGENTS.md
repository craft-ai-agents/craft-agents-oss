# craft-agents-oss · 开发地图（给人 / 给写代码的 agent）

本文件是**本 monorepo 开发侧**说明，不注入采购会话的 `<global_instructions>`。  
采购业务总则在 [`procurement-skills/AGENTS.md`](procurement-skills/AGENTS.md)（部署到 prod：`~/.craft-agent/AGENTS.md`）。

```text
本仓 (craft-agents-oss)          私有仓（实现，不进 monorepo 编译）
├── packages/*  agent 壳         ├── component-data-app
├── apps/webui                   └── larkdepot
├── procurement-skills/          ← agent 操作手册 + 业务路由（无源码/发版细节）
└── AGENTS.md（本文件）          ← 开发：repo 在哪、怎么发版、PATH、daemon
```

## 外部工具：源码 / 发版 / 运行时

| 命令 (prod PATH) | 职责 | 源码 | 形态 / 发版 |
|------------------|------|------|-------------|
| `component-data` | 平台报价/库存/截图 | 私有 `cunninghamcard-bit/component-data-app` | Python/uv；常驻 `component-data.service`（暖浏览器池）；CLI 默认同源并发 |
| `larkdepot` | 飞书表本地缓存 + 写回 | 私有 `cunninghamcard-bit/larkdepot` | Rust musl 静态 binary；GitHub Release 分发；cron `larkdepot sync` |
| `lark-cli` | 飞书官方 CLI | 飞书侧工具链 | 写 AI 表、降级直查、附件等 skill 明示路径 |
| `cloakbrowser-python` | 隐身浏览器脚本解释器 | skill `procurement-skills/cloakbrowser/` | 仅 cloakbrowser skill，**不是**平台采集主路径 |

本机开发目录（若已 clone）：

- `~/Projects/component-data-app`
- `~/Projects/larkdepot`

prod 上命令在 PATH（通常 `/usr/local/bin/`）。agent skill **只写命令名与 envelope 契约**，不写私有 repo URL。

### component-data 运维要点

- 单元：`component-data.service`（见 app 仓 `deploy/`）
- CLI：`component-data <mpn> --json`；daemon 在则走 socket/队列，不在则进程内跑
- 截图：`component-data screenshot <url> <out.png>`
- 改 adapter / 加源：在 **component-data-app** 仓做，再发版到 prod PATH；本仓只改 `procurement-skills/component-data/SKILL.md` 契约说明（若有）

### larkdepot 运维要点

- 装/升级：`procurement-skills/larkdepot/references/setup.md`（Release 资产、seed、模板）
- 缓存库可重建；`agent-state` 不可乱删
- 改 CLI/schema：在 **larkdepot** 仓；本仓只改 skill 与 seed 配置（`larkdepot/config/`）

## 本仓职责切分

| 路径 | 给谁看 | 内容 |
|------|--------|------|
| [`procurement-skills/AGENTS.md`](procurement-skills/AGENTS.md) | 采购 agent（全局指令） | 找料顺序、工具路由、说话规矩 |
| [`procurement-skills/TOOL-ROUTING.md`](procurement-skills/TOOL-ROUTING.md) | 开发 + 改 skill 的人 | 能力 → 唯一入口（agent 契约层） |
| `procurement-skills/*/SKILL.md` | 采购 agent | 调用方式、字段语义、禁止借口表 |
| [`docs/ci-cd.md`](docs/ci-cd.md) | 开发 | CI/CD、自动部署 |
| **本文件** | 开发 | 私有仓、发版、PATH、daemon、边界 |

**禁止**：把「私有 repo / musl / GitHub Release / systemd unit 名」写进会注入会话的 skill 正文（agent 会复读给采购，且与「不暴露内部工具实现」冲突）。

## 常用开发命令

```bash
bun install --frozen-lockfile
bun run validate:contracts   # 路由硬切 + skill 合同测试
bun run ci:local             # 本地完整 CI 镜像
just deploy                  # main + CI 后全量部署（本机路径）
# 或：merge main → GitHub CI 绿 → Deploy production 自动发
```

生产机约定：`ubuntu@` / `craft` 用户、`/opt/craft-agents`、skills → `/home/craft/.agents/skills/`。详见 `docs/ci-cd.md`、`scripts/quick-deploy.sh`。

## 换工具时改什么（开发 checklist）

1. 实现仓发版 + prod PATH/服务  
2. [`TOOL-ROUTING.md`](procurement-skills/TOOL-ROUTING.md)  
3. 对应 `SKILL.md`（**只**契约，无源码行）  
4. [`procurement-skills/AGENTS.md`](procurement-skills/AGENTS.md) 路由句  
5. [`deploy/permissions.json`](deploy/permissions.json)  
6. eval skillSlug / context（若有）  
7. **本文件** 源码/发版表  

`bun run lint:procurement-routing` 拦 2–6 的活契约漂移；本文件靠 code review。
