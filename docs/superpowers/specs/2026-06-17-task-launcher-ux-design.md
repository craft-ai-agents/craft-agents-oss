# 任务启动器 UX(Task Launcher)设计

日期:2026-06-17
状态:设计已确认,待写实现计划
范围:仅 `apps/webui` 前端,**零服务端 / agent / 协议改动**

---

## 1. 背景与问题

本部署面向**非技术采购**。现在的输入区是一个自由文本框(`FreeFormInput.tsx`,2677 行):光标 + placeholder,用户得自己想该打什么字。**空对话框 = 不知道该打啥 = 发懵**。开放式 chat 对工程师友好,对采购是负担。

### Trace 证据(`packages/eval/cases/procurement*.yaml` 的真实 `input`)

真实请求极短,绝大多数**只有一个型号**:

```
帮我找一下 MT53E512M32D1ZW-046 AAT:B
找料 TLP350(F)
找料 ICM-42688-P
```

少数分支:

```
内部库存没有。继续帮我查平台，型号 X      ← 主流程续接
库存只有一家，帮我按 Omron 补几个供应商候选  ← 补供应商
把动态库存结果整理给采购看                 ← 整理输出(后续动作)
```

**两个关键事实:**

1. 用户**不输**数量、备注、品类——价格/数量是**结果里带出来的**,不是输入。表单字段必须极简。
2. 「找料」是一条**自动链**:给型号 → 先查内部库存 → 没有再查平台 → 整理给采购。所以「查本地库存 / 查价格 / 识别型号」**不是独立入口**,是这一个流程的内部阶段,agent 自动串。

> 因此:按钮按**采购的工作流程**划分,**不是**按底层 skill 划分。

---

## 2. 核心判断:任务表单 = 前端文字撰写器,零服务端改动

现有的 `StructuredInput`(权限/凭证/管理员审批)是 **agent 驱动**的:agent 发请求 → 服务端推状态 → UI 弹表单 → 用户答 → `StructuredResponse` 回传给等待中的 agent。这条路**碰服务端协议**。

任务表单**不走这条路**。它是**纯前端的文字撰写器**:

```
点「找料」→ 填型号 → 提交时按模板拼成一句话
  → "帮我找一下 TPS92550TZX"
  → 调用现成的 onSubmit(text)        // FreeFormInput.tsx:143 已有的入口
  → 当成普通用户消息发出去
  → skill 靠文本自动触发(<available_skills> 注入机制),原样命中
```

**为什么这是"好品味"——消除特殊情况:**

- 任务表单产出的字符串,和老练用户**手打的一模一样**。
- **服务端 / agent / 协议零改动**——收到的就是一条措辞规整的普通消息。
- **没有新消息类型、新事件**——复用 `onSubmit(message, attachments?, skillSlugs?)`。
- skill 触发系统本来就认文本,**模板里嵌好触发词就自动命中**。
- 不碰生产 agent 运行时(上次 chat 因运行时改动崩过一次;能不碰就不碰)。

---

## 3. 数据结构:声明式注册表,加任务 = 加一个对象

```ts
type TaskFieldType = 'text' | 'textarea' | 'select'

interface TaskField {
  key: string                 // 模板取值用
  label: string               // "型号" / "需求型号"
  type: TaskFieldType
  placeholder?: string
  required?: boolean
  options?: string[]          // select 用
}

interface TaskForm {
  id: string                  // 'find' | 'alt' | 'compare' | 'supplier' | 'doc'
  label: string               // 按钮文字 "找料"
  icon: string                // lucide 图标名
  fields: TaskField[]
  /** 把字段值拼成触发消息;字段缺失时给出可用默认 */
  toMessage: (v: Record<string, string>) => string
}

const TASK_FORMS: TaskForm[] = [ /* 见 §4 */ ]
```

**一个通用表单渲染器**按 `fields` 渲染,**不给每个任务单独写组件**。加任务只加一行配置——维护成本最低。

---

## 4. 五个工作流按钮(按采购真实动作)

| # | 按钮 | 字段(极简) | `toMessage` 产出 | 触发 skill |
|---|---|---|---|---|
| ① | **找料**(主线 ~85%) | 型号* | `帮我找一下 {型号}` | local-inventory → platform-search 自动链 |
| ② | **找替代料** | 型号* | `帮我找 {型号} 的替代料` | alternative-search |
| ③ | **能不能替** | 需求型号* · 报价型号* | `需求型号 {需求}，报价型号 {报价}，这俩能不能替代、有没有区别?` | part-mismatch-review |
| ④ | **补供应商** | 品牌/品类* | `帮我按 {品牌} 补几个供应商候选` | supplier-shortlist |
| ⑤ | **生成单据** | 订单来源* · 模板(select) | `把 {来源} 这单按 {模板} 生成请款单(PI)` | doc-export |

