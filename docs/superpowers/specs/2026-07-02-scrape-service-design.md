# scrape-service 设计文档 — 平台搜索链路服务化重写

日期：2026-07-02
状态：已与用户逐节评审通过，待实现规划
取代：`procurement-skills/scrape-engine/`（3 层单次进程引擎，含 CUTOVER.md 未完成的切换债）

## 0. 决策记录（用户拍板，不再重议）

1. **方案 B**：链路 + 引擎全部重写，形态为常驻服务。引擎内核（加权 gate、host 锁、defense profile）**概念保留、代码重写**——现有代码假设"一次进程跑一批"，与"池跨 job 常驻"的生命周期模型不兼容。
2. **首轮必须全量**：`direct` 集合（当前 32 源）逐平台直查是业务承诺，不可用聚合器覆盖代替。调度可以结构化优先，覆盖不可缩水。
3. **在途改动搁置**：分支 `optimize/procurement-substitute-eval` 上未提交的链路修补（batch_results、超时恢复 SKILL 段落、prompt 契约测试）不落地，重设计一步到位。其中"人肉超时恢复流程"被本设计的 job 机制整体取代。

## 1. 动机（盘点得出的痛点，均有 file:line 证据）

这次不是"补七个洞"，是换一个让洞不存在的形状。病根有两个层次：**进程模型**（服务化解决）与**屎山代码**（重写解决，详见 §1.5）。逐条痛点：

- **正则沼泽（头号技术债，详见 §1.5）**：所谓"body-dump 源"是谎言。`adapters/_generic.py` 里 `_structured_rows()` 近 280 行按站定制正则，对 future/xonelec/lcsc/tme/szlcsc/componentonline/darisus/monotaro/corestaff 九站解析**渲染文本的视觉顺序**——站点改版即静默失配。而这些站大多有 JSON XHR 后端（实测：szlcsc `overseas/global/search`、lcsc `wmsc`、tme 自家接口、element14 GraphQL），正则是在给"本来吐 JSON 的站"手写文本解析。
- **加一个源要改 6 处且能静默漂移（详见 §1.5）**：registry `_MODULES` 手写映射（漏登记则源隐形）、catalog、adapter 本体、`_generic` 正则分支 + 两个硬编码站名 set、README/CUTOVER 文档。`source_sets.py` 还硬编码了"direct 是什么"的排除集（与 catalog 的 channel_type 值构成第二事实源）并手搓了一个数缩进的 YAML 解析器（无 PyYAML 依赖，遇任何 YAML 特性即崩）。
- 归一化（去重/合并/状态分类/型号核对）写在 SKILL.md 自然语言里，靠 LLM 执行，无确定性兜底。
- 源元数据重复维护 4 处（source_catalog.yaml / README.md / CUTOVER.md / adapter docstring），已实际漂移：README 记 34 adapter 实为 36，avnet/arrow/newark/element14-cn 的 mode 全部记错。
- 全量 direct 常超时，恢复流程 = prompt 教 agent 人肉分块补跑；引擎无分块/断点/落盘。
- 每次调用冷启动 Chromium、重做 PerimeterX warmup，反爬源延迟与成功率受损。
- 资源控制粗糙（详见 §1.5）：魔法 sleep 遍地（avnet 死等 9s、generic 死等 4s）、代理有两条独立代码路径（api 模式 httpx 自带 vs 浏览器代理桶）、`exclusive=True` 在多 job daemon 里会让一个脆源冻结整台服务。
- CUTOVER 五项 prod 冒烟（API/Akamai/PerimeterX/DataDome/OOM）从未通过，旧脚本兜底未删。

## 1.5 屎山清单（重写的核心工作量，别当次要项）

盘点里最疼的不是缺功能，是**值钱的站点情报被焊死在屎山里**。情报（哪个 URL、哪个 XHR 带 JSON、哪个 profile、warmup 打哪、SAP 号怎么 join）是资产；包在外面的机械是负债。四坨负债按优先级：

**① 解析层：280 行正则沼泽 → XHR 化（最高优先）**
- 现状：`_generic.py` 用正则刮 `inner_text("body")`，耦合渲染文本的字段先后顺序，站点改版静默返回 `[]` fall 到 note。这是"最坏的一种"——既脆（随时崩且无声）又冗余（给吐 JSON 的站手写文本解析）。
- 重写：把站点情报从"渲染文本正则"改造成"拦 XHR 拿 JSON"（avnet 已是样板：`on_response` 拦三个 XHR 按 SAP 号 join 出结构化）。**这不是可推后的独立轨道，是让解析可维护的唯一出路**（推翻本文档旧版 §8 的"不结构化"决定）。
- `navigate()` 那个 120 行怪物（warmup/xhr 嗅探/script 提前返回/dom settle/重试/fresh-browser/异常清理全挤一个函数、`for` 套 `try` 套 `if mode==`）拆解：mode 分发收敛到一处（现在 L1 `_run_one` 和 L2 `navigate` 各分一次）。浏览器句柄绝不再穿 `meta["_owned_browser"]` 这种无类型 dict 传递——所有权用 context manager 结构保证（daemon 里这是必漏的 RAM 泄漏点）。

