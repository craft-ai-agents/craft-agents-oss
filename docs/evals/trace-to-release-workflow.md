# Trace To Release Workflow

日期: 2026-06-12

## 目标

把真实 trace 里的错误沉淀成可复现、可判分、可阻断回归的流程:

```text
trace 出错
  -> 归因
  -> 修改 prompt / skill / tool / eval
  -> 新增或更新 regression case
  -> 跑 Phoenix eval
  -> 过 gate
  -> 上线
  -> 继续从生产 trace 回流
```

第一阶段只使用 code evaluator,不引入 LLM judge。

## 1. Trace 进入

trace 来源可以是:

- Phoenix experiment 失败 run。
- 生产 trace 里的异常行为。
- 人工采购测试发现的问题。
- 用户反馈对应的 session/trace。

每个问题先记录成 failure record:

```yaml
sourceTraceId: <phoenix-trace-id>
sourceSessionId: <session-id>
observedAt: 2026-06-12
userInput: 帮我找一下 MT53E512M32D1ZW-046 AAT:B
environment: production | staging | local
agentVersion: <commit-or-build-id>
failureType:
  - platform_before_inventory
  - missing_inventory_lookup
observed:
  firstTool: WebSearch
  inventoryLookupUsed: false
  finalAnswer: ...
expected:
  trace:
    inventoryFirst: true
    forbidPlatformBeforeInventory: true
owner: prompt | skill | tool | eval | data | infra
status: triaged
```

不要直接把 trace 当测试。trace 是证据,最终要转成业务 contract。

## 2. 归因规则

先判断问题归属,再决定改哪里:

| 归因 | 典型现象 | 修改位置 |
| --- | --- | --- |
| prompt | 知道工具存在但策略错,例如库存前先平台 | 系统提示词、agent 指令、任务路由提示 |
| skill | skill 没触发、触发过宽、步骤遗漏、边界不清 | `procurement-skills/*/SKILL.md` |
| tool | 工具参数难构造、返回结构难理解、缺字段、错误不可恢复 | tool schema、tool 输出、错误码和 helper |
| eval | 真实行为正确但 evaluator 判错,或 case 预期不清 | `packages/eval/src/evaluators.ts` / case expected |
| data | Base 数据变了、字段缺失、record 被删、权限变化 | seed 采样、fixture、数据权限说明 |
| infra | 超时、网络、Phoenix/OTLP、lark-cli 本身失败 | runner、超时、重试、环境配置 |

只在归因明确后修改。不能为了让 eval 过而改业务规则。

## 3. Contract 映射

把 failure type 映射到当前 code-only expected schema:

| failureType | contract |
| --- | --- |
| `missing_inventory_lookup` | `expected.trace.inventoryFirst` + `expected.toolCalls.requiredSkills` |
| `platform_before_inventory` | `expected.trace.forbidPlatformBeforeInventory` |
| `missing_platform_search` | `expected.trace.requiresPlatformSearch` |
| `missing_supplier_shortlist` | `expected.trace.requiresSupplierShortlist` |
| `wrong_table` | `expected.toolCalls.requiredTableIds` / `requiredTableNames` |
| `wrong_search_term` | `expected.toolCalls.requiredSearchTerms` |
| `wrong_search_field` | `expected.toolCalls.requiredSearchFields` |
| `tech_leakage` | `expected.answer.forbiddenTerms` |
| `missing_business_terms` | `expected.answer.requiredTerms` |
| `invented_price_or_stock` | `expected.evidence.preserveFields` / `missingFields` |
| `missing_unknown_policy` | `expected.evidence.missingFieldPolicy` |
| `loop_or_thrashing` | `expected.trace.maxToolCalls` / `maxBashCalls` |

如果一个 trace 暴露了多个问题,可以先拆成多个 failure records。一个 regression case 最好只守住一个主要业务不变量。

## 4. 修改顺序

按风险从低到高处理:

1. **修 eval**: 只有当 trace 证明 agent 行为正确而 evaluator 误判时才改。
2. **修 skill**: skill 触发、步骤、边界错时优先改 skill,因为采购流程主要沉淀在 skill。
3. **修 tool**: agent 多次构造错参数或误读返回时,改 tool schema/返回结构,不要只靠提示词补。
4. **修 prompt**: 业务策略、优先级、停点、回答格式不清时改 prompt。
5. **修 runner/infra**: 只有复现证明是运行环境问题时处理。

每次只改一个主要归因层。否则 eval 失败时很难判断是哪一层改变导致。

## 5. Regression Case

真实 trace 沉淀到独立文件:

```text
packages/eval/cases/procurement-regressions.yaml
```