字段约定:

- 标 `*` = 必填。必填空着 → 提交按钮禁用。
- 模板 select(⑤)当前只有 `美金请款发票 PI`(doc-export 现仅实现这一个),其余模板补齐后再加选项。
- **本期不做**:数量、备注、品类字段(trace 里用户不输);「找料」批量贴多行(单型号框,之后改进)。

图标(lucide)初定:找料 `Search` · 找替代料 `Replace` · 能不能替 `GitCompareArrows` · 补供应商 `Users` · 生成单据 `FileText`。

---

## 5. 渲染时机与状态机

复用 `InputContainer` 现有的 **freeform ↔ structured 切换槽**,新增第三态 `task`:

```
InputContainer mode:
  'freeform'    现有自由文本框
  'structured'  现有 agent 驱动表单(权限/凭证/审批)
  'task'        新增:任务启动器(本设计)
```

状态流:

```
空会话(无消息)
  └─ mode = 'task',渲染【任务启动器网格】(5 个按钮 + 「直接说…」)
       ├─ 点某任务 → 渲染【该任务表单】(通用渲染器 + 该 TaskForm.fields)
       │    ├─ 填好 → 提交 → toMessage() → onSubmit(text) → 回正常聊天流
       │    └─ 「返回」→ 回到网格
       └─ 点「直接说…」→ 切到 mode='freeform'(现有 FreeFormInput,逃生口)

会话已开始(有消息)
  └─ mode = 'freeform' 为主;输入框旁留一个小「任务」按钮 → 重新唤出网格
```

**逃生口是硬约束**:老练用户、追问、整理输出等场景必须能随时切回自由打字。**永不破坏现有自由输入路径。**

---

## 6. 集成点(文件清单)

| 文件 | 改动 |
|---|---|
| `app-shell/input/task-forms.ts`(新) | `TaskForm` / `TaskField` 类型 + `TASK_FORMS` 注册表 + `toMessage` |
| `app-shell/input/TaskLauncher.tsx`(新) | 启动器网格(按钮)+ 通用表单渲染器 + 「直接说…」逃生口 |
| `app-shell/input/InputContainer.tsx` | 加 `'task'` 模式分支;空会话默认进 `task`;提交走 `onSubmit` |
| `app-shell/input/structured/types.ts` | `InputMode` 增加 `'task'` |
| `app-shell/input/ChatInputZone.tsx` | 透传"是否空会话""重新唤出网格"的状态 |
| i18n 资源 | 5 个按钮 label、字段 label、placeholder、「直接说…」「返回」「任务」 |

**不新增**:任何服务端文件、协议字段、消息 role、agent 改动。

---

## 7. 错误处理

- 必填字段空 → 提交按钮禁用(不弹错)。
- `toMessage` 对缺失非必填字段给安全默认(不产出 `undefined`/空占位)。
- 整个启动器包在现有 `InputErrorBoundary` 内;渲染异常时回退到 `FreeFormInput`,不让输入区整块崩。
- 提交后清空表单状态、`mode` 交回聊天流(由消息流驱动转 `freeform`)。

---

## 8. 测试

- **`task-forms` 单测**:每个 `TaskForm.toMessage` 对样例输入产出预期字符串(模板拼接正确、无 `undefined`)。
- **触发命中**:产出的消息字符串包含对应 skill 的触发词(对照 SKILL.md 的"当用户问…时使用")——保证点按钮 = 命中正确 skill。
- **渲染器**:`text`/`textarea`/`select` 三类字段各渲染正确;必填空 → 提交禁用。
- **逃生口**:「直接说…」切到 `freeform`;会话开始后「任务」按钮唤回网格。

---

## 9. 本期范围(明确边界)

**做:**
- 5 个工作流按钮(①找料 ②找替代料 ③能不能替 ④补供应商 ⑤生成单据)
- 通用表单渲染器 + 声明式注册表
- 空会话进启动器、逃生口、会话中唤回

**不做(之后改进):**
- 「找料」批量贴多行型号
- `feishu-table-fill`(填表)入口——它是**结果出来后的后续动作**,跟在结果卡片旁,不是启动器入口
- `platform-search-more`(加货源)、`model-info`、`local-inventory` 独立按钮——是「找料」流程内部阶段
- 数量/备注/品类等富字段
- ③⑤ 先做粗,字段/模板之后按真实使用打磨
