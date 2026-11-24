/**
 * task.yaml fixtures for the task brief demos, keyed by slug: the playground's `getTask` mock
 * (`mock-utils.ts`) serves them, so a demo session with one of these as its `taskSlug` loads it.
 */

const AGENT_GOAL =
  'Add the Craft workspace folder (`.craft-agent/`) and `/reference` to the repo\'s `.gitignore`, then ' +
  'remove both from the index with `git rm -r --cached`, so they stop showing up in `git status`.'

export const TASK_SPEC_SAMPLES = {
  // What create_task writes: the description is the goal and the one subtask's prompt
  'gitignore-the-workspace': {
    id: 'gitignore-the-workspace',
    title: 'Gitignore the Craft workspace and /reference',
    goal: AGENT_GOAL,
    acceptance_criteria: '- `.gitignore` lists `.craft-agent/` and `/reference`\n- `git status` shows neither folder\n- No other file changes',
    nodes: [{ id: 'main', title: 'Gitignore the Craft workspace and /reference', prompt: AGENT_GOAL }],
  },
  'ship-the-release': {
    id: 'ship-the-release',
    title: 'Ship the 0.15.7 release',
    goal: 'Cut **0.15.7** from `main`: release notes from the merged PRs, version bumps, a smoke-tested build, then the tag.',
    acceptance_criteria: 'The tag `v0.15.7` points at a commit whose build passed the smoke test, and the notes name every merged PR.',
    nodes: [
      { id: 'notes', title: 'Write the release notes', prompt: 'Write the notes.' },
      { id: 'bump', title: 'Bump the versions', prompt: 'Bump them.' },
      { id: 'smoke', title: 'Smoke-test the build', prompt: 'Test it.', depends_on: ['bump'] },
      { id: 'tag', title: 'Tag and push', prompt: 'Tag it.', depends_on: ['notes', 'smoke'] },
    ],
  },
  'tidy-the-readme': {
    id: 'tidy-the-readme',
    title: 'Tidy the README',
    goal: 'Tidy the README',
    nodes: [{ id: 'main', title: 'Tidy the README', prompt: 'Tidy the README' }],
  },
  'audit-auth': {
    id: 'audit-auth',
    title: 'Audit the OAuth flows',
    goal: [
      'Review every source OAuth flow for the issues below and fix what you find.',
      '',
      '## Scope',
      '',
      '- `packages/server-core/src/handlers/rpc/oauth.ts`: single flight per workspace + source',
      '- `apps/electron/src/transport/source-oauth.ts`: the client side, shared by the preload and the WebUI',
      '- Token refresh in `SourceCredentialManager.refresh`',
      '',
      '## What to look for',
      '',
      '1. A second `oauth:start` that starts a new flow instead of joining the live one',
      '2. A failed exchange that fails every waiting session, not just the starter\'s card',
      '3. Refresh tokens written before the exchange is verified',
      '',
      'Reproduce each finding with a test before fixing it:',
      '',
      '```ts',
      'const first = startFlow(ws, "github")',
      'const second = startFlow(ws, "github", { joinLive: true })',
      'expect(second.flowId).toBe(first.flowId)',
      '```',
      '',
      'See the [OAuth notes](https://example.com/oauth-notes) for the relay redirect.',
    ].join('\n'),
    acceptance_criteria: 'Each finding has a failing test that now passes; no flow regresses in the existing OAuth tests.',
    nodes: [
      { id: 'map', title: 'Map the flows', prompt: 'Map them.' },
      { id: 'fix', title: 'Fix and test each finding', prompt: 'Fix them.', depends_on: ['map'] },
    ],
  },
  // runTask refuses this one with the runner's own message
  'already-running': {
    id: 'already-running',
    title: 'Nightly dependency bump',
    goal: 'Bump the dependencies that have patch releases and run the test suite.',
    nodes: [{ id: 'main', title: 'Nightly dependency bump', prompt: 'Bump the dependencies that have patch releases and run the test suite.' }],
  },
} as const

export type TaskSpecSample = keyof typeof TASK_SPEC_SAMPLES

export const TASK_SPEC_SAMPLE_OPTIONS: Array<{ label: string; value: TaskSpecSample }> = [
  { label: 'Created by an agent (one step)', value: 'gitignore-the-workspace' },
  { label: 'Four subtasks', value: 'ship-the-release' },
  { label: 'Goal only', value: 'tidy-the-readme' },
  { label: 'Long markdown goal', value: 'audit-auth' },
  { label: 'Already running (Run fails)', value: 'already-running' },
]
