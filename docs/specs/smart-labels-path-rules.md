# 智能标签 - 路径规则功能设计

## 概述

智能标签（Path Rules）允许用户配置**路径 → 标签**的映射关系。当 Chat 会话的 `workingDirectory` 匹配某个配置的路径时，系统自动给该会话分配对应的标签。

## 需求

1. 用户可以配置 路径(path) → 标签(labelId) 的映射关系
2. 支持精确匹配（exact）和前缀匹配（prefix）两种模式
3. 在设置页面提供 UI 管理这些映射
4. 最小化侵入现有标签系统

## 设计决策

### 1. 配置存储 - 独立文件

新增配置文件：`~/.craft-agent/workspaces/{workspaceId}/labels/path-rules.json`

**理由**：
- 不修改现有 `labels/config.json` 的 schema，避免验证和迁移风险
- "路径规则" 是独立的规则系统，不应污染标签树定义
- 便于单独加载、验证、监听变更

**Schema**：
```typescript
interface PathRulesConfig {
  version: 1;
  rules: PathRule[];
}

interface PathRule {
  /** Unique rule ID for stable UI keys */
  id: string;
  /** Absolute path to match against workingDirectory */
  path: string;
  /** Match mode: exact = strict equality, prefix = starts with */
  match: 'exact' | 'prefix';
  /** Label ID to apply (must exist in labels config) */
  labelId: string;
  /** Optional value for valued labels (e.g., "priority::3") */
  value?: string;
  /** Whether this rule is active */
  enabled?: boolean;
  /** Human-readable description */
  description?: string;
}
```

**示例**：
```json
{
  "version": 1,
  "rules": [
    {
      "id": "rule-1",
      "path": "/Users/alice/code/my-repo",
      "match": "prefix",
      "labelId": "project-alpha",
      "enabled": true,
      "description": "my-repo 项目目录"
    },
    {
      "id": "rule-2",
      "path": "/Users/alice/code/backend",
      "match": "prefix",
      "labelId": "backend",
      "description": "后端服务代码"
    }
  ]
}
```

### 2. 标签应用策略 - 写入 session.labels，只增不减

**触发时机**：
1. **Session 创建时**（最关键）
2. **Session workingDirectory 变更时**

**算法**：
1. 读取 `path-rules.json`
2. 根据 session 的 `workingDirectory` 匹配规则
3. 对每个匹配的 labelId：
   - 校验 labelId 在 labels tree 中存在（否则跳过并 warning）
   - 若 `session.labels` 不包含该 id，则追加并持久化（去重）

**行为定义**：
- **只增不减**：规则删除/修改后，不自动回滚历史会话标签
- 避免误删用户手工添加的同名标签
- 避免配置变动导致历史会话标签意外变化

**优点**：
- 最大化复用现有生态（过滤、渲染、持久化、导出等）
- 无需引入 "computed labels" 的双来源复杂度
- 离线/重启后依然一致（已持久化）

### 3. 路径匹配逻辑

使用 Node.js `path` 模块实现跨平台兼容：

```typescript
import * as path from 'path';

function matchPath(
  rulePath: string,
  workingDirectory: string,
  mode: 'exact' | 'prefix'
): boolean {
  // Normalize paths
  const normalizedRule = path.normalize(path.resolve(rulePath));
  const normalizedWorkDir = path.normalize(path.resolve(workingDirectory));
  
  // Windows: case-insensitive comparison
  const ruleToCompare = process.platform === 'win32' 
    ? normalizedRule.toLowerCase() 
    : normalizedRule;
  const workDirToCompare = process.platform === 'win32' 
    ? normalizedWorkDir.toLowerCase() 
    : normalizedWorkDir;
  
  if (mode === 'exact') {
    return ruleToCompare === workDirToCompare;
  }
  
  // Prefix match: use path.relative to avoid false positives
  // e.g., /a/b should NOT match /a/b2
  const rel = path.relative(ruleToCompare, workDirToCompare);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
```

**多规则处理**：
- 允许多个规则同时命中 → 追加多个标签
- 同一标签来自多个规则 → 去重
- 按"最长 path 优先"排序以确保确定性行为

### 4. UI 设计 - 在现有 LabelsSettingsPage 添加 Section

在 `LabelsSettingsPage.tsx` 新增一个 section：**Path Rules**

**第一期（最小实现）**：
- 类似现有的 "Label Hierarchy" / "Auto-Apply Rules" 风格
- 一个 DataTable 展示规则
- 一个 EditPopover 直接编辑 `labels/path-rules.json`
- secondary action 提供 "Edit File" 直接打开文件

**表格列**：
| 列 | 描述 |
|----|------|
| Path | 匹配的路径 |
| Match | Exact / Prefix |
| Label | 标签名 + 颜色圆点 |
| Enabled | 启用状态 |
| Description | 描述（可选） |

**第二期（产品化，可选）**：
- 提供 "Add mapping" 表单
- 文件夹选择器 + label 下拉选择 + match 模式选择
- 内部仍落盘到同一个 JSON

## 实现计划

### 阶段 1：核心逻辑

1. **新增类型定义** - `packages/shared/src/labels/path-rules/types.ts`
2. **路径匹配评估器** - `packages/shared/src/labels/path-rules/evaluator.ts`
3. **配置加载/保存** - `packages/shared/src/labels/path-rules/storage.ts`

### 阶段 2：集成到 Session 管理

1. **Session 创建时应用** - 修改 `apps/electron/src/main/sessions.ts` 的 `createSession`
2. **workingDirectory 变更时应用** - 修改 `updateWorkingDirectory` 处理逻辑
3. **IPC 接口** - 添加加载/保存 path-rules 配置的 IPC

### 阶段 3：UI 设置页面

1. **DataTable 组件** - `PathRulesDataTable.tsx`
2. **LabelsSettingsPage 新增 Section**
3. **EditPopover 配置**

## 风险与防护

| 风险 | 防护措施 |
|------|----------|
| 路径规范化差异（尤其 Windows） | 统一 `resolve/normalize`；Windows 下 `toLowerCase()` |
| 规则引用不存在的 labelId | 加载时校验存在性；UI 显示 warning badge |
| 规则变更对历史会话的影响 | 明确"只增不减"策略；后续可添加"批量重算"按钮 |
| 用户把 mapping 指向 valued label | 允许添加 bare id；UI 提示该 label 有 valueType |

## 未来扩展

当出现以下需求时，可以升级设计：

1. **来源追踪**：在 session 上新增 `labelSources?: Record<labelId, 'manual'|'path-rule'|'auto-rule'>`
2. **批量重算**：提供 "Recompute path labels for all sessions" 按钮
3. **UI 区分**：显示不同样式区分手动标签 vs 智能标签
4. **复杂匹配**：支持 glob/regex、优先级、排除路径等

## 文件变更清单

### 新增文件
- `packages/shared/src/labels/path-rules/types.ts`
- `packages/shared/src/labels/path-rules/evaluator.ts`
- `packages/shared/src/labels/path-rules/storage.ts`
- `packages/shared/src/labels/path-rules/index.ts`
- `apps/electron/src/renderer/components/info/PathRulesDataTable.tsx`

### 修改文件
- `apps/electron/src/main/sessions.ts` - 创建/更新会话时应用路径规则
- `apps/electron/src/main/ipc.ts` - 添加 path-rules 相关 IPC
- `apps/electron/src/renderer/pages/settings/LabelsSettingsPage.tsx` - 添加 Path Rules section
- `packages/shared/assets/docs/labels.md` - 添加路径规则文档
