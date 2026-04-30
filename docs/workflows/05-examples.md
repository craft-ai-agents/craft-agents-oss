# Example workflows

Concrete `WORKFLOW.md` files showing realistic uses. Two of these — the **Weekly Content Pipeline** and **Email Triage** — should be seeded as starter workflows on first run, the same way Concierge and Orchestrator are auto-seeded for agents.

These examples reference agent slugs from the existing starter pack: `researcher`, `writer`, `critic`, `triager`, `coder`, `orchestrator`. If a referenced agent doesn't exist in the user's library, the workflow validation flags it with a clear error in the UI.

---

## 1. Weekly Content Pipeline

The motivating example. End-to-end content production, manual trigger.

```yaml
---
name: Weekly Content Pipeline
description: Research a topic, draft a post, critique it, revise, hand off for human approval.
avatar: 📝
trigger:
  type: manual
  inputs:
    - name: topic
      type: string
      required: true
      description: What you want to write about (one sentence)
    - name: word_count
      type: number
      default: 600
    - name: audience
      type: string
      default: "experienced practitioners"
steps:
  - id: research
    agent: researcher
    input: |
      Research "{{trigger.topic}}". Prefer primary sources. Return:
      - 3-sentence TL;DR
      - 4-6 key findings, each with a citation
      - 2-3 open questions
      - Numbered source list
  - id: draft
    agent: writer
    input: |
      Write a {{trigger.word_count}}-word blog post for {{trigger.audience}}.
      Direct, specific voice. No throat-clearing.

      Source material:
      {{steps.research.output}}
  - id: critique
    agent: critic
    input: |
      Review this draft. Honest, not nice. Single highest-leverage change.

      {{steps.draft.output}}
  - id: revise
    agent: writer
    input: |
      Revise the draft based on this critique. Keep the word count close to {{trigger.word_count}}.

      Original draft:
      {{steps.draft.output}}

      Critique:
      {{steps.critique.output}}
---
# Weekly Content Pipeline

Run this when you have a half-formed topic and want a clean draft to start from.

**Tips:**
- Spend the most prompt budget on the topic — vague topics produce vague research.
- The critique step is intentionally harsh. If the revised draft still feels weak, fork this workflow and tweak the critic's prompt to be even more specific.
```

---

## 2. Email Triage

Inbound email becomes a triage decision plus an optional draft reply. Phase 4 trigger; in Phase 1 you can run it manually with the email pasted in.

```yaml
---
name: Email Triage
description: Classify an email, decide on next action, optionally draft a reply.
avatar: 📥
trigger:
  type: manual          # in Phase 4 → type: automation, fires on EmailReceive matcher
  inputs:
    - name: from
      type: string
      required: true
    - name: subject
      type: string
      required: true
    - name: body
      type: string
      required: true
steps:
  - id: classify
    agent: triager
    input: |
      Classify this email. Return:
      - urgency: now | today | this week | later | drop
      - category: question | sales | newsletter | bug-report | personal | other
      - one-line summary
      - action: reply | forward | delete | nothing

      From: {{trigger.from}}
      Subject: {{trigger.subject}}

      Body:
      {{trigger.body}}
  - id: draft_reply
    agent: writer
    input: |
      Draft a short, direct reply to this email. Match my voice (clear, no fluff).

      Triage notes: {{steps.classify.output}}

      Original:
      From: {{trigger.from}}
      Subject: {{trigger.subject}}
      Body: {{trigger.body}}
---
# Email Triage

Pair this with the eventual EmailReceive trigger (Phase 4 + future external trigger from `docs/future-external-triggers.md`).

Until then, paste an email manually to test the routing logic.
```

---

## 3. Bug investigation

Reproduce → diagnose → propose fix → review proposal. A practical use of `humanCheckpoint` (Phase 3) for the user to approve the fix before the coder agent applies it.

