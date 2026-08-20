# S-06. Plugin Bridge: проекция SiYuan-плагинов в Craft Contribution Registry

> **Doc id:** S-06 · **Статус:** draft · **Дата:** 2026-08-07
> **Входные документы:** att2 «Единая оболочка» §5 (проекция SiYuan Plugin API), §6 (уровни совместимости L0–L3), §13 (как не сломать существующие SiYuan-плагины), §18 (что не делать); [S-01 Слоты оболочки](./01-shell-slots.md); [S-02 Surface Registry](./02-surface-registry-tabs.md); [S-03 Панели и rails](./03-panels-rails.md); [S-04 Omnibox](./04-omnibox.md); [S-05 Extension Center](./05-extension-center.md); [K-03 Knowledge Provider Contract](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md); [K-07 Connection Modes](../2026-08-07-siyuan-integration/07-connection-modes.md)
> **Grounding:** apps/electron/src/main/browser-pane-manager.ts (`createEmbeddedInstance`); apps/electron/src/renderer/pages/BrowserPanelPage.tsx (host-surface); apps/electron/src/renderer/actions/{definitions.ts,keybinding-context.ts}; packages/shared/src/protocol/{channels,routing,events}.ts

---

## 1. Цель

Подключить экосистему SiYuan-плагинов (Bazaar) к Craft так, чтобы:

1. **Ни один существующий плагин не ломался** — гарантия работоспособности через уровни совместимости L0–L3 и неубираемый compatibility mode;
2. Поддерживаемые плагины становились **нативными гражданами оболочки**: команды в палитре, вкладки в Surface Tabs, панели в слотах, действия в контекстных меню;
3. Код плагинов **исполнялся внутри SiYuan runtime** (kernel + editor bundle), а не в Electron main и не в Craft Extension Host;
4. Мост был **проекцией, а не переписыванием**: SiYuan Plugin API не уничтожается, его примитивы отображаются в Craft Contribution Registry.

## 2. Контекст и мотивация

SiYuan Plugin API оперирует почти тем же словарём, что и целевая оболочка Craft: команды (`addCommand`), контекстные callback (меню editor/tree/dock), собственные вкладки (`addTab`), dock-панели на шести позициях (`LeftTop/LeftBottom/RightTop/RightBottom/BottomLeft/BottomRight`), верхняя/нижняя панели, event bus, настройки (`Setting` + `loadData/saveData`), agent actions. Это означает, что **уничтожать API не нужно — нужна адаптирующая проекция**:

```
SiYuan Plugin  →  SiYuan Bridge Adapter  →  Craft Contribution Registry
                                              {commands / tabs / panels /
                                               menus / agent actions}
```

Одновременно верно и обратное: сотни плагинов Bazaar писались под ПОЛНЫЙ chrome SiYuan (собственный левый rail, status bar, dock-layout, горячие клавиши). В craft-оболочке этот chrome скрыт (см. [S-01](./01-shell-slots.md): «второй глобальный shell не оставляем»). Значит, UI таких плагинов нельзя «перенести» автоматически — att2 §18 прямо запрещает авто-перенос DOM любого SiYuan-плагина. Решение — уровневая модель: **неподдерживаемое не переносится, а остаётся доступным внутри SiYuan surface** и открывается в полной форме через compatibility mode (§6).

Почему код плагинов — в SiYuan runtime: изоляционный контур Craft уже размечен в [S-05](./05-extension-center.md) §3.5 (Extension Host для craft-sandbox, sandboxed webContents для UI). Плагин, исполняемый в Extension Host, получил бы Craft API, которого у SiYuan-плагина нет, и потребовал бы эмуляции всего SiYuan Plugin API — это переписывание, а не мост. Поэтому `runtime: "siyuan-plugin"` в ExtensionManifest ([S-05](./05-extension-center.md) §3.3–3.4) честно означает: «исполняется ядром SiYuan, Craft видит только проектированные вклады».

