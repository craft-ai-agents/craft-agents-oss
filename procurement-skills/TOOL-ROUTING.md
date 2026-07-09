# 采购工具路由（agent 契约层 · 唯一真相 · 无兼容双轨）

换工具先改本表，再改 `procurement-skills/AGENTS.md` 与各 SKILL。  
**实现仓 / 发版 / PATH / daemon** 写 monorepo 根目录 [`AGENTS.md`](../AGENTS.md)，不要写进 skill。

| 能力 | 唯一入口 | 禁止 |
|------|----------|------|
| 读本地库存 | `procurement-local-inventory-lookup` → `larkdepot` | 默认 `lark-cli` 直查；手搓变体逐表 |
| 读供应商档案 | `procurement-supplier-shortlist` → `larkdepot` | 同上 |
| 平台报价/库存证据 | `procurement-platform-search` → `component-data` | `scrape-engine`、`browserdepot`、临时 Playwright/curl 顶替 |
| 平台截图取证 | `component-data screenshot` | 另起浏览器进程 |
| 批量结果落地 | `procurement-batch-orchestration` → `larkdepot` state | 对话粘贴长结果、自建 JSONL |
| 紧急调度询价写回 | `procurement-dispatch-inquiry` → `larkdepot upsert` | 绕过 upsert 的 batch-create |
| 写 AI 线索表 | `procurement-feishu-table-fill` → `lark-cli`（仅 `AI-` 表） | 写业务主库表 |
| 认料（非货源） | WebSearch / WebFetch | 当库存/价格证据 |

`lark-cli` 仅用于：写 AI 表、单据、larkdepot 判定缓存不可用时的降级直查、附件上传等 skill 明示路径。
