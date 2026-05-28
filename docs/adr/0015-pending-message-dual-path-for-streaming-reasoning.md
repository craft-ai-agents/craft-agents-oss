# ADR-0015: Pending message dual-path for streaming reasoning and response

**Status:** Accepted  
**Date:** 2026-05-27

## Context

While a Pi model streams its response, the event adapter emits reasoning content as `<think>…</think>`-wrapped `text_delta` events in the same message stream as the final response text. The session state machine marks these as `isPending: true` until `text_complete` arrives with the authoritative `isIntermediate` flag.

`groupMessagesByTurn` originally routed all `isPending` messages exclusively to the intermediate-activity path (showing a "Thinking…" spinner) and never set `currentTurn.response`. This meant:

- The **ThinkingBlock** was invisible during the entire streaming phase — `response.reasoningText` was always `null` until `text_complete`.
- The **ResponseCard** showed the full response text all at once after `text_complete`, because `isStreaming` was already `false` by the time the message became the final response.
- Intermediate activities (pre-tool-call) rendered raw `<think>` tags because `stripMarkdown` does not handle HTML-like tags.

## Decision

The `isPending` branch in `groupMessagesByTurn` now follows a **dual path**:

1. **Intermediate activity** — the pending message is pushed as before, with `status: 'running'`, keeping the "Thinking…" spinner visible in the activities section.
2. **Response extraction** — `extractReasoningContent` is called on the accumulating content. The result sets `currentTurn.response` with `{ reasoningText, text: cleanContent, isStreaming: true }`.

This makes the turn phase `'streaming'` (instead of `'awaiting'`) while the model is actively producing content, which drives:
- The ThinkingBlock: visible and auto-expanded while `reasoningText` is non-null and `isBuffering` is true; auto-collapses when `cleanContent` first exceeds the buffer threshold.
- The ResponseCard: receives `cleanContent` progressively and streams it at 50 ms intervals (reduced from 300 ms).

`<think>` tags are stripped from intermediate activity display content by running `extractReasoningContent` before `stripMarkdown`. Intermediate activities with non-null `reasoningText` embed a collapsed ThinkingBlock inline.

## Alternatives considered

**Dedicated reasoning-activity type** — emit a separate activity row for reasoning content and keep the response path unchanged. Rejected: it would require a new activity type, a new event from the adapter, and would not fix the "response shows all at once" symptom.

**Post-hoc animation** — show the full response text and animate it in after `text_complete`. Rejected: fake streaming is misleading and does not reduce perceived latency.

## Consequences

- The "Thinking…" spinner and the ThinkingBlock coexist visually during streaming; this is intentional — the spinner signals that processing is ongoing while the ThinkingBlock shows the actual reasoning content.
- When `text_complete` arrives with `isIntermediate: true` (tool call follows), the intermediate path clears `currentTurn.response`. The ThinkingBlock disappears and reasoning is retained in the inline ThinkingBlock on the intermediate activity row.
- `CONTENT_THROTTLE_MS` is reduced to 50 ms to make both ThinkingBlock and ResponseCard updates visually smooth.
- The ThinkingBlock stays mounted once `reasoningText` first becomes non-null (tracked via ref) to avoid mount/unmount flicker across streaming ticks.
