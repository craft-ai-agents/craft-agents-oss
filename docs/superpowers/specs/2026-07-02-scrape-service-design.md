# scrape-service 设计文档 — 平台搜索链路服务化重写

日期：2026-07-02
状态：已与用户逐节评审通过，待实现规划
取代：`procurement-skills/scrape-engine/`（3 层单次进程引擎，含 CUTOVER.md 未完成的切换债）

## 0. 决策记录（用户拍板，不再重议）

1. **方案 B**：链路 + 引擎全部重写，形态为常驻服务。引擎内核（加权 gate、host 锁、defense profile）**概念保留、代码重写**——现有代码假设"一次进程跑一批"，与"池跨 job 常驻"的生命周期模型不兼容。
2. **首轮必须全量**：`direct` 集合（当前 32 源）逐平台直查是业务承诺，不可用聚合器覆盖代替。调度可以结构化优先，覆盖不可缩水。
3. **在途改动搁置**：分支 `optimize/procurement-substitute-eval` 上未提交的链路修补（batch_results、超时恢复 SKILL 段落、prompt 契约测试）不落地，重设计一步到位。其中"人肉超时恢复流程"被本设计的 job 机制整体取代。

## 1. 动机（盘点得出的痛点，均有 file:line 证据）

- 归一化（去重/合并/状态分类/型号核对）写在 SKILL.md 自然语言里，靠 LLM 执行，无确定性兜底。
- 源元数据重复维护 4 处（source_catalog.yaml / README.md / CUTOVER.md / adapter docstring），已实际漂移：README 记 34 adapter 实为 36，avnet/arrow/newark/element14-cn 的 mode 全部记错。
- 36 源中 18 个 body-dump（整页文本进 `note`），信息密度低，解析外包给 LLM。
- 全量 direct 常超时，恢复流程 = prompt 教 agent 人肉分块补跑；引擎无分块/断点/落盘。
- 每次调用冷启动 Chromium、重做 PerimeterX warmup，反爬源延迟与成功率受损。
- CUTOVER 五项 prod 冒烟（API/Akamai/PerimeterX/DataDome/OOM）从未通过，旧脚本兜底未删。

服务化一次性回答前五条；第六条作为本次切换 gate 一并偿还。

## 2. 总体形态

```
agent 对话                          prod 4C4G ubuntu 22.04
┌──────────────┐   SQLite (WAL)    ┌────────────────────────┐
│ scrape CLI   │ ←───────────────→ │ scrape-service daemon  │
│ submit/status│   jobs/source_runs│ (systemd 第三服务,      │
│ /results/    │   /rows           │  Python asyncio 常驻)  │
│ sources      │                   │ 浏览器池+调度器+归一化  │
└──────────────┘                   └────────────────────────┘
```

- **一个 daemon + 一个瘦 CLI + 一个 SQLite，不走 HTTP/gRPC**。CLI 往 `jobs` 表插行，daemon 轮询领任务（1s 间隔），结果写表，CLI 直接读。单机进程间通信用共享 SQLite（WAL 模式）足够。
- 语言 Python asyncio（cloakbrowser/Playwright 仅有 Python 实现，无可选项）。解释器沿用 `/usr/local/bin/cloakbrowser-python`。
- 代码新目录 `procurement-skills/scrape-service/`；旧 `scrape-engine/` 原样服役至 cutover gate 通过。
- daemon 崩溃恢复：启动时把遗留 `running` 状态的 source_run 重置为 `pending` 重跑；job 状态由 source_runs 聚合推导，无独立状态机。

## 3. 核心数据结构

### 3.1 catalog v2 —— 唯一事实源

`source_catalog.yaml` 收编所有源元数据：`id / display_name / channel_type / tier / status / mode / defense / needs_proxy / caveat / verified_at / covers / covered_by / replacements`。

- adapter 文件（`adapters/<id>.py`）只剩纯函数：`url(part)` + `extract(payload, part)`（api 模式外加 `api_fetch`，script 模式为 `script_extract`）。**mode/defense/needs_proxy 不再写在 adapter 里**。
- daemon 启动做双向校验：catalog 里 status∈{enabled,limited} 的源必须有 adapter，adapter 必须在 catalog 有条目且字段合法（enum 校验），任何一边缺失 **拒绝启动**（fail loud，不静默漏选）。
- README 的 per-adapter manifest、CUTOVER 的 PROD-GATED 表删除；清单查询 `scrape sources`（从 catalog 实时生成，永不漂移）。
- source set（direct/aggregator/…）仍由 catalog 字段派生，派生规则保留在一处代码并配单元测试。

### 3.2 Row 契约 v2

沿用现有字段（part/platform/mpn/brand/package/stock/in_stock/price_breaks/lead_time/datasheet/product_url/description/category/blocked/availability_status/note），新增：

- `source_run_id`：挂到具体一次抓取；
- `extracted_at`：时间戳（回答"这行数据多新鲜"）；
- `structured`（bool）：结构化字段 vs body-dump 进 `note`，归一化层据此分流。语义不变：stock=null 未知 ≠ 0 无货；blocked ≠ 无货；body-dump 不得伪造结构化字段。

