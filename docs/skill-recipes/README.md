# Skill Recipe

A starter skill (`skill-recipe`) that encodes the *rules* for picking a focused, synergistic
bundle of skills for an agent. Lives in the global skill library, ships with fresh installs,
and gets invoked by Concierge / Orchestrator / agent-creator (or any other agent) whenever
skill curation is happening.

## The problem this solves

As the global skill library grows, three problems compound:

1. **Specialization erosion.** It's tempting to bundle every related-looking skill into a new
   agent. Past ~5 skills the LLM stops reading bundle bullets carefully and the agent becomes
   a generalist with mediocre takes on everything.
2. **Pairing knowledge is ineffable.** "These compose well" or "this skill is for diagnosis,
   that one is for drafting" lives in someone's head. Skill frontmatter can't express
   composition relationships without becoming a graph nobody maintains.
3. **Boundary knowledge is invisible.** Knowing what *not* to add is as valuable as knowing
   what to add. There's no place for that today — frontmatter declares a skill, not its
   anti-pairings.

## What was rejected, and why

A v1 design used a static `~/.agents/skill-recipes.md` doc with curated archetypes ("X
Content Creator," "Marketing Strategist," etc.) listing skills + Don't-add guidance. Read by
agent-creator at bundle-time.

Killed because:
- **Maintenance burden.** Every skill install required an edit. Doesn't scale.
- **Fragile to drift.** Recipes referenced specific slugs; renames silently broke them.
- **Wrong abstraction layer.** A recipe is a *cached output* of curation reasoning. Better
  to encode the reasoning itself.

The current design encodes the *how-to-pick* rules — the catalog is read live, the rules are
applied dynamically. New skills flow through automatically; nothing to update.

## The shape of the solution

A single starter skill, `skill-recipe`, with two parts:

1. **Process** — the LLM is told to (a) call `list_skills` for the live catalog, (b) read
   the user's intent for *one* role, (c) triage on description, (d) dig into SKILL.md bodies
   only when ambiguous, (e) apply the rules, (f) present a bundle with reasoning including
   "why not" lines for excluded skills.
2. **Rules** — cap at 5, one specialty per agent, prefer focused over broad, watch for
   redundant pairs, respect cross-references in descriptions, treat `global-dormant` as
   suggestions not bundles, etc.

Plus a short "illustrative patterns" section showing the kind of reasoning the rules
produce. These are examples, not a maintained list — the LLM is told to always reason from
the live catalog, never to copy-paste a pattern.

## Integration

`skill-recipe` is a starter skill (in `STARTER_SKILLS`) — every fresh install gets it. Once
installed, it appears in the agent catalog visible to every agent's system prompt. Concierge,
Orchestrator, and `agent-creator` all see it as a callable specialist for skill curation.

`agent-creator`'s body now defers to it for the bundle step:

> Defer skill curation to the `skill-recipe` skill. Invoke it (or follow its rules inline if
> it's already in your context) to pick a focused, synergistic bundle. It will call
> `list_skills`, apply the cap and specialization rules, and return a proposed bundle with
> reasoning.

Wired in two places:
- **Live skill** — `~/.agents/skills/skill-recipe/SKILL.md`
- **In-source starter** — `packages/shared/src/skills/starter-templates.ts` → `SKILL_RECIPE_SKILL`

`agent-creator` updated in both the live copy and the starter template.

## Why this is a good fit for RunnerOS

- **Markdown is canonical.** Same format as every other skill.
- **No new code paths.** Re-uses the existing skill loader, the existing `list_skills` tool,
  the existing prompt-bundling pipeline.
- **Self-updating.** Any skill installed in the future flows through automatically — no
  human in the loop, no maintenance burden.
- **Composable.** Concierge can invoke it during routing ("which skills should this agent
  have?"), Orchestrator during planning ("decompose into specialists"), agent-creator during
  bundling. Same skill, three callers.
- **Override-friendly.** A workspace can ship a `skills/skill-recipe/` override with
  team-specific rules; same priority semantics as any other skill.

## Maintenance

Effectively none. The rules in `skill-recipe` are stable — they're meta-rules about how to
curate, not data about specific skills. Edit the rules only when a *systemic* change in the
curation philosophy is needed (e.g., raising the cap, adding a new boundary check).

The live catalog (which the rules operate on) is maintained automatically — every new skill
install adds an entry, every removal drops one.

## Future directions (not built)

- **A "show me skill candidates" UX.** Surface `skill-recipe`'s reasoning in the
  agent-create dialog as a sidebar. Currently it's chat-mediated.
- **Telemetry on bundle size distribution.** If most agents end up with 5 skills, the cap is
  too loose. If most have 2, it's too tight (or the catalog is too narrow).
- **Per-workspace skill-recipe override pattern.** Already supported by the loader (workspace
  > global priority); just needs a doc-blessed way for teams to ship their own rule
  variations.
