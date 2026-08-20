# Craft Agents — гайд для агентов и контрибьюторов

Этот файл читают кодовые агенты, работающие в этом репозитории (форк `craft-ai-agents/craft-agents-oss`), и привязан к нашей runtime-интеграции с OMP.

## Стек и воркфлоу
- Менеджер: **Bun** (`bun install`, isolated linker).
- Тесты: `bun test <path>`; typecheck: `bun run tsc --noEmit` внутри пакета.
- i18n: ВСЕ user-facing строки — через `t()` из react-i18next; переводы в `packages/shared/src/i18n/locales/*.json` (10 локалей: de, en, es, fr, hu, ja, pl, ru, zh-Hans, zh-Hant; ru — дефолт UI-язык, `fallbackLng: ['ru','en']`). Новый ключ → все 10 файлов, ключи ASCII-сортировкой; паритет проверяется `bun test packages/shared/src/i18n`.
- Русские плюральные ключи: `_one/_few/_many`; `_other` добавляем по польской конвенции.

## OMP-бэкенд (провайдер `omp`)
Локальный агентный рантайм `omp` (oh-my-pi CLI, `--mode rpc`, NDJSON) поднят как первоклассный бэкенд:

- Реализация: `packages/shared/src/agent/omp-agent.ts` (OmpAgent extends BaseAgent).
- Протокол: `docs/omp-rpc-notes.md` (**обязательно к прочтению перед изменениями транспорта** — там критичный факт про обязательные `extension_ui_response` и shape `set_model`).
- Интеграционный гэп/статус: `docs/omp-integration-gap.md`.
- Подключение дефолта: `storage.ts#seedDefaultLlmConnection` создаёт `rox-kimi` (providerType `'omp'`, authType `'none'`, defaultModel `kimi-K3`) — OMP берёт auth из `~/.omp/agent/config.yml`.
- Permission mapping: craft `allow-all` ⇄ `--approval-mode yolo` (spawn-time, флип режима = респавн); `ask/safe` — диалоги `extension_ui_request`-времени проксируются в craft-пермишны.

### Craft-инструменты внутри OMP (host tools)
OmpAgent публикует craft-сессионные инструменты в OMP через `set_host_tools`:
- что: registry `BASE_SESSION_TOOL_PROXY_DEFS` (spawn_session, call_llm, browser_tool, mcp__session__* и др.), loadMode `'essential'` — иначе инструменты «прячутся» от модели;
- как: OMP шлёт `host_tool_call` → OmpAgent исполняет тем же кодом, что PiAgent (`preExecuteSpawnSession`, SESSION_TOOL_REGISTRY, browser pane fns) → `host_tool_result {content:[{type:'text',text}]}`;
- в ask/safe — перед исполнением спрашиваем у пользователя через craft permission + `respondToPermission` (120с fail-safe deny);
- **не** прокинуто (v1, осознанно): MCP source-proxy tools из mcpPool, resume из OMP-sessio store, branching.

### Зеркалирование сессий
OMP запускается с `--session-dir <workspace>/sessions/<craftSessionId>/omp` (БЕЗ `--no-session`): транскрипт OMP лежит рядом с craft-транскриптом — история дублируется в обоих сторах, без конфликтов. Resume читается только из craft (источник истины).

### Runtime-контекст агента
При каждом spawn OMP получает `--append-system-prompt` с `OMP_CRAFT_CONTEXT_PROMPT` (в omp-agent.ts): агенту прямо сказано, что он работает внутри Craft Agents, какие host tools доступны, что статусы/теги ведёт craft.

## Режимы и дефолты
- `workspaceDefaults.permissionMode = 'allow-all'` («Выполнение») — дефолт новых сессий; восстановленные сессии без явного режима тоже default'ся в allow-all (SessionManager.defaultRestorePermissionMode).
- Явно сохранённый пользователем режим сессии — wins.

## Как добавить новый провайдер бэкенда
1. `LlmProviderType` + `AgentProvider` + zod-enum в `packages/shared/src/config/validators.ts` (иначе ConfigWatcher пометит invalid).
2. `createBackend` case + driver registry в `backend/factory.ts`.
3. Класс extends BaseAgent с абстрактными `chatImpl/abort/forceAbort/isProcessing/respondToPermission/runMiniCompletion/queryLlm`.
4. UI: группа в `model-picker-helpers.ts`, лейбл в `AiSettingsPage`, пресет в onboarding (`ProviderChoice` + `useOnboarding.handleSelectProvider`).
