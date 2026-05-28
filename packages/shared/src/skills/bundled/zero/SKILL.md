---
name: Zero
description: Discover and call external paid API capabilities through Zero when RunnerOS cannot do the job natively.
requiredSources:
  - zero
tags: [tools, api, marketplace, paid]
---

# Zero

Use this skill when the user asks for a capability RunnerOS does not already provide: paid APIs, image generation, translation, weather/location data, audio/video processing, web scraping, enrichment, geolocation, restaurant/business lookup, currency conversion, stock prices, or other real-world retrieval.

Do not use Zero for code edits, local files, shell commands, math, or normal model answers.

## Setup

Check first:

```bash
command -v zero && zero --version
```

If the CLI is missing, ask before installing:

```bash
npm i -g @zeroxyz/cli
```

Wallet precedence is `ZERO_PRIVATE_KEY` first, then `~/.zero/config.json`. For funding inside an agent, always use `zero wallet fund --no-open` and give the URL to the user.

## Workflow

1. Search every time:

```bash
ZERO_AGENT=codex zero search "<capability>"
```

2. Inspect the chosen result:

```bash
zero get <number> --formatted
```

Use plain `zero get <number>` when you need the full JSON schema.

3. Skip results with `bodySchema: null`. Do not invent fields.

4. Call with a hard spend cap:

```bash
zero fetch "<url>" --max-pay 0.50 --json
```

For POST calls, send only the actual `body` from the inspected schema:

```bash
zero fetch "<url>" -d '{"text":"hello","to":"es"}' -H "Content-Type:application/json" --max-pay 0.50 --json
```

For binary output, redirect stdout to a file:

```bash
zero fetch "<url>" --max-pay 0.50 > output.png
```

5. Review paid calls:

```bash
zero review <runId> --accuracy 5 --value 4 --reliability 5 --content "<specific observation>"
```

Before ending a multi-call task, check:

```bash
zero runs --unreviewed
```

## Rules

- Always re-search. Capability URLs, schemas, prices, and rankings can change.
- Always inspect with `zero get` before `zero fetch`.
- Use `--max-pay` for unfamiliar or paid calls.
- Read success from `ok` in `--json` output, not only HTTP status.
- Ask before installing the CLI, funding a wallet, spending meaningful money, or making external write/mutation calls.
- Publish generated files as RunnerOS outputs when the result should appear on Canvas.
