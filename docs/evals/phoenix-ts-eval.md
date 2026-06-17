# Phoenix TS Eval

日期: 2026-06-12

## 目标

eval 系统本体使用 Phoenix:

- Phoenix dataset 保存 case。
- Phoenix experiment 运行真实 agent task。
- Phoenix evaluator 保存 code-only 判分结果。LLM judge 暂不接入,后续只用于代码不好稳定判断的主观项。
- Phoenix trace UI 看单条失败的运行轨迹。

仓库内的 TypeScript 只做一层适配:读取 case,调用真实 `SessionManager`,把输出交给 Phoenix。

真实 trace 出错后的归因、修复、回归 case 和上线 gate 走 `docs/evals/trace-to-release-workflow.md`。

## 启动 Phoenix

本地没有 Phoenix 服务时:

```bash
bun run eval:phoenix:serve
```

等 UI 出现在 `http://localhost:6006` 后,另开终端跑 eval。这个脚本等价于官方 `phoenix serve`,只是通过 `uvx --from arize-phoenix` 临时提供 Python CLI,并默认把本地 SQLite 放在 `.phoenix/`。

## 入口

```bash
bun run eval:phoenix \
  --workspace <workspace-id> \
  --dataset craft-procurement-regression \
  --experiment procurement-smoke-$(date +%Y%m%d-%H%M)
```

常用参数:

- `--runner real|dry-run`: 默认 `real`。`dry-run` 只用于验证 Phoenix dataset/experiment/evaluator 对接。
- `--workspace <id>`: real runner 必填,也可用 `CRAFT_EVAL_WORKSPACE_ID`。
- `--cases <path>`: 默认 `packages/eval/cases/procurement.yaml`。
- `--filter <text>`: 只跑 id/name/category 命中的 case。
- `--limit <n>`: 只取前 n 条。
- `--repetitions <n>`: 每条 case 重复 n 次,用于 pass^k。
- `--concurrency <n>`: 并发 case 数。真实 agent 默认建议 1。
- `--phoenix-dry-run [n]`: 走 Phoenix dry-run,不完整记录实验。
- `--permission-mode <mode>`: 默认 `allow-all`,避免 headless eval 卡在权限确认。

## 采购用例生成

采购 eval 用例不是手写假型号,而是先从飞书 Base《供应商管理（正式版）》只读抽样,再生成 YAML:

```bash
bun run eval:procurement:sample-base
bun run eval:procurement:generate-cases
```

产物:

- `packages/eval/seeds/procurement-base-samples.json`: 从真实 Base 抽出的 seed pool,包含表名、table id、record id、型号、品牌、库存、价格、供应商和 tags。
- `packages/eval/cases/procurement.yaml`: 从 seed pool 生成的 100 条 Phoenix case。

采样脚本在 `packages/eval/src/scripts/sample-procurement-base.ts`,使用 `lark-cli base +record-list --as user` 串行读取以下源表:

- `动态库存表`
- `A级供应商库存`
- `B级供应商库存1`
- `B级供应商库存2`
- `B级供应商库存3`
- `C级供应商库存`
- `自家库存`
- `供应商档案`

生成脚本在 `packages/eval/src/scripts/generate-procurement-cases.ts`,当前固定生成 100 条,分桶如下:

- 25 条 `procurement_inventory_first`: 真实型号找料,必须先查内部库存。
- 15 条 `procurement_model_normalization`: 连字符、点号、空格、括号、大小写等真实型号噪声。
- 15 条 `procurement_model_mismatch_detail`: 近似命中时必须写清具体差异。
- 10 条 `procurement_self_inventory_cost`: 自家库存必须展示单价/囤货成本。
- 10 条 `procurement_single_supplier_risk`: 单源、C 级、价格/品牌缺失等弱证据。
- 10 条 `procurement_dynamic_inventory`: 动态库存必须展示发布时间和时效性。
- 10 条 `procurement_platform_continuation`: 用户明确继续查平台时才触发平台搜索。
- 5 条 `procurement_supplier_shortlist`: 库存来源不足时补供应商档案候选。

每条 case 都带 `metadata.source`,用于在 Phoenix 中回溯到真实 Base 表和记录。

## Phoenix 环境变量

Phoenix client 读取:

```bash
PHOENIX_HOST=http://localhost:6006
PHOENIX_API_KEY=...
```

runtime turn trace 仍走应用侧 OTLP:

```bash
CRAFT_OTEL_ENABLED=true
CRAFT_OTEL_ENDPOINT=http://localhost:6006/v1/traces
CRAFT_OTEL_PROJECT=craft-eval
CRAFT_OTEL_CAPTURE_CONTENT=true
```

## 第一阶段 evaluator

当前只用 code evaluator 覆盖硬规则,不调用 LLM judge。case 的 `expected` 分为四层:

- `outcome_complete`: turn 完成且 final answer 非空。
- `trace_contract`: 检查库存优先、平台搜索触发、供应商候选触发、最大 tool call 数和最大 Bash 调用数。
- `tool_call_contract`: 检查必须/禁止的 tool、table id、表名、搜索字段和搜索词。
- `answer_contract`: 检查最终回答必须包含的业务词、禁止泄漏的技术词,以及是否提到内部来源。
- `evidence_contract`: 检查回答是否原样保留 seed 里的价格/数量/供应商等字段,字段缺失时是否明确写未填写/待确认。

YAML 里的 `assertions` 仅作为人工审阅备注和后续扩展提示;`type: manual` 不会触发自动 LLM 评分。
