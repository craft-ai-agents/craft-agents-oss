# WhatsApp Home Gateway Handoff

Status: uncommitted implementation exists in this working tree and looks like real feature work, not junk.

Files to review next:

- `packages/messaging-gateway/src/registry.ts`
- `packages/messaging-gateway/src/gateway.ts`
- `packages/messaging-gateway/src/commands.ts`
- `packages/messaging-gateway/src/__tests__/commands.test.ts`
- `packages/messaging-gateway/src/__tests__/gateway-incoming.test.ts`
- `packages/messaging-gateway/src/__tests__/registry-home-gateway.test.ts`
- `packages/shared/src/automations/automation-system.ts`
- `packages/shared/src/automations/event-bus.ts`
- `packages/shared/src/automations/handlers/prompt-handler.ts`
- `packages/server-core/src/handlers/session-manager-interface.ts`
- `packages/server-core/src/workflows/runner.ts`

What it appears to add:

- WhatsApp self-chat "home gateway" commands: `/workspaces`, `/where`, `/use <workspace>`.
- Ability for an unbound WhatsApp message to create/bind an HNIC session in the selected workspace.
- Cross-workspace binding lookup/unbind support.
- A gateway-level handled flag so automation prompt handlers do not double-process consumed messages.

Recommended next step:

Run the focused messaging gateway tests, inspect the private-method-heavy test style, then either harden and commit as one feature slice or stash it intact under a clear name.