```yaml
---
name: Bug Investigation
description: Reproduce, diagnose root cause, propose a fix, pause for approval, then apply.
avatar: 🪲
trigger:
  type: manual
  inputs:
    - name: report
      type: string
      required: true
      description: Bug report text or paste of the failing logs
steps:
  - id: reproduce
    agent: coder
    input: |
      Read this bug report. Identify the smallest reproduction. Run it.
      Report exactly what happens. Do not propose a fix yet.

      {{trigger.report}}
  - id: diagnose
    agent: coder
    input: |
      Given this reproduction, identify the root cause. Cite file paths and line numbers.
      Distinguish symptom from cause.

      {{steps.reproduce.output}}
  - id: propose
    agent: coder
    input: |
      Propose a fix. Show the exact diff. Explain why this addresses the root cause and not just the symptom.

      Diagnosis:
      {{steps.diagnose.output}}
    humanCheckpoint: true        # Phase 3 — pause here for approval
  - id: apply
    agent: coder
    input: |
      Apply the fix exactly as proposed. Run typecheck and tests. Report results.

      Proposal:
      {{steps.propose.output}}
---
# Bug Investigation

Use when triaging a non-trivial bug. The pause before `apply` is intentional — never let the coder agent edit your repo unsupervised.
```

---

## 4. Daily standup digest

Schedule-triggered digest of yesterday's activity. Phase 4 example, illustrates the schedule trigger.

```yaml
---
name: Daily Standup Digest
description: Pull yesterday's commits, PRs, and notable Slack threads; summarize for standup.
avatar: ☕
trigger:
  type: schedule         # Phase 4
  cron: "0 8 * * 1-5"    # 8am weekdays
  inputs: []
steps:
  - id: gather
    agent: researcher
    input: |
      Gather signals from yesterday:
      - Commits to the main repo (use the git skill)
      - PRs opened or merged (use the github tool)
      - Threads in #engineering or #design in Slack (use the slack tool)

      Return a structured list, no commentary.
  - id: summarize
    agent: writer
    input: |
      Turn this into a standup-ready summary. Punchy, scannable, max 5 bullets.

      Signals:
      {{steps.gather.output}}
---
# Daily Standup Digest

Schedule this for 8am weekdays. Output lands in the recent runs page; pair with a notification or auto-post to a Slack channel via a final step.
```

---

## 5. Research → Decision (Orchestrator-driven)

A workflow that explicitly hands the wheel to the Orchestrator agent for a step. Demonstrates that workflows and Rooms aren't disjoint — workflows can include orchestrator-led steps where the path is dynamic.

```yaml
---
name: Research → Decision
description: Research a question, then let the Orchestrator decide which specialist to hand off to.
avatar: 🎯
trigger:
  type: manual
  inputs:
    - name: question
      type: string
      required: true
steps:
  - id: research
    agent: researcher
    input: "{{trigger.question}}"
  - id: route
    agent: orchestrator
    input: |
      Given this research, pick the next step:
      - if the answer is conclusive, summarize it
      - if a specialist is needed, name which agent + the exact prompt to give them
      - if the user must decide, frame the decision

      Research:
      {{steps.research.output}}
---
# Research → Decision

Use when you don't know in advance which path the work should take. The orchestrator step delivers a reasoned routing recommendation; you (or another workflow) execute it.

In Phase 5 we may add a step type that reads the orchestrator's structured output and dispatches to the named agent automatically.
```

---

## Notes for the seeder

When implementing Phase 1's "seed starter workflows," seed:

- `weekly-content-pipeline` (example #1)
- `email-triage` (example #2)

The other three are documentation only — power users can paste them into the editor.

Mirror the existing pattern in `packages/shared/src/agent-definitions/starter-templates.ts` and the `seedGlobalLibraryIfEmpty` / `ensureRequiredAgents` helpers. Workflows should NOT be re-seeded if the user deletes them — same `.deleted-workflows.json` tombstone idea as `.deleted-agents.json`.
