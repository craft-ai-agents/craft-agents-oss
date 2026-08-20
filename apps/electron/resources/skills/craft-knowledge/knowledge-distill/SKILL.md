---
name: Дистилляция сессии в знание
description: Превратить завершённую рабочую сессию Craft (или результат cloud run) в структурированный черновик знания для ревью и публикации в SiYuan. Use when a session or cloud run result is being prepared for publication into the knowledge base.
alwaysAllow:
  - knowledge.search
  - knowledge.read
  - knowledge.get_backlinks
requiredSources:
  - siyuan
---

# Knowledge distill

Turn a finished Craft session (and optional cloud-run artifacts) into a structured knowledge draft for human review and publication into SiYuan.

This skill is **read-only**. Never call write/publish capabilities. The PublishSessionDialog + mutation-proposal flow owns every write.

## Input

You receive some of:

- Session transcript messages (`role`, `content`, message ids)
- Optional cloud-run artifact text (e.g. `notes.md`)
- Optional related SiYuan blocks already in context (via `knowledge.read` / `knowledge.search` / `knowledge.get_backlinks`)

## Distillation rules

1. Prefer **assistant** messages with substantial content. Treat **user** messages as goals/context, not bulk body text.
2. Produce durable knowledge: conclusions, decisions, architecture notes, how-tos, open questions with owners — not a chat dump.
3. **EXCLUDE** (never put the raw text into `markdown`; record each exclusion):
   - `credential-like` — bearer tokens, `sk-…`, API keys, PEM / `-----BEGIN` blocks, env secret values
   - `pii` — standalone emails/phones and other personal data outside trusted sources
   - `raw-transcript` — tool-call dumps, stack traces, pure JSON blobs, stream noise
   - `unverified-claim` — claims with no supporting source message/block
   - `internal-id` — bare internal ids (`msg_…`, `sess_…`) and system/skill scaffolding
   - `size-cap` — content dropped to stay under the size limit
4. For every exclusion, emit `excerptHash` = sha256 hex of the excluded text. **Never store the raw excluded text.**
5. Require at least one `sourceMessages` entry **or** one `sourceBlocks` entry. If neither is possible, refuse (do not invent empty knowledge).
6. `title` — first markdown heading, else first user goal, truncated.
7. `summary` — at most 3 short sentences for the review step.
8. `outline` — one entry per `##` heading with a rough `blockCount`.
9. `sourceBlocks` — `siyuan://blocks/...` refs you actually used.
10. `sourceMessages` — `{ sessionId, messageId }` pairs that grounded the draft.
11. `contentHash` — sha256 hex of the final `markdown` string.
12. Cap `markdown` at **256_000** characters; overflow goes to `excluded` with `size-cap`.
13. Language: follow the dominant language of the session unless the caller set an explicit language.

## Output contract (mandatory)

Respond with **exactly one JSON object** and nothing else — no markdown fences, no prose before/after.

Shape (PublishDraft body fields the service validates):

```json
{
  "title": "string",
  "markdown": "string",
  "summary": "string",
  "outline": [{ "heading": "string", "blockCount": 0 }],
  "sourceBlocks": ["siyuan://blocks/..."],
  "sourceMessages": [{ "sessionId": "string", "messageId": "string" }],
  "excluded": [
    {
      "reason": "credential-like|pii|raw-transcript|unverified-claim|internal-id|size-cap",
      "excerptHash": "sha256-hex",
      "origin": "session|run-artifact|source-block"
    }
  ],
  "contentHash": "sha256-hex-of-markdown",
  "runIds": []
}
```

The host fills `id`, `status`, `connectionId`, `model`, timestamps, and target fields. Your job is only the distill body above.
