// ── Retired channel whitelist (checked-in machinery) ────────────────────
// Channels listed here MUST NOT appear in RPC_CHANNELS.  The test in
// ipc-channels.test.ts imports this list and fails if any of these names
// are accidentally re-introduced after retirement.
//
// To retire a channel:
//   1. Remove it from RPC_CHANNELS in packages/shared/src/protocol/channels.ts
//      (and update all consumers to stop referencing it).
//   2. Add its wire-format string here so the test guards against re-addition.
//
// To un-retire (if you need the channel back):
//   Remove the entry from this list and add the channel back to RPC_CHANNELS.
// ────────────────────────────────────────────────────────────────────────
export const REJECTED_OBSOLETE_CHANNELS: readonly string[] = [
  // ── Add retired channels here as they are removed from RPC_CHANNELS ──
  //
  // Example (when tasks:getOutput is actually retired from channels.ts):
  //   'tasks:getOutput',
  //
  // Once a channel is listed here, re-adding it to RPC_CHANNELS will fail
  // the test — exactly the guardrail we want.
  // ───────────────────────────────────────────────────────────────────────
]