**② 维护面：6 处收敛成 1 处**
- 删 `registry.py` 的 `_MODULES` 手写映射 → 扫 `adapters/` 目录 + catalog 双向校验 fail loud（catalog 声明 enabled 的必须有文件，文件必须在 catalog 有合法条目）。
- 删 `source_sets.py` 的硬编码排除集 + 手搓 YAML 解析器 → source set 规则从 catalog 字段派生（一处真相），YAML 用真解析器（部署环境补依赖或换 TOML/JSON catalog）。
- 加一个源 = 加一个 catalog 条目 + 一个 adapter 文件（两个纯函数），其余零改动。

**③ 资源控制：见 §4.5 常驻浏览器池生命周期**（魔法 sleep、双代理路径、exclusive 语义、跨 job gate、泄漏兜底、崩溃恢复、warmup 保温矛盾）。

**④ 反爬情报**：profile 数据（warmup_url、block_pat、retries、fresh_browser）是资产，从 L2 抢救进 catalog/profile 定义；`navigate` 的循环机械重写。这些 profile **从未通过 prod 冒烟**，cutover gate 才是它们的验收考试。

服务化回答进程模型层；§1.5 四坨是重写层；CUTOVER 旧债作为切换 gate 一并偿还。

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
- **删 `registry.py` 的 `_MODULES` 手写映射**：改为扫 `adapters/` 目录自动发现。daemon 启动做双向校验：catalog 里 status∈{enabled,limited} 的源必须有对应文件，文件必须在 catalog 有条目且字段合法（enum 校验），任何一边缺失 **拒绝启动**（fail loud，不静默漏选）。旧代码里"漏登记 `_MODULES` 则源隐形"的静默漂移就此消除。
- **删 `source_sets.py` 的硬编码排除集 + 手搓 YAML 解析器**：source set（direct/aggregator/…）规则完全从 catalog 字段派生（一处真相，不再有代码里的 `EXCLUDED_DIRECT_CHANNEL_TYPES` 与 yaml 值两处对账）；catalog 用真解析器读取（部署环境补 PyYAML，或 catalog 直接换 TOML/JSON 免依赖）。派生规则保留在一处并配单元测试。
- README 的 per-adapter manifest、CUTOVER 的 PROD-GATED 表删除；清单查询 `scrape sources`（从 catalog 实时生成，永不漂移）。
- **净效果：加一个源 = 加一个 catalog 条目 + 一个 adapter 文件，其余零改动**（旧链路要改 6 处）。

### 3.2 Row 契约 v2

沿用现有字段（part/platform/mpn/brand/package/stock/in_stock/price_breaks/lead_time/datasheet/product_url/description/category/blocked/availability_status/note），新增：

- `source_run_id`：挂到具体一次抓取；
- `extracted_at`：时间戳（回答"这行数据多新鲜"）；
- `structured`（bool）：结构化字段 vs body-dump 进 `note`，归一化层据此分流，也是**正则沼泽 XHR 化的进度度量**（今天结构化率约一半，目标逐站抬到接近全部）。语义不变：stock=null 未知 ≠ 0 无货；blocked ≠ 无货；body-dump 不得伪造结构化字段。

**解析策略（针对 §1.5 ①）**：新 adapter 一律优先 xhr/api/script-拦-JSON，把站点情报编码成"哪个 XHR、哪个字段"而非"渲染文本正则"。`_generic.py` 的 280 行正则不迁移——迁移=延续负债；对应站逐个 XHR 化，暂未化的退回真·body-dump（`structured=false`，note 原样透传给 LLM），**不再用脆正则伪装结构化**。

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
3. 资源模型：加权 gate 的**概念**保留（fresh-Chromium 记 2 permit）、per-host 锁（站内串行/站间并行）、代理分桶。但**代码不是继承是重写**——旧模型只在单批进程内成立，daemon 里要重做，见 §4.5。代理配置收成一个概念（消除旧链路 api 模式 httpx 自带代理 vs 浏览器代理桶的双路径）。
4. 反爬模型：defense profile 的**数据情报**（warmup_url/block_pat/retries/fresh_browser）从旧 L2 抢救进 catalog；`navigate` 的循环机械重写（拆掉 120 行怪物，见 §1.5 ①）。**profile 必须显式含 warmup_url**（旧链路 master/rs-us 均因漏配翻车，schema 校验强制）。
5. 失败 source_run 由 daemon 按 profile 自动重试（attempts 上限入 catalog 默认值）；耗尽后落 error/blocked 终态，进覆盖报告。
6. **TTL 缓存**：默认 4h（可按 job 覆写）。同 (part, source) 在 TTL 内命中则复用既有 rows 并在覆盖报告标 `cached`；`--fresh` 强制重抓。时间敏感场景（投标/中标行核价）用 `--fresh`。