自动生成的 `procurement.yaml` 负责覆盖面;`procurement-regressions.yaml` 负责已经踩过的坑。两者不要混在一起。

case 模板:

```yaml
- id: procurement_regression-YYYYMMDD-short-name
  category: procurement_regression
  metadata:
    sourceTraceId: <phoenix-trace-id>
    failureType:
      - platform_before_inventory
    source:
      baseName: 供应商管理（正式版）
      tableName: 动态库存表
      tableId: tbli1WYTb1Xn2MSa
      recordId: recv...
    seed:
      model: MT53E512M32D1ZW-046 AAT:B
      brand: Micron
      quantity: "8000"
      price: 135U
      supplierName: Jada芯片分销群
  name: 回归 - 找料不能库存前查平台
  input: 帮我找一下 MT53E512M32D1ZW-046 AAT:B
  skillSlugs:
    - procurement-local-inventory-lookup
  expected:
    trace:
      inventoryFirst: true
      forbidPlatformBeforeInventory: true
      maxToolCalls: 12
      maxBashCalls: 10
    toolCalls:
      requiredSkills:
        - procurement-local-inventory-lookup
      requiredTableIds:
        - tbli1WYTb1Xn2MSa
      requiredSearchFields:
        - 型号
      requiredSearchTerms:
        - MT53E512M32D1ZW-046 AAT:B
      forbiddenTools:
        - WebSearch
        - WebFetch
    answer:
      requiredTerms:
        - MT53E512M32D1ZW-046 AAT:B
      forbiddenTerms:
        - lark-cli
        - baseToken
        - tableId
        - API
    evidence:
      preserveFields:
        - price
        - quantity
        - supplierName
  assertions:
    - type: code
      criterion: 不能在内部库存查询前查外部平台
    - type: manual
      criterion: 回归自真实 trace,用于防止平台搜索过早触发
```

## 6. 本地验证

`procurement-regressions.yaml` 初始为空。下面的 regression 命令只在新增至少一条回归 case 后运行。

修改后先跑窄集:

```bash
bun run eval:phoenix \
  --runner dry-run \
  --cases packages/eval/cases/procurement-regressions.yaml \
  --phoenix-dry-run
```

再跑真实 agent 窄集:

```bash
bun run eval:phoenix \
  --runner real \
  --workspace <workspace-id> \
  --cases packages/eval/cases/procurement-regressions.yaml \
  --filter procurement_regression-YYYYMMDD-short-name \
  --experiment procurement-regression-smoke-$(date +%Y%m%d-%H%M)
```

最后跑固定采购集:

```bash
bun run eval:phoenix \
  --runner real \
  --workspace <workspace-id> \
  --cases packages/eval/cases/procurement.yaml \
  --experiment procurement-full-$(date +%Y%m%d-%H%M)
```

如果要测稳定性,真实 agent 至少对 regression case 跑:

```bash
--repetitions 3 --concurrency 1
```

## 7. Gate

上线前必须满足:

- 新增 regression case 必须通过。
- 既有 `procurement-regressions.yaml` 必须通过。
- `procurement.yaml` 不能出现新增失败。
- 失败若来自 eval 误判,必须先修 eval 并保留解释。
- 所有失败 case 都要能从 Phoenix trace 看到原因。
- 不能因为新 prompt/skill 让平台搜索正例失效。
- 不能为了通过单一回归 case 删除业务必要步骤。

第一阶段 gate 只看 code evaluator:

- `outcome_complete`
- `trace_contract`
- `tool_call_contract`
- `answer_contract`
- `evidence_contract`

## 8. 上线顺序

1. 合并 prompt/skill/tool/eval 修改。
2. 保留 regression case 和 sourceTraceId。
3. 跑 staging 或本地真实 agent eval。
4. 观察 Phoenix trace,确认失败模式消失。
5. 上线。
6. 上线后抽样生产 trace,确认没有出现同类失败和相反方向误伤。

## 9. 回流节奏

- 每个生产严重失败: 当天进 `procurement-regressions.yaml`。
- 每周 review Phoenix 失败 trace,合并重复 failure type。
- 每月检查 evaluator 是否过严、过松或已经饱和。
- 每次 skill/prompt/tool 大改: 必跑 regression + 100 条固定采购集。

## 10. 决策原则

- trace 是证据,contract 才是 eval。
- 先修可确定的 code evaluator,暂不引入 LLM judge。
- 业务不变量优先于具体动作序列。
- regression case 要防止已知 bug 复发,不是复刻一次偶然执行路径。
- 正例和反例成对出现,避免把 agent 推向单边策略。