### 3.3 job schema（SQLite）

```sql
jobs        (id, created_at, parts_json, source_set, ttl_s, status)  -- status 由 source_runs 推导
source_runs (id, job_id, part, source_id, status, attempts, started_at, finished_at, error)
             -- status: pending | running | ok | blocked | error | no_result
rows        (id, source_run_id, ...Row v2 字段...)
```

`source_runs` 表就是覆盖报告本身："32 源每源什么结局"是一条 SQL 查询的结果，不再由 LLM 数数。

## 4. 执行链路

1. `scrape submit --parts LM358,NE555 --source-set direct` → 每 (part×source) 一条 source_run，返回 job id。
2. **调度结构化优先**：api/xhr/聚合器 script 先行（秒级出结果），反爬浏览器源排后。全量承诺不变；agent 可 `scrape results <job> --partial` 提前消费已完成部分。
3. 资源模型继承自旧 L1：加权 gate（fresh-Chromium 记 2 permit，默认 gate=2）、per-host 锁（站内串行/站间并行）、代理分桶（needs_proxy 由 catalog 决定）。浏览器池跨 job 常驻，PX warmup 状态保温。
4. 反爬模型继承自旧 L2：defense profiles（none/direct/perimeterx/akamai/datadome）、warmup→goto→block-check→retry 循环、script 逃生舱。**profile 必须显式含 warmup_url**（旧链路 master/rs-us 均因漏配翻车，schema 校验强制）。
5. 失败 source_run 由 daemon 按 profile 自动重试（attempts 上限入 catalog 默认值）；耗尽后落 error/blocked 终态，进覆盖报告。
6. **TTL 缓存**：默认 4h（可按 job 覆写）。同 (part, source) 在 TTL 内命中则复用既有 rows 并在覆盖报告标 `cached`；`--fresh` 强制重抓。时间敏感场景（投标/中标行核价）用 `--fresh`。

## 5. 归一化层（进代码，出 LLM）

daemon 在 job 完成（或 --partial 请求时对已完成部分）执行确定性后处理，输出汇总 JSON：

- 同平台多行合并；跨源去重（mpn+brand 归一键，归一规则=现 SKILL.md 写法归一条款的代码化）;
- 型号一致性逐字符核对，每行标 `match: exact | variant | mismatch`；
- 状态分类与排序（现 SKILL.md 的优先级表转成代码）；
- 覆盖统计（per-source 终态 + 耗时 + cached 标记）。

`note`（body-dump）原样透传并标 `structured=false`，供 LLM 复核——不伪造结构化。**LLM 职责收缩为业务叙述**；`procurement-platform-search/SKILL.md` 瘦身为业务口径（何时查、查什么集合、怎么向用户呈现），所有数数逻辑删除。

## 6. 迁移与 cutover（Never break userspace）

1. `scrape-service/` 新建，旧 `scrape-engine/` 与旧脚本（api_search.py/cloak_search.py）原样保留服役。
2. 36 个 adapter 的 extract 纯函数逐个搬运；catalog v2 一次性改写并加校验测试。
3. **cutover gate（含旧债）**：prod 上同批真实料号，新服务覆盖 ≥ 旧链路；五类冒烟通过——API（digikey/mouser）、Akamai（master）、PerimeterX（avnet/tti）、DataDome（rs-us）、OOM（全量 direct 内存峰值 < 4G）。
4. gate 通过后：SKILL.md 切到新 CLI；删除旧引擎、旧脚本、人肉超时恢复段落；catalog 里 adapter-less 死条目（ti/chip1stop/rs-cn/distrelec/kirikaeki）清理或标 reference_only。
5. systemd unit + 部署走既有 quick-deploy 通道。

## 7. 明确不做

- HTTP/gRPC API、多机分布式、消息队列中间件——单机 4C4G，SQLite 队列足够。
- 聚合器替代直查（业务承诺否决）；wave 2 缺口升级机制（首轮即全量，无缺口概念）。
- 18 个 body-dump 源本轮**不逐个 xhr/script 化**——那是切换后的独立改进轨道（catalog 的 structured 字段让进度可量化）。
- 旧分支在途改动（batch_results 等）不合入本设计。

## 8. 测试策略

- **契约测试**：每 adapter 一份 fixture payload → 期望 rows（纯函数，离线可测）；
- **catalog 校验测试**：双向 parity + enum + warmup_url 强制；
- **调度测试**：离线构建任务图，断言 host 锁分组、gate 权重、无重复；
- **归一化测试**：SKILL.md 现行自然语言规则逐条转成用例（去重/合并/优先级/型号核对）；
- **崩溃恢复测试**：daemon 杀掉重启，running 复位重跑，rows 无重复；
- **prod 冒烟**：即 cutover gate 五项。

## 9. 开放问题（进实现规划前需定）

- TTL 默认值 4h 是拍的，上线后按业务节奏调；
- daemon 与 feishu-db 重设计的 agent-state.db 是否共库（倾向不共：生命周期不同，scrape 结果是可抛弃缓存）——feishu-db 设计文档里定。
