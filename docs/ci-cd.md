# CI / CD 流程

日期: 2026-07-09

## 模型（狠）

```text
feature → PR → CI (contracts ‖ validate ‖ build → ci-ok)
                ↓ merge 进 main 且 main 上 CI 全绿
              Deploy production 自动跑（无审批）
                ↓ rsync + restart
              post-deploy 健康检查
```

**人只在 PR 合入时把关。** 合进 main 且 CI 绿 = 授权上线。  
没有 Environment 审批、没有 confirm 口令、没有「再点一次 Deploy」。

闸门权重：

| 层 | 作用 |
|----|------|
| PR + required `ci-ok` | 拦烂代码/烂契约 |
| main 上再跑一遍 CI | 合入瞬间的真实 tip |
| 自动 CD | 绿尖立刻碰到生产 |
| post-deploy 断言 | 线上形状必须对（skill 硬切等） |

## CI（`.github/workflows/ci.yml`）

| Job | 做什么 |
|-----|--------|
| **contracts** | 非法文件名、采购工具路由硬切、skill 合同测试 |
| **validate** | typecheck + shared 单测 + i18n |
| **build** | 与 prod 同构：subprocess + wa-worker + webui |
| **ci-ok** | 三闸全绿；**分支保护只勾这个** |

本机：

```bash
bun run ci:local
bun run validate:contracts
just ci
```

## CD（`.github/workflows/deploy-production.yml`）

### 自动触发

- 事件：`workflow_run`，监听 workflow 名 **`CI`**，`completed`，分支 **main**
- 条件：`conclusion == success`
- 部署 **该次 CI 的 `head_sha`**（不是模糊的「最新 main」猜测）
- 若该 SHA 已落后于 `origin/main`（连续 merge）：**跳过**，由更新的 CI 负责部署

### 手动

Actions → **Deploy production** → Run workflow（重发当前 main tip；可选 skip_build / skip_deps）。

### 不会做的

- 不在 feature / redesign 上部署
- 不要求人工审批
- 不在 CD 里重复 typecheck（CI 已在同 SHA 跑过）；runner 上仍会 build 出 dist 再 rsync

### Secrets

| Secret | 必填 |
|--------|------|
| `CRAFT_DEPLOY_SSH_KEY` | 是 |
| `CRAFT_DEPLOY_HOST` | 是 |
| `CRAFT_DEPLOY_USER` | 否（ubuntu） |
| `CRAFT_DEPLOY_PORT` | 否（22） |

### 发布后断言

- `https://agent.inotoday.asia/` → 200/302  
- `craft-agent` / `mihomo` active  
- skills：有 `component-data`、`larkdepot`；**无** `scrape-engine`  
- `DEPLOYED_SHA` 写入  

## 分支保护（main · 必做）

Settings → Branches → main：

1. **Require a pull request before merging**（禁止直推 main，否则自动 CD 等于谁都能炸产线）
2. **Require status checks → `ci-ok`**
3. Require branches to be up to date  
4. 不要给管理员 bypass（否则绕过整条模型）

`redesign/**`：跑 CI，不触发 CD（`workflow_run` 只听 main）。

## 本机热修

CI 挂了又要紧急修？先修到绿再合。  
真要本机直推（破坏模型时）：

```bash
./scripts/quick-deploy.sh --allow-branch   # 知情事故通道
```

正常路径不要用。

## 评测（独立闸，不挡自动 CD）

改库存/路由语义后建议：

```bash
just eval-dry
just eval
```

见 `docs/evals/trace-to-release-workflow.md`。不进 GitHub CI（依赖 LLM + prod 工具）。

## 风险与对策（选了自动发就要认）

| 风险 | 对策 |
|------|------|
| 坏代码合进 main | PR + ci-ok 必开，禁止 bypass |
| 连续 merge 部署乱序 | stale SHA 跳过；concurrency 排队 |
| 半套 rsync | 不 cancel 进行中的 deploy |
| 契约漂移 | contracts 硬切禁词 + skill 测试 |
| 密钥泄露 | 部署 key 仅 Actions；开发机用个人 key |

**一句话：** merge 到 main 且 CI 绿 = 已上线；回滚 = `git revert` 再走同一管道，或 `DEPLOYED_SHA` 旧提交手工 checkout 热修（事故通道）。
