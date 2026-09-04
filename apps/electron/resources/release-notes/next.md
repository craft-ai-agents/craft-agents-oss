# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

- **Masked editing and visual diagnostics** — Local remodeling now offers region painting and passes the real mask through task execution, retaining it for explicit retries. Unsupported masked-edit interfaces fail instead of silently editing the whole image. Design decomposition, health checks and benchmark diagnosis can generate image-grounded Markdown draft reports; empty model responses and incomplete report counts cannot complete delivery.

- **Direct design workflows** — Canvas users can select input images, choose sketch rendering, scene editing, form/custom fusion or CMF, and request 1–4 outputs without manually building generation nodes. Inputs are explicitly referenced in order, originals are preserved, and missing or partial outputs cannot complete a request. Results remain drafts for design review.

- **Canvas business handoff** — Image/text generation now waits for actual outputs before acknowledging success. Results are saved as immutable files in the originating task, with preview, folder and continuation actions. Failed saves can be retried without regenerating; partial generation stays failed for review.
- **Account lifecycle controls** — Public signup is now opt-in and cannot create the initial administrator. Operator bootstrap, admin-created users, disable/re-enable, password reset and bounded audit retrieval are available; account changes invalidate previous sessions without deleting projects.
- **Persistent-session revocation** — Named-account RPC connections recheck authorization before requests, replies, pushes and heartbeat. Cookie logout is durable, new logins receive distinct token IDs, and revoked sessions cannot replay buffered private events.
- **HTTP input limits** — Authentication/admin bodies are capped at 16 KiB, other WebUI bodies at 2 MiB, with bounded body-read time. Slow or oversized bodies are rejected before business operations.
- **Canvas delivery safeguards** — Canvas operations are bound to their project and persisted with delivery acknowledgements. Failed/uncertain operations remain visible instead of being discarded; generation is not automatically retried. Empty customer canvases are no longer seeded with demo content.
- **Production startup checks** — Missing model configuration or credentials now block production startup and message submission even when onboarding was previously deferred. Users can retry without resetting local projects; actual service connectivity still requires deployment acceptance.
- **Independent desktop distribution** — Public release configuration controls the account service, update feed, and sharing service. Updates and public sharing are disabled until explicitly configured. Production builds use a separate Jonwork profile and require signing/build-provenance checks; uninstall preserves application data.
- **Durable account billing** — Account mutations and desktop charge/refund records use SQLite transactions. Repeated request IDs do not charge twice, refunds survive restarts, and legacy account JSON remains as a pre-migration backup. This does not yet provide trusted model-job metering or asynchronous job settlement.
- **Account boundary hardening** — Desktop account IPC validates the top-level renderer, account requests reject redirects and use bounded time/size limits, and logged-out desktop tokens remain revoked after account-service restarts.

## Bug Fixes

## Breaking Changes

- **Account enrollment** — Public registration defaults to disabled. Initialize the first administrator on the service host via the protected-stdin bootstrap tool; public signup never grants administrator rights. New enrollments and password resets require 12–128 characters. Deploy all account-service instances together so older services cannot accept revoked sessions or bypass enrollment policy.
- **Desktop charge API** — `/api/account/charge` now requires a JSON `requestId` (16–128 alphanumeric, underscore or hyphen characters). Refunds are idempotent. Deploy the account service before distributing the matching client; older clients without request IDs cannot charge.
## Fixed

- **统一 ERPNext 登录** — 移除桌面端 Craft 用户名与密码入口；用户先登录 ERPNext，再把企业身份、权限、项目和积分同步到 Craft。
- **网页下载与会话恢复** — 网页端账户菜单新增 Windows 客户端下载；桌面端首次通过 ERPNext 登录后使用系统安全存储保存会话，正常重启自动恢复，过期会话统一重新进入 ERPNext 登录。

- **企业技能授权与充值续跑** — 固定画布工作流现在同时校验 ERP 技能及模型授权；余额不足发生在供应商派发前时，不再留下不可恢复的提交标记，充值后可安全继续原任务，结果未知的收费请求仍禁止自动重发。
