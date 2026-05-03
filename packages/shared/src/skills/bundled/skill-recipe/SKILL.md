---
name: Skill Recipe
description: "When the user (or another agent) is choosing which skills to bundle into a new agent, asking 'what skills should this agent have,' 'which of these go together,' 'what's the best combo for X,' or generally curating a focused, synergistic skill set. Also triggered during agent creation when the bundling step is reached. Reads the live skill catalog and applies curation rules: cap, specialization, layered composition, anti-pairing detection."
tags: [creator, meta, agents, curation]
metadata:
  version: 1.0.0
---

# Skill Recipe

Use this skill whenever you are deciding which skills to bundle into an agent, or
recommending skills for the user to activate. The goal is **focused, synergistic specialists**
— not generalists with a long bundle list.

## Process

1. **Call `list_skills` with `activeOnly=true`** to see the authoritative catalog. Note each
   entry's `slug`, `name`, `description`, `tags`, and `source` (`workspace` / `global` /
   `project` / `global-dormant`).
2. **Read the user's intent carefully.** What is the *one role* they're describing? If they
   describe two distinct jobs, that's two agents — propose splitting before curating.
3. **Triage on description first.** Most picks come down to matching the user's words against
   skill descriptions. Don't read full SKILL.md bodies unless you have to.
4. **Dig deeper only when ambiguous.** Open the skill body (`Read` the SKILL.md file) when:
   - Two skills have overlapping descriptions and you need to pick one
   - The user used a term that could match multiple skills
   - The user's job spans layers and you need to confirm a skill operates at the right one
5. **Apply the rules below** to converge on a final bundle.
6. **Present the bundle with reasoning.** For each chosen skill, one line on why. For each
   tempting-but-rejected skill, one line on why not. The "why not" matters — it's how the
   user trusts your judgment.

## Rules

### Cap: max 5 skills per agent

More dilutes specialization. The LLM stops reading bundle bullets carefully when the list is
long. If you find yourself adding a 5th, ask: "Is this really one role, or two?" The answer
is usually two.

### One specialty per agent

If the user describes execution and strategy in the same breath, propose two agents — one
that strategizes, one that executes — with the strategist's output feeding the executor.

### Prefer focused over broad

If two skills could plausibly fit and one is broader (e.g., a strategy skill) while the
other is narrower (e.g., a tactical playbook), pick the narrower one when the user's request
is tactical, and vice versa. A strategy agent shouldn't bundle four execution playbooks.

### Watch for redundant pairs

If two skills' descriptions overlap heavily, you probably want one, not both. Check the body
of each to find the actual difference, then pick the better fit.

### Layered composition is good — when the job actually spans layers

The pattern *physics → formulas → structure* (e.g., for X content: an algorithm-mechanics
skill + a formula-library skill + a multi-platform structure skill) is excellent when the
user is doing serious work in that domain. Skip a layer when the user only operates at one
of them.

### Cross-references in descriptions are clues

When a skill's description says "for X, see Y" or "this skill is for Z; for W, see another
skill," the author has signaled their intended composition. Trust those hints.

### `global-dormant` skills are suggestions, not bundles

If a relevant skill exists but is `global-dormant`, suggest the user activate it — but
don't add the slug to the agent yet. It won't resolve in the agent's prompt until activated.

### Workspace overrides global

If both a workspace and a global skill share the same slug, the workspace copy wins at load
time. Treat them as one entry with `source: workspace`.

### Don't bundle by inertia

If no skill is clearly a better fit than nothing, bundle nothing. A clean agent with three
focused skills outperforms a noisy one with five.

## Illustrative patterns (not exhaustive)

These are examples of the kind of reasoning the rules produce — not a maintained list.
Always reason from the live catalog.

- **A user wanting to grow on X** → narrow text-only agent. Algorithm mechanics + tweet
  formula library + competitor scraping. Don't add general "marketing strategy" skills —
  they broaden past the X focus.
- **A user wanting to make TikToks** → idea engine + competitor scraping + multi-platform
  content templates. Don't add X-specific skills — wrong channel.
- **A user wanting marketing strategy** → ideas + psychology + research + competitive
  profiling. Don't add channel-specific execution skills (ads, posts, lead magnets) —
  those belong on a separate execution agent.
- **A user wanting an animation producer** → just the production skill, possibly an
  ideation skill. Producers ship; planners plan. Don't broaden execution agents.
- **A user wanting a meta-builder (Concierge-style)** → the creator skills (agent, workflow,
  automation). Don't add domain skills — meta agents spawn the agents that do the work,
  they don't do the work themselves.

## Output format

When recommending a bundle, return:

```
**Proposed skills (N of max 5):**
- skill-slug-1 — <one line on why this fits the role>
- skill-slug-2 — <one line>
- skill-slug-3 — <one line>

**Considered but excluded:**
- skill-slug-4 — <one line on why it would broaden past the specialty>
- skill-slug-5 — <one line>

**Suggest activating (currently global-dormant):**
- skill-slug-6 — <if relevant; user can activate then re-bundle>
```

## When you don't know

If the catalog has skills you've never reasoned about and the descriptions don't make their
fit obvious, read their SKILL.md bodies before recommending. A wrong recommendation is
worse than slow.

If multiple bundles seem equally defensible, present two options and let the user pick.
That's fine.
