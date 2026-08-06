/**
 * Generator prompt for Generate mode (#2 / architecture §3a).
 *
 * The task's persistent orchestrator session is asked to AUTHOR a `task.yaml`
 * from a natural-language goal. The result is a human-editable artifact, so the
 * prompt is legibility-first (#7): bias toward the simplest graph that achieves
 * the goal, with clear titles and explicit dependencies — not the cleverest one.
 */
export function buildGeneratorPrompt(goal: string, title?: string): string {
  return [
    'You are authoring a `task.yaml` that decomposes a goal into a small DAG of subtasks.',
    'Each node becomes a child AI session; a `depends_on` edge passes the upstream node\'s output to the dependent.',
    '',
    'Rules:',
    '- Output ONLY the YAML — no prose, no code fences, no explanation.',
    '- Prefer the SIMPLEST graph that achieves the goal: few nodes, clear titles, explicit dependencies. A human will read and edit this.',
    '- Make nodes parallel (no `depends_on` between them) ONLY when the steps are genuinely independent.',
    '- Reference an upstream result inside a prompt with ${nodes.<id>.output}.',
    '- Every ${nodes.<id>.output} reference MUST point to an `id` that you actually declare under `nodes`. Never reference a node you did not create. Verify each reference resolves before emitting the YAML.',
    '- Add `acceptance_criteria`: a short, checkable rubric for the FINISHED task (what "done and correct" means). It is what you will grade the result against when the run finishes — make it concrete and testable, not a restatement of the goal.',
    '',
    'Schema:',
    '  id: kebab-case-slug',
    '  title: short human title',
    '  goal: one-line restatement of the goal',
    '  acceptance_criteria: a concrete, checkable definition of done for the whole task',
    '  nodes:',
    '    - id: kebab-id',
    '      title: short title (becomes the subtask/session name)',
    '      prompt: the full instruction for this subtask (may include ${nodes.<id>.output})',
    '      depends_on: [other-node-id]   # omit when the node has no dependencies',
    '',
    'Example:',
    '  id: migrate-auth',
    '  title: Migrate auth',
    '  goal: Migrate the auth layer to the new session model.',
    '  acceptance_criteria: All auth call sites use the new session API and the existing auth tests pass.',
    '  nodes:',
    '    - id: audit',
    '      title: Audit call sites',
    '      prompt: List every auth call site and how it is used.',
    '    - id: design',
    '      title: Design new auth',
    '      prompt: "Design the new session-based auth using the audit: ${nodes.audit.output}"',
    '      depends_on: [audit]',
    '',
    title ? `Working title: ${title}` : '',
    `Goal: ${goal}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Repair prompt for the auto-repair turn (Generate mode robustness).
 *
 * The orchestrator just authored a `task.yaml` that failed validation (commonly a
 * `${nodes.X.output}` reference to a node id it never declared). It still holds the
 * conversation, so we hand the concrete validation errors back and ask for a corrected
 * spec — same output contract as the original generation (YAML only).
 */
export function buildRepairPrompt(errors: { path: string; message: string }[]): string {
  return [
    'The task.yaml you produced failed validation with these errors:',
    ...errors.map((e) => `- ${e.path}: ${e.message}`),
    '',
    'Fix every error and output the COMPLETE corrected task.yaml.',
    'Most common cause: a ${nodes.<id>.output} reference whose <id> is not declared under `nodes`. Either add the missing node or change the reference to an id you actually declare.',
    'Output ONLY the YAML — no prose, no code fences, no explanation.',
  ].join('\n')
}