Существующий прецедент «чужого web-приложения внутри Craft surface» — browser panes: `BrowserPaneManager.createEmbeddedInstance` (apps/electron/src/main/browser-pane-manager.ts) композитит toolbar+page+overlay webContents, а BrowserPanelPage.tsx держит rect-reporter с ResizeObserver + syncBounds. Тот же паттерн используется для SiYuan editor surface и compatibility mode.

## 3. Решение

### 3.1. Где и как исполняются SiYuan-плагины

```
┌─ Electron main (trusted) ─────────────────────────────────────────────┐
│ knowledge-surface-manager   (новый компонент)                         │
│  • жизненный цикл SiYuan surface webContents (create/destroy/focus)   │
│  • НЕ исполняет код плагинов                                          │
│ SiYuanBridgeAdapter (craft-сторона)   (новый компонент)               │
│  • registry entries в Contribution Registry (source "siyuan-plugin")  │
│  • маршрутизация вызовов palette/menu → shim → plugin                 │
└───────┬───────────────────────────────────────────────────────────────┘
        │ typed bridge (selected methods only; kernel API HTTP/WS :6806
        │          + injected shim в editor bundle)
        ▼
┌─ SiYuan runtime ──────────────────────────────────────────────────────┐
│ Kernel (процесс SiYuan)                                               │
│  • загрузка/выгрузка плагинов: kernel API (plugin lifecycle)          │
│  • файлы плагинов: {siyuanDataDir}/plugins/ — Craft НЕ владеет        │
│ Editor bundle (web bundle в embedded webContents)                     │
│  • SiYuan Plugin API surface (window.siyuan …)                        │
│  • siyuan-bridge shim (inject):                                       │
│    - integrated mode: прячет дублирующий chrome,                      │
│      проксирует contributes в Craft                                   │
│    - compat mode: полный chrome, shim пассивен                        │
│  • КОД ПЛАГИНОВ исполняется ЗДЕСЬ, как и в ванильном SiYuan           │
└───────────────────────────────────────────────────────────────────────┘
```

Следствия:
- **Файловая собственность**: установка/обновление/удаление плагинов идёт через Bazaar/kernel API; enable/disable — через kernel. Craft Extension Center лишь отображает состояние (адаптер `siyuan-plugin`, см. [S-05](./05-extension-center.md) §3.8) и инициирует kernel-операции.
- **Permissions**: к коду ВНУТРИ SiYuan runtime permission engine Craft не применяется (это чужой процесс со своей моделью). Permission checks применяются к **Craft-стороне вкладов**: команда в палитре, tab, panel, status item, agent action регистрируются в Contribution Registry только с разрешениями, объявленными bridge-aware manifest (§4) и согласованными через vocabulary [S-05](./05-extension-center.md) §3.6 (`ui.command`, `ui.panel`, `knowledge.read` и т.д.).
- **Crash containment**: падение editor bundle (или kernel) — это падение ОДНОГО webContents/процесса: surface показывает degraded-состояние с «Reload», Craft main/сессии/другие workspaces не затронуты (та же модель, что kill browser pane: destroy → recreate через knowledge-surface-manager).

### 3.2. Проекция примитивов SiYuan Plugin API → Craft

