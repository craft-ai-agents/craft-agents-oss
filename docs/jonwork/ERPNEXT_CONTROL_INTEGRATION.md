# ERPNext 中控接入 v1.0：授权查询与公共技能

## 本轮交付与边界

2026-08-31：在 `packages/server-core/src/webui/jonwork-control.ts` 新增服务端适配器，
在已有 `http-server.ts` 中增加可关闭的接入点及授权查询接口。未修改 ERPNext 核心、
`jonwork-control` 扩展、客户端界面、账号库、会话执行、扣费/退款、技能源文件和成果验收逻辑。
已有未提交改动保持原样；没有重启服务、安装应用、迁移数据库或改写业务数据。

质量规范继续使用 `H5_TO_CRAFT_MIGRATION_AND_QUALITY_BASELINE.md`：
Brief 确认、真实成果、manifest v2、逐项证据与用户最终批准不变。
本轮契约测试的技能文件是测试夹具，不代表 14 个业务模块真实生成验收通过。

## 复用的服务契约

读取相邻 `jonwork-control/jonwork_control/api.py` 的现有接口，服务端发起 POST：

| ERP 方法 | 用途 | 客户端可见内容 |
| --- | --- | --- |
| `get_entitlement` | 绑定授权与账号一致性校验 | 当前账号授权状态、整数积分、到期时间、`ledger_only` |
| `public_releases` | 当前已发布版本的完整目录 | 由既有技能接口转换输出 |
| `public_release_bundle` | 获取选定版本，验证 SHA-256 | 既有 `AccountSkillBundle` 格式 |

不调用 `record_usage`，不把客户端事件或模型 token 自动换算为积分。
当前 ERP 接口的 `ledger_only` 不是实时计费或执行许可的保证。
授权未启用、到期或中控不可用时，启用中控的技能接口拒绝请求，不回退旧公共目录。
积分为零但授权有效时仍允许查看技能，与 ERP 目录接口保持一致。

## 配置与启用

仅在隔离验证环境完成后启用。部署前必须确认中控 Frappe app 已正确安装，
`JW Plan`、`JW Subscription`、`JW Usage Event`、`JW Skill Release` 等 DocType 已存在，
接口及集成角色权限已经实测。源码存在不等于应用已安装；本轮未执行该部署步骤。

在 Craft Server 的服务端运行环境同时注入以下配置，不放入 renderer/Vite 环境或 Git：

- `JONWORK_CONTROL_URL`：HTTPS 源站，不带路径、用户名、查询或片段。
  仅 `http://127.0.0.1:8081` / IPv6 回环允许 HTTP，用于本机隔离开发。
- `JONWORK_CONTROL_BINDINGS`：JSON 对象，以真实 Craft 账号不透明 ID 为键，
  值包含 `subscription`、`apiKey`、`apiSecret`。这里不提供真实凭据或可误用的账号样例。
  每个账号使用不同授权和专属集成用户 API Key；不得复用跨客户身份。

在 ERP 授权记录中设置同一个 `account_id` 和专属 `integration_user`。
账号来自现有登录状态，而非浏览器传入的 customer/account/workspace 参数。
配置完整后通过原有受控部署流程重启 Server；没有热更新，续期绑定变更也需重新加载进程。
配置缺一、格式无效、重复绑定时启动失败，避免静默降级。
未配置两个变量时保持原模式。测试/嵌入服务可用 `jonworkControl: null` 显式关闭环境配置。

移除两项配置并重启可恢复原公共技能目录；没有数据库迁移或文件覆盖需要回滚。
这会恢复原模式，不是撤销已下载的技能，正式停用需管理员明确决定。

## 用户入口与数据隔离

新增 `GET /api/account/entitlement`，支持已有桌面 Bearer 和浏览器 Cookie。
返回 `Cache-Control: no-store`；未配置时返回 `{ "configured": false, "enforcement": "local" }`。
启用时只返回当前账号的白名单字段；没有新的客户端授权状态面板。

既有 `/api/account/skills` 入口保持原响应格式，因此当前桌面技能同步、浏览器技能页
无需新路由或第二套登录。每次请求重新读取发布目录，同 slug 按数字版本选择最高版本。
同次快照中途失败时整个请求失败，不返回部分成功；有超时、响应大小和快照总量限制。
公共技能只读，私有技能仍通过原乐观版本校验保存；历史同名私有技能优先，不被覆盖。
不上传私有文件、聊天内容、工具结果或用户凭据到 ERP。

文件包校验涵盖版本/哈希、严格 Base64、目录穿越、Windows 特殊路径、敏感文件、
大小、重复路径与 YAML 头部。禁止 JavaScript frontmatter，避免解析数据时执行代码。
错误不转发 ERP 原始响应/堆栈，不输出服务端凭据；认证请求拒绝重定向。

## 验证记录

命令（在 v1.0 根目录执行）：

```powershell
bun test packages/server-core/src/webui/__tests__
bun run tsc --noEmit --project packages/server-core/tsconfig.json --pretty false
```

WebUI 测试：24 项通过（新增 7 项，原有 17 项）。覆盖桌面/浏览器同账号访问、
越权/参数注入、配置错误、数值版本、撤回后新快照、内容篡改、不安全文件、私有同名保护、
中控故障不泄露内部错误，以及未改变本地积分。

TypeScript 检查：本轮新增实现与测试无诊断；整包仍有 6 项原有错误，均在
`webui/__tests__/account-skills.test.ts` 第 95–102 行，原因是 `Response.json()` 的结果类型为 unknown。
为避免修改原有代码，未顺带修复，不能宣称整包类型检查通过。

这些是接口契约与回归测试，不是对真实 ERP 服务的端到端验收。未使用真实密钥或收费模型。

## 后续上线门禁

1. 隔离环境安装/验证中控 DocType、角色与审核流程，用两位测试账号完成真实 HTTP 联调。
2. ERP 发布新公共版本后，在桌面/浏览器原技能入口同步，核对内容、附件、只读状态；
   下架后再次同步确认该版本消失。保留界面和网络验证证据。
3. 当前撤回只影响后续成功同步；不清除离线缓存、不终止运行中会话，也不宣称全局即时撤权。
   桌面同步失败时已有执行缓存可能仍在，强制撤权需后续执行门禁设计。
4. 授权查询尚未接入消息/工具执行拦截；本地积分显示和扣费仍是原账本。
   要统一实际计费，先定义价格/计量规则并实现持久化预占、结算、退款、幂等与失败重试，
   再切换唯一账本，禁止同时扣两套余额。
5. 中控目录最多 1000 条，本轮全量快照上限 32 MiB、同步预算约 30 秒加最后单次请求超时；
   超限明确失败。规模扩大需分页/增量协议，不能截断后伪装完整成功。
