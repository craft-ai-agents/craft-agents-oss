/**
 * stub-runner — reference runner for LocalSubprocessProvider.
 *
 * Simulates a research run without any LLM: walks spec.subtasks
 * sequentially, writes a markdown note + done.marker per subtask into
 * artifacts/<subtaskId>/, maintains state.json and appends to
 * events.jsonl. Honours the prd checkpoint/resume convention: a
 * subtask with an existing done.marker is skipped, so a restarted
 * runner continues where it stopped (PRD §G2.4).
 *
 * Usage: bun stub-runner.ts --dir <runDir>
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Subtask { id: string; title?: string; prompt: string }
interface Spec {
  id: string;
  name: string;
  subtasks: Subtask[];
  limits?: { maxWallClockSec?: number; maxLlmTokens?: number; maxArtifactsBytes?: number };
  metadata?: Record<string, string>;
}

const dirFlag = process.argv.indexOf('--dir');
const dir = dirFlag > 0 ? process.argv[dirFlag + 1] : undefined;
if (!dir) {
  console.error('usage: stub-runner --dir <runDir>');
  process.exit(2);
}

const spec = JSON.parse(await readFile(join(dir, 'spec.json'), 'utf8')) as Spec;
const statePath = join(dir, 'state.json');
const eventsPath = join(dir, 'events.jsonl');

async function setState(state: Record<string, unknown>): Promise<void> {
  await writeFile(statePath, JSON.stringify(state, null, 2));
  await appendFile(eventsPath, JSON.stringify({ type: 'state', status: state }) + '\n');
}

await setState({ id: spec.id, state: 'running', startedAt: Date.now() });

try {
  const total = spec.subtasks.length;
  let completed = 0;
  for (const subtask of spec.subtasks) {
    const outDir = join(dir, 'artifacts', subtask.id);
    await mkdir(outDir, { recursive: true });
    // Resume: a finished subtask is not redone (PRD checkpoint rule).
    const markerPath = join(outDir, 'done.marker');
    const already = await readFile(markerPath, 'utf8').catch(() => null);
    if (already === null) {
      // Simulated agent work; real runner talks to the LLM gateway here.
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 30);
      await promise;
      await writeFile(
        join(outDir, 'notes.md'),
        [
          `# ${subtask.title ?? subtask.id}`,
          '',
          `> Stub artifact for run ${spec.id}.`,
          '',
          '## Prompt',
          '',
          subtask.prompt,
          '',
        ].join('\n'),
      );
      await writeFile(markerPath, new Date().toISOString() + '\n');
    }
    completed += 1;
    await appendFile(eventsPath, JSON.stringify({ type: 'progress', completed, total }) + '\n');
  }
  await setState({ id: spec.id, state: 'done', startedAt: Date.now(), finishedAt: Date.now(), progress: { completed: total, total } });
} catch (error) {
  await setState({
    id: spec.id,
    state: 'failed',
    failureReason: 'runner_error',
    finishedAt: Date.now(),
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}