| SiYuan примитив | Craft контрибуция | Куда попадает в оболочке |
|---|---|---|
| `addCommand({langKey, hotkey, …})` | `commands` (source `"siyuan-plugin"`) | палитра ⌘K ([S-04](./04-omnibox.md)), приоритет hotkey — 5-й уровень «установленное расширение/SiYuan plugin» |
| custom tab (`addTab({type, init, …})`) | `surfaces` → `SurfaceTab {kind:"extension", extensionId, viewId}` | единые вкладки ([S-02](./02-surface-registry-tabs.md)) |
| dock `LeftTop` | `panels` slot `navigator-primary` | Navigator ([S-01](./01-shell-slots.md)) |
| dock `LeftBottom` | `panels` slot `navigator-secondary` | Navigator, нижняя секция |
| dock `RightTop` | `panels` slot `inspector` | Inspector Rail ([S-03](./03-panels-rails.md)) |
| dock `RightBottom` | `panels` slot `inspector`, secondary tab | Inspector, вторая вкладка |
| dock `BottomLeft` / `BottomRight` | `panels` slot `bottom` | Bottom Panel |
| верхняя панель (topBar) | `menus`/toolbar-элемент поверхности | toolbar активной knowledge surface |
| нижняя панель (statusBar) | статус-элемент slot `status` | общий Craft Status Bar |
| контекстные меню editor/tree/dock/block | `menus` с `when` (editor/tree/dock/block) | контекстные меню knowledge surface; `when`-семантика — как в keybinding-context.ts |
| event bus (`eventBus.on/off`) | выборочный мост: транзакции ядра → Craft events | см. §3.4 |
| `Setting` / `loadData / saveData` | `settings` | страница плагина: Craft settings contribution или SiYuan custom tab (§6.3) |
| agent actions (плагин экспортирует действия для AI) | `agentActions` | Craft Agent Inspector / Agent Tools (permissions через vocabulary S-05) |
| keyboard shortcuts плагина | через Focus Context Bridge | глобальный роутинг hotkey ([S-04](./04-omnibox.md), global-input-router — новый компонент) |

Dock-позиции `LeftTop..BottomRight` проецируются ДЕКЛАРАТИВНО (по manifest) и только для L2+; у L0/L1-плагина docks живут внутри SiYuan surface и в оболочку не поднимаются — иначе это и есть запрещённый «авто-перенос DOM».

### 3.3. Bridge-aware manifest

Расширение стандартного SiYuan `plugin.json` опциональным блоком `craft` (все поля необязательны — отсутствие блока = авто-детект L0/L1, «новый компонент» `packages/shared/src/extensions/siyuan-bridge/manifest.ts`):

```typescript
interface SiYuanBridgeManifest {
  // — существующие поля SiYuan plugin.json (не меняются):
  name: string; version: string; author?: string; displayName?: Record<string,string>;
  description?: Record<string,string>; minAppVersion?: string; backends?: string[];
  frontends?: string[]; disabledInPublish?: boolean;

  // — НОВЫЙ опциональный блок:
  craft?: {
    level: 2 | 3;                      // заявленный уровень (0/1 выводятся автоматически)
    contributes?: {
      commands?: { id: string; title: string; titleRu?: string;
                   when?: string; defaultHotkey?: string;
                   permissions?: string[] }[];            // vocabulary из S-05 §3.6
      menus?:    { location: "editor"|"tree"|"dock"|"block"|"tab";
                   command: string; when?: string }[];
      tabs?:     { type: string; title: string; icon?: string }[];
      statusItems?: { id: string; text: string; tooltip?: string;
                      command?: string }[];
      settings?: { key: string; title: string;
                   type: "checkbox"|"text"|"number"|"select";
                   default: unknown; options?: string[] }[];
      agentActions?: { id: string; title: string; description: string;
                       inputSchema: Record<string, unknown>;
                       permissions: string[] }[];
    };
    gracefulDegrade?: string[];        // API/fичи, без которых плагин УМЕЕТ жить
                                       // (проверяются shim'овским capability probe)
    requiresFullChrome?: boolean;      // true → принудительно L1 максимум,
                                       // вкладки/команды открывают compat mode
  };
}
```

Для L3 плагин дополнительно поставляет полноценный `ExtensionManifest` (`craft-extension.json`, runtime `craft-sandbox` или `siyuan-plugin` с L2-вкладами) — формат из [S-05](./05-extension-center.md) §3.4.

Экспорт из кода (опционально, детектируется shim при загрузке плагина):

