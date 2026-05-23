# Deep Research Mode

Status: draft
Owner: RunnerOS
Last updated: 2026-05-23

## Purpose

Define RunnerOS Deep Research mode: a native, workflow-backed investigation runner that turns a broad question into a reviewed or auto-approved plan, executes focused research steps with real tools/sources, and produces a traceable report artifact.

## Docs

- [01 Spec](./01-spec.md)

## Core Decision

Deep Research is a RunnerOS run mode, not a standalone mega-agent and not a LangGraph port.

Use existing RunnerOS primitives:

- sessions for each execution step
- agents for planner, researcher, data analyst/coder, and reporter roles
- sources/tools for retrieval and external work
- workflow/run storage for progress and recovery
- outputs/artifacts for final reports
- visual sidecar later for polished report/citation display

## MVP Definition

The MVP is complete when a user can:

1. Start a Deep Research run from a prompt.
2. Choose `approve` or `auto` plan policy.
3. See a structured plan before execution in approve mode.
4. Let auto mode execute immediately after internal validation.
5. Watch step-level progress and open underlying step sessions.
6. Receive a final report with citations/source receipts.
7. Inspect the saved plan, step outputs, tool usage, and failure reasons after the run.
