# Jonwork v2 与 ERPNext 生产部署

## 固定边界

- `https://v2.jonwork.com`：WebUI、账号/API、桌面端登录中转、安装包下载和自动更新。
- `https://erp.jonwork.com`：ERPNext 登录、管理员后台、身份、权限与额度。
- 不修改、不代理也不依赖 `www.jonwork.com`，不新增第三个公开业务域名。

## ERPNext SSO

ERPNext OAuth Client 的唯一回调地址为：

```text
https://v2.jonwork.com/api/auth/sso/callback
```

Jonwork 服务端使用 `JONWORK_SSO_*` 环境变量连接 ERPNext。客户端只获得 Jonwork 会话；ERPNext access token、OAuth client secret 和集成 API 密钥不得进入浏览器、桌面包或日志。

`ErpControlRuntime` 是身份、授权、账本和技能资源同步的唯一 ERP 运行时。早期 `JonworkControl` 适配器及 `JONWORK_CONTROL_URL`、`JONWORK_CONTROL_BINDINGS` 已移除；部署配置中如仍有这两个变量，应在备份后删除，禁止同时启用两套 ERP 链路。

ERP `get_access_snapshot` 的 `role` 支持 `admin` 和 `user`。当前管理员应返回 `admin`，并显式返回全部已批准的 `models`、`skills`、`sources` 和最大允许并发。禁止使用 `*` 通配符。ERP 角色变化会同步到 Jonwork，并递增会话版本使旧 Cookie/Bearer 会话失效。

模型默认值由 ERP 中央策略的可选字段 `default_model` 控制，且该值必须同时存在于 `models` 授权列表中。为兼容尚未下发此字段的 ERP，Jonwork 当前依次选择 `pi/deepseek-v4-pro`、其他已授权 DeepSeek 模型、`models` 第一项。默认值只影响新会话，不改写已有会话的模型。

企业文本 Agent 使用项目范围执行配置：只注册当前项目内的读取、写入、编辑和检索工具，并允许只读访问该账号经 ERP 校验后物化的技能目录；不注册 Bash、浏览器、跨会话代理和任意数据源工具。路径执行前必须同时通过规范化范围检查和真实路径/符号链接检查。未绑定 ERP 隔离策略的旧多账号入口继续拒绝 Agent 执行。

## 下载与更新

生产发布物统一经 `v2.jonwork.com` 暴露：

```text
/downloads/Jonwork-Setup-x64.exe
/desktop/updates/latest.yml
/desktop/updates/Jonwork-Setup-x64.exe
```

安装包和更新文件不提交 Git，也不打进 WebUI 镜像。由发布 CI 完成 Windows 签名、SHA-256 记录和上传，再由 `v2.jonwork.com` 的反向代理/CDN 路径映射到只读制品存储。发布必须保证安装包文件名与 `apps/electron/electron-builder.yml` 一致，并先上传版本文件、最后原子切换 `latest.yml`。

建议的反向代理路由顺序：

1. `/downloads/` 和 `/desktop/updates/` 转发到只读制品存储，禁止目录列表和上传方法。
2. `/api/`、`/ws` 与 WebUI 流量转发到 Jonwork Server。
3. 仅对 `/api/auth/sso/callback` 接受 ERPNext OAuth 回调；所有 Cookie 强制 Secure。

## 上线门禁

```powershell
bun run validate:desktop-release
bun run test:desktop-production
bun run typecheck:all
bun run validate:desktop-production
$env:JONWORK_RELEASE = 'production'
PowerShell -ExecutionPolicy Bypass -File apps/electron/scripts/build-win.ps1
```

最后一项必须在持有 Windows 代码签名凭据的受控构建环境执行。上线验收至少覆盖：网页登录、桌面设备登录、管理员接口、角色降级后旧会话失效、安装包下载、签名验证、自动更新和回滚。