```typescript
// index.js плагина: hooks для bridge, ВСЕ опциональны
export interface CraftBridgeHooks {
  // L2: динамические команды/меню (в дополнение к декларативным из manifest)
  craftContributes?(bridge: CraftBridgeApi): void | Promise<void>;
  // L2/L3: реакция на Craft-события (активный документ, выделенные блоки)
  craftContextChanged?(ctx: CraftBridgeContext): void;
  // L3: монтирование Craft-панелей/поверхностей через Craft Extension API
  craftActivate?(api: CraftExtensionApi): Promise<CraftDisposable>;
}
```

`craftContributes` НЕ обязателен: полностью декларативный manifest достаточен для L2 («что нужно от плагина» — см. таблицу §5).

### 3.4. Мост событий

SiYuan event bus (`eventBus`) и kernel WS `/ws` (транзакции) выборочно проецируются в Craft event stream: `knowledge:changed`-подобные push-события добавляются в `BroadcastEventMap` (packages/shared/src/protocol/events.ts) по существующему механическому циклу channels.ts → routing.ts (обязательная классификация LOCAL_ONLY/REMOTE_ELIGIBLE, exhaustiveness-тест) → handler → registerCoreRpcHandlers. Craft → плагин: события контекста (активный документ, выбранные блоки, смена темы) через `craftContextChanged`. Широковещательный пасsthrough всего event bus НЕ делается — только типизированные, чтобы сохранить границу доверия и производительность.

### 3.5. Уровни совместимости: проверяемые критерии

| | L0 «работает» | L1 «виден» | L2 «интегрирован» | L3 «нативен» |
|---|---|---|---|---|
| Формула | плагин функционирует внутри SiYuan surface | плагин виден в Craft-списках и палитре | вклады проецируются в оболочку | использует Craft Extension API |
| UI плагина | внутри SiYuan surface (обычный режим) | внутри SiYuan surface; compat mode открывает нативно | Craft-vкладки/панели = проекции; редактирование — SiYuan surface | Craft-панели/поверхности напрямую |
| Запуск | из Editor bundle, как в ванили | кнопка «Открыть» из Craft фокусирует его tab в knowledge surface | команды/меню/вкладки из оболочки | даже без открытой SiYuan surface |

Проверяемые критерии по уровням (каждый — наблюдаемый факт):

- **L0** — kernel поднимает плагин без ошибок в логе; его UI доступен внутри SiYuan surface; ввод клавиатура/мышь внутри surface доходит; «Open full SiYuan interface» показывает его полностью функциональным.
- **L1** — плагин присутствует в Extension Center (карточка runtime `siyuan-plugin`, провайдер SiYuan Bazaar) и в Settings → Knowledge → Plugins; toggle enable/disable изменяет состояние через kernel и переживает перезапуск; команда/кнопка «Открыть» из карточки/палитры приводит к knowledge surface с его tab.
- **L2** — его команды находятся палитрой (префикс `>`) с бейджем источника `siyuan-plugin` и исполняются; его контекстные действия видны в меню editor/tree/dock/block по `when`; его tab открывается как SurfaceTab `{kind:"extension"}`; его status item показывается в Status Bar; его выбранные настройки редактируются на странице плагина в Craft settings.
- **L3** — манифест содержит Craft `contributes.panels|surfaces|agentActions|automationActions`; панели/поверхности рендерятся в слотах оболочки ([S-01](./01-shell-slots.md)); agent actions доступны Craft-агенту как инструменты; функция плагина работает при закрытой SiYuan surface (проверка: закрыть knowledge surface → вызвать agent action → успех).

**Таблица «что нужно от плагина для уровня»:**

| | manifest | код (exports) | UX-эффект |
|---|---|---|---|
| L0 | существующий plugin.json как есть | — | «ничего не сломалось» |
| L1 | plugin.json парсится (name/version/displayName) | — | карточка, тоггл, «Открыть» |
| L2 | `plugin.json` + блок `craft {level:2, contributes{commands/menus/tabs/statusItems/settings}, gracefulDegrade?}` | опц. `craftContributes`, `craftContextChanged` | палитра, меню, вкладки, статус, настройки |
| L3 | `craft-extension.json` (полный ExtensionManifest, S-05) + `craft {level:3}` | `craftActivate` против Craft Extension API | панели/поверхности/agent/automation нативно |