### 4.5 常驻浏览器池生命周期（旧代码最大的"不能抄"）

旧池 `run_batch` 完就 `pool.close()`，靠**进程速死**兜底：泄漏无所谓、崩溃无所谓、句柄漏了无所谓。常驻后这四个"无所谓"全部要命，必须显式设计：

- **gate 升为 daemon 全局单例**：不再是每批一个。加权会计（fresh=2 permit）作用域升到整个 daemon，否则两个 job 各以为独占 gate=2 → 实际 4 个 fresh 进程 → OOM 不等式破。
- **`exclusive` 语义重定义**：旧 `exclusive=True`（avnet）独占整个 gate，在多 job daemon 里会让一个脆源**冻结整台服务**（job B 的 200ms digikey 卡在 job A 的独占 avnet 后）。改为"独占某 host/某代理桶"，不冻结无关源。
- **回收策略（旧代码没有）**：池化浏览器开几百 context 必泄。daemon 盯自身浏览器进程 RSS，过水位线**在两个 job 间隙回收该 bucket**，不打断在飞抓取。
- **崩溃恢复 = 重启恢复（收敛成一套）**：池化浏览器被 OOM-kill 或渲染崩，把其上在飞的 source_run 从 `running` 打回 `pending`——与 daemon 重启做的事完全相同。一套机制，两个场景，都是 source_runs 建表的复利。
- **context 泄漏 watchdog**：每个租约带时间戳，超硬顶强制回收。速死进程不需要，常驻必须有。
- **句柄所有权用结构保证**：租 slot 者在一处负责关（context manager），杜绝旧 `meta["_owned_browser"]` 穿层传递。
- **魔法 sleep → 事件等待**：avnet 的 `wait_for_timeout(9000)`、generic 的 `4000` 全部换成"等 XHR 真到/等选择器出现"（avnet 的 `on_response` 已是样板），去掉固定 dwell 的吞吐税。
- **warmup 保温 vs cookie 隔离的矛盾（开放问题，见 §10）**：daemon 卖点"PX warmup 保温"不是免费的——warmup cookie 活在 context 里，而隔离要求每抓取扔 context。保温需要"按 host 缓存热 context + TTL 淘汰"，本身是一套要设计的状态。取舍进 §10。

## 5. 归一化层（进代码，出 LLM）

daemon 在 job 完成（或 --partial 请求时对已完成部分）执行确定性后处理，输出汇总 JSON：

- 同平台多行合并；跨源去重（mpn+brand 归一键，归一规则=现 SKILL.md 写法归一条款的代码化）;
- 型号一致性逐字符核对，每行标 `match: exact | variant | mismatch`；
- 状态分类与排序（现 SKILL.md 的优先级表转成代码）；
- 覆盖统计（per-source 终态 + 耗时 + cached 标记）。

`note`（body-dump）原样透传并标 `structured=false`，供 LLM 复核——不伪造结构化。**LLM 职责收缩为业务叙述**；`procurement-platform-search/SKILL.md` 瘦身为业务口径（何时查、查什么集合、怎么向用户呈现），所有数数逻辑删除。

## 6. CLI 契约（agent-friendly）

CLI 的唯一用户是 AI agent。契约（用户 2026-07-02 增补要求）对 scrape CLI 与 feishu-db CLI 同等生效：

