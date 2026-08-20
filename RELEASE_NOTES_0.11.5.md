# Craft Agents v0.11.5

## Highlights
- **Session share on agents.rox.one** — Cloudflare Pages viewer + R2-backed `/s/api` (Share Online)
- **Rox cloud Connect** — device-flow gate to rox.one (#52)
- **Sessions collection** — shared filters across list/board/table; multi-select parity (#54–#58)
- **Audit hardening** — terminal statusById, task path-segment guards, live SiYuan caps
- **CI** — flaky thinking-level subprocess timeout fixed

## Ops
- `VIEWER_URL=https://agents.rox.one` (DNS + TLS active)
- Cloud runs token still via `cloud-runs.env` (gateway may bot-challenge non-browser clients)

## Build
macOS arm64 dev package via `bun run electron:dist:dev:mac`