Авто-детект: нет блока `craft` → L1 (если парсится) / L0 (минимум); `requiresFullChrome:true` или проваленный capability probe (`gracefulDegrade` не покрывает используемые API) → принудительно L1, с пометкой на карточке.

### 3.6. Режимы knowledge surface: Integrated и Compatibility

Два режима одной поверхности (НЕ два продукта):

**Integrated (стандартный).** Craft shell + SiYuan editor surface (embedded bundle внутри Craft surface): дублирующий chrome SiYuan скрыт shim'ом (второй rail, вторая палитра, второй status bar — приглушены); вклады поддерживаемых плагинов (L2/L3) проецируются наружу по §3.2; Agent Inspector справа — Craft-эвент ([S-04](./04-omnibox.md), knowledge mode).

**Compatibility (аварийный/расширенный).** Полный SiYuan UI внутри отдельной Craft-вкладки: shim пассивен, chrome SiYuan виден целиком, ВСЕ плагины (включая L0/L1 и `requiresFullChrome`) работают как в ванили.

Вход и выход (все — наблюдаемые действия):

- Вход 1: кнопка **«Open full SiYuan interface»** в Knowledge mode (header navigator) → новая вкладка `SurfaceTab {kind:"knowledge", ref:{mode:"compat"}}`.
- Вход 2: автоматический fallback — если integrated render падает/часть плагинов помечена `requiresFullChrome`, карточка плагина предлагает «Открыть в полном интерфейсе SiYuan».
- Вход 3: команда палитры `> Open SiYuan compatibility view`.
- Выход: закрытие compat-вкладки или кнопка «Back to integrated»; runtime НЕ пересоздаётся — webContents держится смонтированным скрытым (прецедент: панели Craft остаются mounted при переключении, panel-stack), состояние документа общее (одно ядро, одна data dir) — переключение режима не теряет редактирование.
- Страница настроек плагина (для L0/L1 без `settings`-вклада): custom tab SiYuan внутри compat mode.

**Гарантия «неподдерживаемые не ломаются»:**

1. Ноль обязательных изменений у плагина: L0/L1 работают без единой правки.
2. Shim делает capability probe при загрузке; неизвестный плагину API Craft-side — warn-once + no-op, исключение не улетает в main.
3. Ошибка в shim/adapter НЕ поднимается выше knowledge surface: try/catch + timeout на каждый вызов plugin→Craft; degraded маркируется на Status Bar.
4. Падение editor bundle/kernel: degraded-состояние вкладки + Reload; Craft main, сессии, другие workspaces живы (§3.1).
5. Compatibility mode НЕЛЬЗЯ убрать (att2 §18): он — страховка и диагностический инструмент, а не легаси-режим на удаление.

### 3.7. Палитра, команды, горячие клавиши

Команды SiYuan-плагинов регистрируются в Command Registry с `source:"siyuan-plugin"` ([S-04](./04-omnibox.md), `CommandContribution.source` уже включает это значение). Приоритет hotkey: пользовательское назначение > команда текущей поверхности > Craft native > установленное расширение > **SiYuan plugin** > системный fallback; конфликты показываются в Settings → Keyboard Shortcuts, победитель молча не выбирается. Фокусная маршрутизация (⌘K внутри editor bundle → Craft-палитра) — Focus Context Bridge / global-input-router (новый компонент, специфицируется в [S-04](./04-omnibox.md)).

## 4. Границы / что НЕ делаем

