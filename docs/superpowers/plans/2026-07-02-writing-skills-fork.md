# Project-Scoped writing-skills Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork `superpowers:writing-skills` into this repo as `.claude/skills/writing-skills/`, and add three judgment tests it's missing (output shape, deployment boundary, no-baked-in-cases) — written in fully generic language with no business/domain terms.

**Architecture:** Straight file copy from the plugin cache into a project-scoped skill directory (which shadows the global plugin skill by Claude Code's directory-precedence rule), followed by three targeted markdown insertions into the copied `SKILL.md`.

**Tech Stack:** Markdown only. No code, no build step.

**Spec:** `docs/superpowers/specs/2026-07-02-writing-skills-fork-design.md`

---

### Task 1: Fork the skill directory

**Files:**
- Create: `.claude/skills/writing-skills/SKILL.md`
- Create: `.claude/skills/writing-skills/anthropic-best-practices.md`
- Create: `.claude/skills/writing-skills/persuasion-principles.md`
- Create: `.claude/skills/writing-skills/testing-skills-with-subagents.md`
- Create: `.claude/skills/writing-skills/graphviz-conventions.dot`
- Create: `.claude/skills/writing-skills/render-graphs.js`
- Create: `.claude/skills/writing-skills/examples/CLAUDE_MD_TESTING.md`

- [ ] **Step 1: Copy the source skill verbatim**

```bash
mkdir -p /home/cunningham/Projects/craft-agents-oss/.claude/skills
cp -r /home/cunningham/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/writing-skills \
      /home/cunningham/Projects/craft-agents-oss/.claude/skills/writing-skills
```

- [ ] **Step 2: Verify the copy is complete**

Run: `diff -rq /home/cunningham/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/writing-skills /home/cunningham/Projects/craft-agents-oss/.claude/skills/writing-skills`

Expected: no output (directories identical).

- [ ] **Step 3: Commit the raw fork before editing it**

```bash
cd /home/cunningham/Projects/craft-agents-oss
git add .claude/skills/writing-skills
git commit -m "$(cat <<'EOF'
chore(skills): fork superpowers:writing-skills as project skill

Unmodified copy — project-scoped additions land in a follow-up
commit so the fork point stays diffable against upstream.
EOF
)"
```

Committing the untouched copy first keeps the next commit's diff limited to the actual additions, so anyone can see exactly what this repo changed relative to upstream.

---

### Task 2: Add the Output Shape Test

**Files:**
- Modify: `.claude/skills/writing-skills/SKILL.md`

- [ ] **Step 1: Insert the new section**

Anchor is the end of the existing `## Skill Types` section, right before `## Directory Structure`. Find this exact text:

```markdown
### Reference
API docs, syntax guides, tool documentation (office docs)

## Directory Structure
```

Replace it with:

```markdown
### Reference
API docs, syntax guides, tool documentation (office docs)

## Designing Output Shape

Some skills don't just guide the agent's own actions — they specify what the agent should produce when it finishes (a report, a comparison, a summary). When a skill includes an output specification, choose the shape by what the underlying data actually looks like, not by copying the shape of some other skill's output:

| Data shape | Output shape |
|---|---|
| Multiple independent items, each with its own status | Enumeration table — one row per item |
| One subject with many attributes | Attribute table — one row per field |
| Two things compared dimension by dimension | Comparison table — one row per dimension, one column per side |
| A single verdict with supporting evidence and gaps | Conclusion-first sections — verdict, then evidence, then gaps — not a table |

Don't force a table onto a single verdict just for cross-skill visual consistency, and don't leave a naturally tabular output as prose just because an earlier skill in the same family used prose. Pick the shape the data actually has; consistency comes from applying the same *test* everywhere, not from mandating the same *shape* everywhere.

## Directory Structure
```

- [ ] **Step 2: Verify the insertion**

Run: `grep -n "Designing Output Shape" /home/cunningham/Projects/craft-agents-oss/.claude/skills/writing-skills/SKILL.md`

Expected: one match, and the file still contains exactly one `## Directory Structure` heading (`grep -c "^## Directory Structure"` → `1`).

---

### Task 3: Add the Deployment Boundary Test

**Files:**
- Modify: `.claude/skills/writing-skills/SKILL.md`

- [ ] **Step 1: Insert the new section**

Anchor is the end of the existing `## When to Create a Skill` section, right before `## Skill Types`. Find this exact text:

```markdown
- Mechanical constraints (if it's enforceable with regex/validation, automate it—save documentation for judgment calls)

## Skill Types
```

Replace it with:

```markdown
- Mechanical constraints (if it's enforceable with regex/validation, automate it—save documentation for judgment calls)

## Deployment Boundary Test

The "When to Create a Skill" guidance above assumes skills are a personal, reusable technique library. That assumption doesn't hold when a whole directory of skills gets mirrored or deployed as-is into a product surface that end users interact with — in that case, apply this test instead:

**Split into separate skills when any one of these differs:**
- **Triggering semantics** — different situations, phrasings, or symptoms should load this skill.
- **Toolchain** — it calls different underlying tools, scripts, or data sources.
- **Output artifact** — it produces a materially different kind of result.

**Keep it as one skill** (using `references/` to split detail) when it's only a variant of the same task with the same trigger, toolchain, and output shape.

**Cross-references between deployed skills go in the body as boundary descriptions, not as execution orders.** State how this skill differs from a neighboring one so the boundary is clear ("unlike X, this skill covers Y"). Don't write "run skill X first, then use this one" inside a skill body — that couples the two skills' execution order together and makes each harder to use independently. Sequencing and routing decisions belong one layer up, in whatever entry point or top-level instructions dispatch to skills in the first place.

## Skill Types
```

- [ ] **Step 2: Verify the insertion**

Run: `grep -n "Deployment Boundary Test" /home/cunningham/Projects/craft-agents-oss/.claude/skills/writing-skills/SKILL.md`

Expected: one match, and `grep -c "^## Skill Types"` → `1`.

---

### Task 4: Add the No-Baked-In-Cases corollary

**Files:**
- Modify: `.claude/skills/writing-skills/SKILL.md`

- [ ] **Step 1: Insert the new subsection**

Anchor is the end of the existing `## The Iron Law (Same as TDD)` section, right before `## Testing All Skill Types`. Find this exact text:

```markdown
**REQUIRED BACKGROUND:** The superpowers:test-driven-development skill explains why this matters. Same principles apply to documentation.

## Testing All Skill Types
```

Replace it with:

```markdown
**REQUIRED BACKGROUND:** The superpowers:test-driven-development skill explains why this matters. Same principles apply to documentation.

### Corollary: Generalize Before It Enters the Skill

A rule earning its place in a skill (because a real failure motivated it) is not the same as that rule being ready to write down. Before it goes into SKILL.md, strip out everything specific to the one incident that produced it — exact inputs, exact expected outputs, names of the particular case that failed. What remains should be a method that stands on its own, understandable and applicable without knowing what originally went wrong.

**Why this matters more than it looks:** a rule that still contains the specific case that motivated it doesn't read as "apply this method" — it reads as "here is the answer," and a future agent (or a future you) will pattern-match on the leftover specifics instead of applying the underlying judgment. It also quietly turns the skill into a patch for one incident instead of a generalizable technique, which defeats the purpose of writing it as a skill at all.

Keep the specific incident in whatever record led you to write the rule (a debugging note, a test log, a postmortem) — not in the skill itself.

## Testing All Skill Types
```

- [ ] **Step 2: Verify the insertion**

Run: `grep -n "Generalize Before It Enters the Skill" /home/cunningham/Projects/craft-agents-oss/.claude/skills/writing-skills/SKILL.md`

Expected: one match, and `grep -c "^## Testing All Skill Types"` → `1`.

---

### Task 5: Self-review and commit

**Files:**
- Modify (review only, no further edits expected): `.claude/skills/writing-skills/SKILL.md`

- [ ] **Step 1: Scan for accidentally-introduced business/domain terms**

Run:

```bash
grep -niE "procurement|采购|型号|feishu|飞书|lark|scrape-engine" /home/cunningham/Projects/craft-agents-oss/.claude/skills/writing-skills/SKILL.md
```

Expected: no output. If anything matches, edit it out — the fork must stay fully generic (per spec's non-goals).

- [ ] **Step 2: Confirm the three new sections are all present**

Run:

```bash
grep -n "^## Designing Output Shape\|^## Deployment Boundary Test\|^### Corollary: Generalize Before It Enters the Skill" /home/cunningham/Projects/craft-agents-oss/.claude/skills/writing-skills/SKILL.md
```

Expected: three matches, one per heading.

- [ ] **Step 3: Confirm project-scoped resolution**

Run: `ls /home/cunningham/Projects/craft-agents-oss/.claude/skills/writing-skills/SKILL.md /home/cunningham/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/writing-skills/SKILL.md`

Expected: both paths exist (confirms the fork sits alongside, not instead of, the plugin original — Claude Code's directory-precedence rule picks the project one automatically when working in this repo; this is a structural property of where the file lives, not something to configure).

- [ ] **Step 4: Commit**

```bash
cd /home/cunningham/Projects/craft-agents-oss
git add .claude/skills/writing-skills/SKILL.md
git commit -m "$(cat <<'EOF'
feat(skills): add output-shape, deployment-boundary, and
no-baked-in-cases tests to forked writing-skills

Three judgment tests the upstream superpowers:writing-skills skill
doesn't cover: how to shape a skill's own output spec, how to decide
skill boundaries when a directory of skills gets deployed as product
surface (not just Claude's personal technique library), and why a
rule motivated by a real incident must be generalized before it's
written into the skill. Kept fully generic — no business/domain
terms, per docs/superpowers/specs/2026-07-02-writing-skills-fork-design.md.
EOF
)"
```

---

## Self-Review (plan author checklist)

- **Spec coverage:** Fork (Task 1) ✓, output shape test (Task 2) ✓, deployment boundary test (Task 3) ✓, no-baked-in-cases corollary (Task 4) ✓, generic-language verification (Task 5) ✓, non-goal "no business example file" respected — no task creates one.
- **Placeholder scan:** none — every step has literal commands/text to insert.
- **Consistency:** all three new headings referenced in Task 5's grep match exactly the headings introduced in Tasks 2–4.
