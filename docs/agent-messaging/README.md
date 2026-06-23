# Agent Messaging

Status: draft
Owner: RunnerOS
Last updated: 2026-06-08

## Purpose

Define native RunnerOS agent-to-agent messaging: a controlled way for one agent, workflow step, automation, or run mode to delegate a bounded task to another specialist agent and receive a structured result.

This is not a replacement for workflows. Workflows remain the reliable runtime for known paths. Agent messaging is the delegation primitive that makes workflows, Deep Research, Rooms, and orchestrators more flexible without turning them into untraceable swarm loops.

## Core Decision

Build Runner-native `message_agent` first.

Use existing RunnerOS primitives:

- sessions for each delegated agent call
- agent definitions for specialist identity
- source/skill resolution through `SessionManager`
- workflow/run receipts for traceability
- permission modes for safety
- output schemas for machine-readable replies
- memory injection and launch receipts for context provenance

External agent protocols are out of scope for this branch. Build the native RunnerOS delegation path first.

## Docs

- [01 Spec](./01-spec.md)
- [02 Implementation Plan](./02-implementation-plan.md)

## MVP Definition

The MVP is complete when:

1. An agent can call `message_agent` with a target agent slug, task, context, budget, and optional output schema.
2. RunnerOS creates a real hidden child session for the target agent.
3. Missing target agents, missing required skills, and unavailable sources fail before execution.
4. The caller receives a compact result with child session id, output, tool-use summary, and error state.
5. The parent session/run records a delegation receipt.
6. The UI can show "Agent A asked Agent B" and open the child session.
7. Recursive delegation is bounded by depth, timeout, and permission policy.
