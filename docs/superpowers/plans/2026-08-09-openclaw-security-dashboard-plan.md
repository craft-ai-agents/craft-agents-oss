# Craft Agents + OpenClaw — план реализации

> Утверждённая спецификация: `docs/superpowers/specs/2026-08-09-openclaw-security-dashboard-design.md`  
> Цель: Craft управляет локальным изолированным OpenClaw runtime на workspace и показывает русскую панель аудита безопасности Craft + OpenClaw.  
> Ограничение: локальная установка OpenClaw `2026.7.1-2` не имеет Fleet; v1 использует capability-gated managed runtime, не Fleet и не системный `PATH` binary.

## Инварианты на весь план

- Только `shell:false`, absolute executable и fixed argv. Никаких user-provided command/path/port/env/URL.
- OpenClaw token только в `CredentialManager` и минимальном child env; не в config/argv/URL/renderer/logs/snapshots.
- Не трогать `~/.openclaw`, system daemon, существующий OpenClaw процесс или profile.
- Standard audit — только explicit read-only `security audit --json`; `--deep` отдельно; `--fix` не реализовывать.
- Remote WebUI получает audit/status, но не Control UI, loopback URL, port или token material.
- Тест писать до реализации каждого observable contract; mid-flight не запускать полные suite/lint/build. Один финальный validation pass после merge.

## P0 — Контракты и тестовые fixtures

**Владелец:** Core runtime slice.

1. Добавить shared модели `OpenClawRuntimeStatus`, `RuntimeState`, `AuditMode`, `SecurityDomain`, normalized `SecurityFinding`, `SecurityAuditSnapshot`, acceptance и controlled safe error code.
2. Добавить deterministic finding fingerprint и checkId → seven-domain mapping; unknown checkId сохранять как `other`.
3. Добавить fixtures: valid standard/deep OpenClaw audit JSON, malformed JSON, oversized output, token/path-like strings, plugin-detail injection, stopped runtime.
4. Написать unit-тесты redactor, schema parser, mapper, acceptance expiry и retention до service implementation.

**Файлы:** новый `packages/shared/src/openclaw/**` или ближайший существующий shared domain; `packages/shared/src/**/__tests__/**` по принятой локальной convention.

**Гейт:** fixture tests выражают AC-5, AC-6, AC-8, AC-9 и AC-13 до runtime implementation.

## P1 — Managed OpenClaw toolchain runtime

**Владелец:** Supply-chain slice.

1. Добавить `openclaw` как opt-in ToolName в `packages/shared/src/toolchain/types.ts` и manifest data.
2. Зафиксировать exact NPM tarball, SHA-256, package version, required Node version и embedded package-lock в `npm-locks.ts`; выполнить provenance + lifecycle script review. Не добавлять OpenClaw в `NPM_SCRIPTS_ALLOWLIST`.
3. Реализовать resolver managed launcher: bundled toolchain Node + exact installed `openclaw.mjs`; запретить fallback к `PATH`.
4. Добавить capability probe для `gateway run`, `gateway health`, `security audit --json`, `config validate`; любой missing/shape mismatch → `unsupported`.
5. Тесты: manifest/lock completeness, no-PATH fallback, `--ignore-scripts` first and only install path, unsupported runtime.

**Файлы:** `packages/shared/src/toolchain/{types.ts,manifest-data.ts,npm-locks.ts,resolver.ts,installer.ts,manager.ts}` плюс tests.

**Гейт:** managed OpenClaw не запускается, пока chain integrity/capability не доказана.

## P2 — Runtime manager и безопасное provision

**Владелец:** Core runtime slice.

1. В `packages/server-core/src/openclaw/` создать `OpenClawRuntimeManager`, immutable runtime record store и per-runtime async lock.
2. Derive opaque runtime ID from internal workspace identity; создать contained state/config/workspace/audit roots с owner-only permissions и symlink rejection.
3. Создать hardened baseline config; token генерировать cryptographically, сохранить отдельным `CredentialManager` id, передать только environment allowlist.
4. Выделять/проверять base port и производный browser/CDP block без `--force`; detect conflict → `PORT_CONFLICT`, никогда не kill чужой process.
5. Запускать foreground child с bounded stdout/stderr, health probe только exact loopback host/port, graceful stop; owned child PID/launch nonce обязательны для stop.
6. На Craft shutdown закрывать owned process; crash/timeout превращать в controlled runtime state.
7. Тесты fake executable: state machine, concurrent start lock, path traversal/symlink, port conflict, no raw token in argv/logger, graceful stop.

**Файлы:** `packages/server-core/src/openclaw/**`, credential type/source additions только если нужен new typed id, targeted tests.

**Гейт:** AC-2, AC-3, AC-4, AC-10, AC-11 реализованы без зависимости от renderer.

## P3 — Security audit service и redacted persistence

**Владелец:** Audit service slice.

