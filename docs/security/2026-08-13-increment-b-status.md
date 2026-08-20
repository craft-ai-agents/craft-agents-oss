# Increment B status — public messaging authority

- **Date:** 2026-08-13
- **Verdict:** Task 4 + Task 5 + Task 6 landed. Increment B complete on this tree.

## Task 4 — explicit access modes

Legacy `open` / `inherit` / missing fields normalize to `public-inbox`. Fresh binds persist `owner-control`. Unknown senders cannot become tool-capable through migration.

| Surface | Path |
|---|---|
| Mode codec | `packages/messaging-gateway/src/types.ts` |
| Evaluator | `packages/messaging-gateway/src/access-control.ts` |
| Persist rewrite | `packages/messaging-gateway/src/binding-store.ts` |
| RPC types | `packages/server-core/src/handlers/messaging-registry-interface.ts` |

## Task 5 — public-inbox before sessions/tools

`Router.route()` and `Commands` send a static pairing reply and a pending-sender row. They do not call `sessionManager.sendMessage` or execute `/new`/`/bind`.

## Verification (this session)

```text
bun test packages/messaging-gateway/src/__tests__/
# 224 pass / 0 fail  (full package)
bun test packages/messaging-gateway/src/__tests__/access-control.test.ts
         packages/messaging-gateway/src/__tests__/binding-store.test.ts
         packages/messaging-gateway/src/__tests__/router-access.test.ts
         packages/messaging-gateway/src/__tests__/commands-access.test.ts
         packages/messaging-gateway/src/__tests__/pairing.test.ts
```

## Task 6 — settings UI

Controls are labelled Public inbox / Owner control / Disabled. Unlock-all is gone. Owner-control cannot save with an empty allow-list. Pending Allow is one exact sender.

```text
bun test apps/electron/src/renderer/pages/settings/__tests__/MessagingSettingsPage.test.ts
         packages/messaging-gateway/src/__tests__/router-access.test.ts
         packages/shared/src/i18n/__tests__/locale-parity.test.ts
# 57 pass / 0 fail
```

## Still blocked

- Increment C–F: Gate 0 facts missing
- Hermes A1–A3: no `АПPLY HMA-20260809-A1`
