# Update System Agent Spec

## Purpose

Create a global, read-only maintenance agent that can audit the full local agent/tool surface before updates happen.

It should answer: "What agents, skills, sources, CLIs, MCP/plugin surfaces, and bundled binaries are installed, and what needs attention?"

## Phase 1 Scope

- Add a global standalone agent: `update-system-agent`.
- Add a reusable skill: `system-update-audit`.
- Add a deterministic read-only inventory script.
- Cover these surfaces:
  - `/Users/michaelb.williams/.codex/agents`
  - `/Users/michaelb.williams/.codex/skills`
  - `/Users/michaelb.williams/.codex/plugins/cache`
  - RunnerOS `sources/`
  - RunnerOS `tools/`
  - RunnerOS package manifests and lockfiles
- Report missing provenance, missing checksums, missing license/notice files, missing skill metadata, missing agent descriptions, dirty git state, and obvious bundled CLI gaps.

## Non-Goals

- No automatic update or install by default.
- No credential scraping.
- No destructive cleanup.
- No silent git writes.
- No production deploy.

## Operating Model

1. Inventory local surfaces.
2. Classify findings:
   - `blocker`: shippability/security issue.
   - `review`: likely needs human judgment.
   - `watch`: useful but not urgent.
3. Recommend exact next commands or files to inspect.
4. Ask before any update/mutation.

## Output Shape

- Short executive summary.
- Counts by surface.
- Findings grouped by severity.
- Candidate update work with risk labels.
- Verification gaps.

## Acceptance Criteria

- Agent appears in Codex standalone agent catalog.
- Skill appears in Codex skill catalog.
- Script runs locally without network and without reading secrets.
- Script produces both Markdown and JSON modes.
- Catalog rebuild succeeds.