- ✗ Авто-перенос DOM любого SiYuan-плагина в Craft-слоты (att2 §18) — только декларативные проекции по manifest.
- ✗ Исполнение кода SiYuan-плагинов в Electron main или в Extension Host (§3.1) — runtime плагина = SiYuan.
- ✗ Craft permissions внутри SiYuan runtime — применяются только к проектированным вкладам; внутренности плагина — зона kernel (честное ограничение, а не баг).
- ✗ Вырезание chrome-фич SiYuan UI без compat-эквивалента: функциональность не удаляется, а маршрутизируется (Settings → Knowledge → «Open advanced SiYuan settings»).
- ✗ Второй AI-контур: AI-функции SiYuan-плагинов не интегрируются в Craft Agent Inspector как второй агент; через `agentActions` они становятся инструментами Craft-агента, не конкурентом.
- ✗ Принудительный апгрейд плагинов до L2/L3: уровень — свойство плагина, не gate.
- ✗ Широковещательный пасsthrough event bus в Craft (только типизированные события, §3.4).

## 5. Критерии приёмки

- [ ] Каждый из 6 dock-позиций SiYuan (`LeftTop/LeftBottom/RightTop/RightBottom/BottomLeft/BottomRight`) проецируется в заявленный слот по таблице §3.2 (fixture-плагин с шестью docks).
- [ ] Критерии L0–L3 из §3.5 проверяемы: тестовый плагин без блока `craft` → L1; с `craft.level=2` + contributes → палитра, меню, tab, status, settings наблюдаемы; L3-плагин работает при закрытой SiYuan surface.
- [ ] L0-плагин (любой Bazaar-архив без craft-полей) загружается kernel без ошибок и полностью работоспособен внутри SiYuan surface; кнопка «Open full SiYuan interface» открывает его нативно.
- [ ] Вход/выход compat mode: «Open full SiYuan interface» открывает вкладку; возврат в integrated сохраняет редактируемый документ (одно ядро/data dir); webContents не пересоздаётся.
- [ ] `requiresFullChrome:true` принудительно ограничивает плагин L1; карточка помечена; «Открыть» ведёт в compat mode.
- [ ] Швовый сбой: исключение в плагине при вызове Craft-side API → warn-once + degraded на Status Bar; main/сессии/browser не затронуты (kill editor webContents → вкладка degraded + Reload).
- [ ] Команды плагина в палитре имеют `source:"siyuan-plugin"`; hotkey-приоритет 5-й уровень; конфликт виден в Settings → Keyboard Shortcuts.
- [ ] Enable/disable через Extension Center идёт в kernel; состояние переживает перезапуск приложения.
- [ ] Permission-гейт вкладов: contributes с `permissions:["ui.panel"]` без grant не регистрируется (fail-closed, [S-05](./05-extension-center.md) §3.6).
- [ ] События: транзакция в документе (kernel WS) → типизированный push в Craft (новый канал классифицирован в routing.ts); обратные `craftContextChanged` доставляются L2/L3-плагину.

## 6. Открытые вопросы

1. Плагины, требующие прямой DOM-доступ к chrome SiYuan (CSS-хаки rail/status): в integrated mode chrome скрыт — достаточно ли маркировки `requiresFullChrome` или нужен ползунок «показывать chrome»? (Дефолт: только маркировка + compat; ползунок — по жалобам.)
2. Горячие клавиши плагинов внутри compat mode перехватываются ли Focus Context Bridge или работают нативно в webContents? (Дефолт: в compat — нативно, bridge активен только в integrated.)
3. Плагины с wasm/нативными модулями в editor bundle: достаточно ли пасsthrough (ячейка webContents та же)? (Дефолт: да; список известных несовместимостей вести в Registries.)
4. L3 и iOS/mobile: переносимо ли Craft-вклады L3 в мобильную оболочку, или L3 заявляется per-platform? (Дефолт: `engines`/`platforms` поле в manifest, v2.)
5. Settings-bridge: дублирование `Setting` (SiYuan) ↔ `settings` (Craft) — синхронизировать значения двусторонне или Craft-страница только для чтения? (Дефолт: двусторонняя для L2-заявленных ключей; остальные — в SiYuan custom tab.)