1. **默认 JSON、面向解析**：stdout 永远是单个 JSON 文档（流式场景 NDJSON）。无表格美化、无 ANSI、无 pager、无进度条。人类可读交给 `--pretty`。
2. **永不交互**：不读 stdin、不提问、不要确认。缺参数 = 结构化报错退出，绝不挂起等输入。
3. **结构化错误**：错误走 stderr，也是 JSON：`{"error": {"code", "message", "hint"}}`。`hint` 必须告诉 agent 下一步能做什么（例：`daemon 未运行 → systemctl start scrape-service`），而不是只描述失败。
4. **退出码语义固定**：`0`=命令成功（**业务上"查无结果"也是 0**——no_result 是数据不是故障）；`1`=用法错误；`2`=环境/依赖错误（daemon 没跑、DB 缺失）；`3`=任务级失败。数据层面的 blocked/error 属于 JSON 内容，不进退出码。
5. **自描述**：`scrape schema`（及 `feishu-db schema`）输出机器可读的完整契约——子命令、参数、输出 JSON Schema、退出码表。SKILL.md 引用它，不再手抄命令用法（消灭一处漂移源）。
6. **有界输出**：查询类命令默认 limit + `--fields` 投影；超限时返回截断标记与"如何取剩余"的指引，绝不把 71k 行灌进 agent 上下文。
7. **幂等与可恢复**：`submit` 带幂等键（相同 parts+source_set 在 TTL 内重复提交返回同一 job id）；一切状态凭 id 可再查——对话丢了，工作不丢。
8. **输出带 `schema_version`**：字段语义永不静默变更；改契约 = 升版本号 + 兼容期（Never break userspace 的 CLI 版）。

## 7. 迁移与 cutover（Never break userspace）

1. `scrape-service/` 新建，旧 `scrape-engine/` 与旧脚本（api_search.py/cloak_search.py）原样保留服役。
2. 36 个 adapter 的 extract 纯函数逐个搬运；catalog v2 一次性改写并加校验测试。
3. **cutover gate（含旧债）**：prod 上同批真实料号，新服务覆盖 ≥ 旧链路；五类冒烟通过——API（digikey/mouser）、Akamai（master）、PerimeterX（avnet/tti）、DataDome（rs-us）、OOM（全量 direct 内存峰值 < 4G）。
4. gate 通过后：SKILL.md 切到新 CLI；删除旧引擎、旧脚本、人肉超时恢复段落；catalog 里 adapter-less 死条目（ti/chip1stop/rs-cn/distrelec/kirikaeki）清理或标 reference_only。
5. systemd unit + 部署走既有 quick-deploy 通道。

## 8. 明确不做

- HTTP/gRPC API、多机分布式、消息队列中间件——单机 4C4G，SQLite 队列足够。
- 聚合器替代直查（业务承诺否决）；wave 2 缺口升级机制（首轮即全量，无缺口概念）。
- 旧分支在途改动（batch_results 等）不合入本设计。

> 注：旧版本文档曾写"18 个 body-dump 源不结构化，是切换后的独立轨道"。**此决定已推翻**——读 `_generic.py` 后确认它们不是干净 body-dump 而是 280 行脆正则（§1.5 ①），XHR 化是核心工作量不是可推后项。正则不迁移；逐站 XHR 化，暂未化的退回真·body-dump。

## 9. 测试策略

- **契约测试**：每 adapter 一份 fixture payload → 期望 rows（纯函数，离线可测）；XHR 化的源固定一份真实 JSON 响应做回归。
- **catalog 校验测试**：目录扫描 vs catalog 双向 parity + enum + warmup_url 强制 + source set 派生规则（替代旧 `_MODULES`/`source_sets` 硬编码）；
- **调度测试**：离线构建任务图，断言 host 锁分组、gate 权重、多 job 下 gate 全局性、`exclusive` 不冻结无关源、无重复；
- **归一化测试**：SKILL.md 现行自然语言规则逐条转成用例（去重/合并/优先级/型号核对）；
- **崩溃恢复测试**：daemon 杀掉重启 + 池化浏览器杀掉，两种都把 running 复位重跑，rows 无重复；
- **长跑泄漏测试**：daemon 连续跑 N 轮全量 direct，浏览器进程 RSS 不单调爬升（验回收策略 + context watchdog）；
- **prod 冒烟**：即 cutover gate 五项。

## 10. 开放问题（进实现规划前需定）

- TTL 默认值 4h 是拍的，上线后按业务节奏调；
- daemon 与 feishu-db 重设计的 agent-state.db 是否共库（倾向不共：生命周期不同，scrape 结果是可抛弃缓存）——feishu-db 设计文档里定。
- **warmup 保温 vs cookie 隔离取舍（§4.5）**：候选 (a) 按 host 缓存热 context 复用同站多 part、带 TTL 淘汰——牺牲同站隔离换 warmup 只付一次（反爬站本就期望"真人连续浏览"，共享 cookie 反而更像真人，倾向此项）；(b) 每次新 context 不保温——严格隔离但慢、PX 成功率低；(c) 分 profile：perimeterx 保温、none/direct 每次新 context——两套路径共存复杂度上升。实现规划前定。