1. Создать `CraftSecurityCollector`: permissions, extension capability classes/status, credential health metadata, server bind/TLS/insecure status, toolchain readiness; не читать `StoredCredential.value` и `ServerStatus.token`.
2. Создать `OpenClawSecurityCollector`: fixed runtime command `security audit --json`; 30-second timeout, 1 MiB stream cap, strict schema allowlist, safe error codes.
3. До IPC/persistence применить redactor к secret-like data и absolute runtime paths; discard `secretDiagnostics`, raw stderr and unknown top-level fields.
4. Реализовать redacted snapshot JSONL retention (max 30 / 90 days) и independent local risk acceptance store with rationale/expiry; никогда не менять OpenClaw suppressions.
5. Реализовать deep audit как отдельный explicit mode; stopped/missing runtime → truthful unavailable coverage.
6. Тесты: all collectors, output mutation, missing/deep failures, retention, acceptance expiry, telemetry/logger leak assertions.

**Файлы:** `packages/server-core/src/openclaw/**`, возможный reusable persistence primitive рядом с existing audit patterns, tests.

**Гейт:** AC-5, AC-6, AC-8, AC-9, AC-12 выполняются на deterministic fixtures.

## P4 — RPC, host-only control и lifecycle integration

**Владелец:** Transport slice. Зависит от P0–P3 public types.

1. Добавить channels `securityAudit:*` и `openclawRuntime:*` в `packages/shared/src/protocol/channels.ts`.
2. Добавить validated request/response types в Electron API declaration и `apps/electron/src/transport/channel-map.ts`; сохранить channel-map parity.
3. Зарегистрировать server-core handler в `packages/server-core/src/handlers/rpc/index.ts`; dependency injection manager через `HandlerDeps`/bootstrap.
4. Оставить status/audit/acceptance remote-eligible; `openControlUi` и `copyGatewayTokenForSetup` реализовать только как отдельную Electron preload → main IPC capability.
5. Не добавлять host-control методы в `RPC_CHANNELS`, `CHANNEL_MAP`, server-core WebSocket handler или WebUI API: существующая channel routing classification не является server-side authorization boundary.
6. Main-side host control проверяет known local Electron sender и explicit confirmation; Control UI открывает только internally sourced exact loopback origin в dedicated isolated BrowserWindow/session; no proxy, no token URL. Token-copy делает clipboard effect и возвращает `void`.
7. Тесты: request validation, WebUI routing/channel parity for data APIs, direct IPC sender/confirmation, absent host-control WebUI capability and no-secret serialized responses.

**Файлы:** `packages/shared/src/protocol/channels.ts`, `packages/server-core/src/handlers/{handler-deps.ts,rpc/index.ts,rpc/openclaw.ts}`, Electron `preload/bootstrap` и main handler/bootstrap, `apps/electron/src/{shared/types.ts,transport/channel-map.ts}`, focused tests.

**Гейт:** API соответствует §9 спецификации; renderer не может вызвать generic child process or recover secret material.

## P5 — Русская панель «Безопасность»

**Владелец:** UI slice. Зависит от P4 API contract; может реализовываться параллельно с P2/P3 на typed mock fixtures.

1. Добавить `security` в `apps/electron/src/shared/settings-registry.ts`, component registry и settings icons согласно существующему pattern.
2. Добавить `SecuritySettingsPage` с runtime status, freshness/coverage, standard/deep audit CTA, latest snapshot and safe error states.
3. Построить reusable accessible `SecuritySnake`: семь доменов; left=open ingress, right=excess capability, center=balanced, dashed=partial/unavailable; icon/text/ARIA equivalent for every color.
4. Добавить finding list/filter/drawer: what/why/fix + leave/accept/fix. Acceptance form validates 10–500 rationale characters and expiry 1–365 days.
5. Ввести explicit confirmation dialogs for install/provision/start/stop/open Control UI/copy token. `Исправить` в OpenClaw даёт plan/deep-link only; no `--fix`.
6. Добавить полностью русские i18n keys во все required locales per repository parity rule; русская формулировка является canonical UX.
7. UI tests: Russian key parity, snake semantics and keyboard navigation, coverage states, risk acceptance expiry, confirmation cancellation, HOST_ONLY view.

**Файлы:** settings registry/component map/icons, new page/components/hooks, locales, focused renderer tests.

**Гейт:** AC-1, AC-7, AC-10, AC-13; desktop и WebUI shared renderer не расходятся.

## P6 — Интеграция и финальная проверка

1. Resolve merge conflicts only against current user changes; не затрагивать unrelated files.
2. Run targeted tests for P0–P5, then typecheck affected packages, i18n parity and project-recommended focused test group.
3. Run isolated fake-runtime integration scenario: install/provision → start → health → standard audit → accept risk → deep unavailable → stop.
4. Launch the actual Craft development build and exercise the security page visually through Electron/WebUI where practical. Do not provision or change the user’s real OpenClaw runtime during smoke testing.
5. Run independent read-only security review of process/env/output boundaries and API/UI data leaks; fix verified issues.
6. Update the design/spec only if implementation discovers a requirement gap; do not add scope outside approved document.

## Dependency graph

```text
P0 ─┬─ P2 ─┬─ P3 ─┬─ P4 ─ P5 ─ P6
    └─ P1 ─┘      │
                  └─ tests/fixtures
```

P1 and P2 may run in parallel after P0. P5 may begin with fixture-backed UI after P0, but binding to live RPC waits for P4. P6 begins only when every slice delivers its focused tests and no secret-bearing interface remains.
