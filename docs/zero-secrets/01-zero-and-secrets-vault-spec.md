# Zero + Secrets Vault Spec

## Product Goal

Make Zero usable by normal RunnerOS users without manual terminal setup, and give users one obvious place to store reusable API keys/private env values.

## Current Decision

Do not bundle Zero into the packaged app yet. The npm package metadata is small, but the real global install footprint is about 146 MB on macOS because of dependency trees. The shippable path is a managed install/check flow:

- If `zero` exists, show version and wallet status.
- If missing, offer one-click install via `npm i -g @zeroxyz/cli`.
- If wallet is missing, offer setup guidance and secure `ZERO_PRIVATE_KEY` storage.
- Never fund wallets or spend money without explicit user action.

## User Experience

Settings gets a new `Secrets` page:

- Add/edit/delete named env secrets.
- Values are masked after save.
- Secrets are stored through RunnerOS encrypted credential storage.
- Saved secrets are injected into the server process environment so agent shell/tool calls can use them.
- Built-in Zero card shows CLI status, wallet status, and install/check controls.

## Backend Contract

Credential storage adds a generic `user_secret` credential type keyed by env var name.

RPC methods:

- `secrets:list`
- `secrets:save`
- `secrets:delete`
- `secrets:zeroStatus`
- `secrets:installZero`

`secrets:list` never returns raw values, only names, masked previews, source, and timestamps when available.

## Zero Rules

- Agents use the bundled Zero skill and `zero` source.
- Agents must search/get/fetch/review, and use `--max-pay`.
- The app may install/check/init, but paid calls remain agent/user-approved.
- `ZERO_PRIVATE_KEY` from the vault is injected into runtime env, taking precedence over `~/.zero/config.json`.

## Verification

- Unit tests for generic secret credential keying, env-name validation, and masking.
- Typecheck shared/server/electron.
- UI smoke: Secrets page opens, add/delete secret works, Zero status renders.
