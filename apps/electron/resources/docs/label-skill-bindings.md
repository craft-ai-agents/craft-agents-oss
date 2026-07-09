# Label → Skill Bindings

Label → Skill bindings are workspace-scoped rules stored in `label-skill-bindings.json`. A binding connects a configured label ID to a skill slug and a short runtime anchor. When a session carries that label, Craft Agent treats the binding as an active label-bound role and injects hidden, low-priority context for it.

A label-bound role is distinct from an explicit `[skill:slug]` mention. It is still active while the label-bound context is present, but explicit user skill mentions and direct instructions remain higher priority.

## How matching works

- Bindings match the **base label ID**. A valued label like `project::checkout` matches a binding for `project`.
- Explicit user intent still wins. If a user includes `[skill:slug]` or otherwise explicitly asks for a skill, that explicit skill anchor has higher priority than label-driven compact guidance.
- Label-driven guidance is lower priority than system, developer, tool, permission, and direct user instructions.
- If a label is deleted from the workspace label config, old session label entries with that base ID are ignored for binding matches.

## Skill scope and drift

Bindings capture display-safe skill metadata when they are saved or generated:

- skill slug and name
- skill source: `global`, `workspace`, or `project`
- metadata hash and optional content hash
- scope fingerprint

Project skills are matched by fingerprint, not by an absolute path. If a project skill moves, is shadowed, or its frontmatter changes, validation reports stale/mismatch warnings so you can regenerate or re-save the binding.

## Runtime bootstrap and compact turns

On an empty chat's first model call, Craft Agent may bootstrap up to two active label-bound skills through the standard skill prerequisite flow. That means the model receives the same read directive used for explicit `[skill:slug]` mentions and must read the relevant `SKILL.md` with the Read tool or `cat` before proceeding. Craft Agent does **not** inline the full skill body into hidden context.

After that first bootstrap is completed, later turns use compact label-bound anchors only. Normal non-empty turns do not re-read full `SKILL.md` files unless the user explicitly mentions a skill.

When chat compaction completes, Craft Agent advances the label-skill context epoch. On the next relevant turn, active label-bound skills can be bootstrapped again through the same standard `SKILL.md` read flow, so full skill behavior is restored in the compacted context without injecting the full skill body into every message.

If the user explicitly mentions the same skill that a label would bootstrap, Craft Agent deduplicates the read directive and the explicit mention wins.

## Runtime anchor priority

The compact instruction field is now best treated as a short recurring runtime anchor, not a replacement for the full skill. Keep it concise:

- identify the active label-bound skill/role
- describe the core behavior in one or two lines
- mention that full behavior comes from the bound `SKILL.md` via the standard bootstrap/read flow
- tell the agent to re-read the bound `SKILL.md` if behavior seems incomplete, stale, or forgotten after context loss/compaction
- avoid long examples, copied skill content, secrets, or local absolute paths

The Settings page warns on empty enabled instructions and long instructions. Runtime also caps active bindings: only the first 8 matching bindings are injected and the serialized payload is capped at about 12 KB.

## Generate behavior and privacy

The **Generate** button is explicit. It reads the selected `SKILL.md` once, sends a clipped copy to the configured mini model, and returns a compact instruction for you to review before saving.

If no default/mini model is available, authentication fails, or generation times out, Craft Agent uses a deterministic local fallback based on the skill name and description only and surfaces a warning. The fallback does not copy `SKILL.md` body excerpts. Normal label-bound sends after bootstrap do not read full skill bodies until a new context epoch needs bootstrap or the user explicitly mentions a skill.

## Revocation

If no active label-bound bindings remain after a prior label-bound context was injected, Craft Agent emits a revocation block. Revocation tells the model to stop applying prior label-bound compact/bootstrap role instructions only. It does not ask the model to forget unrelated facts, tool outputs, or direct user instructions from later turns.

## Required sources

If a skill declares `requiredSources`, bindings snapshot those source slugs with display-safe metadata. Validation and import warn when a required source is missing or disabled in the target workspace.

## No default orchestrator binding

Craft Agent does not create a built-in `orchestrator` label binding. Add only the labels and skills that match your workspace workflow.
