#!/usr/bin/env node
/**
 * runner-omp — F21: research subtasks through `omp --mode rpc` (or CLI print mode).
 *
 * Same marker contract as runner.mjs; drives ONE omp session per subtask:
 *   node runner-omp.mjs <workspaceRoot> [configName]
 *
 * Config adds nothing new vs runner.mjs; auth via api.rox.one compatible
 * OpenAI endpoint written into an omp-specific HOME by the caller (DO),
 * or synthesised here from baseUrl/apiKey (this file).
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const workspaceRoot = process.argv[2];
if (!workspaceRoot) {
  console.error('usage: runner-omp.mjs <workspaceRoot> [configName]');
  process.exit(2);
}

// omp is baked into the CI-built image (Dockerfile.omp). If absent — e.g.
// the slim default image — fail LOUDLY in seconds, never npm-install in
// the container (spike: ~500MB + native postinstalls never finish inside
// the subtask budget on ephemeral fs; watchdog reaps the whole pack).
{
  const probe = spawnSync('omp', ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    console.error(
      'omp CLI missing in image: deploy the CI-built image (Dockerfile.omp) ' +
      'or run with agenticMode "loop" (default). Status: ' + probe.status,
    );
    process.exit(1);
  }
}

const configName = process.argv[3] ?? 'config.json';
const config = JSON.parse(await readFile(join(workspaceRoot, '.craft-run', configName), 'utf8'));
const { baseUrl, apiKey, model } = config;
const subtasks = config.subtasks ?? [];
if (!baseUrl || !model || subtasks.length === 0) {
  console.error('config missing baseUrl/model/subtasks');
  process.exit(2);
}
const concurrency = Math.min(Math.max(config.concurrency ?? 2, 1), 4);

// omp reads HOME/.omp/agent/config.yml; Vendor: synthesise a rox provider.
const ompHome = join(workspaceRoot, '.omp-home');
await mkdir(join(ompHome, '.omp', 'agent'), { recursive: true });
await writeFile(
  join(ompHome, '.omp', 'agent', 'config.yml'),
  [
    'modelStuff:',
    '  models:',
    `    - name: research-model`,
    `      id: ${model}`,
  ].join('\n') + '\n',
);

const env = {
  ...process.env,
  HOME: ompHome,
  OMP_SKIP_UPDATE_CHECK: '1',
};

async function runSubtask(subtask) {
  const outDir = join(workspaceRoot, 'artifacts', subtask.id);
  await mkdir(outDir, { recursive: true });
  const startedAt = Date.now();
  const finish = async (kind, error) => {
    const durationMs = Date.now() - startedAt;
    await writeFile(
      join(outDir, kind === 'done' ? 'done.marker' : 'fail.marker'),
      JSON.stringify(kind === 'done' ? { finishedAt: new Date().toISOString(), durationMs } : { error: String(error).slice(0, 1000), durationMs }) + '\n',
    );
  };

  try {
    try {
      await readFile(join(outDir, 'done.marker'), 'utf8');
      return true;
    } catch { /* not done */ }

    const sessionDir = join(locationOfSessionFiles(subtask.id));
    await rm(sessionDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(sessionDir, { recursive: true });

    const result = await new Promise((resolvePromise) => {
      const args = [
        '--mode', 'rpc',
        '--session-dir', sessionDir,
        '--no-session-list',
      ];
      const child = spawn('omp', args, { env: { ...env, LLM_BASE_URL: baseUrl, LLM_API_KEY: apiKey ?? '', LLM_MODEL: model } });
      let stdout = '';
      let stderr = '';
      const answerChunks = [];
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolvePromise({ ok: false, error: 'omp timeout', stderr: stderr.slice(-400) });
      }, 540_000);
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        const lines = stdout.split('\n');
        stdout = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'text_delta' && typeof event.text === 'string') answerChunks.push(event.text);
            if (event.command === 'prompt' && event.type === 'agent_end') { /* turn boundary */ }
          } catch { /* partial json */ }
        }
      });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('exit', (code) => {
        clearTimeout(timeout);
        resolvePromise({ ok: code === 0, error: code !== 0 ? `omp exit ${code}: ${stderr.slice(-600)}` : '', text: answerChunks.join('') });
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        resolvePromise({ ok: false, error: String(error) });
      });
      // Send the prompt as an rpc command and close stdin — omp answers and exits.
      child.stdin.write(JSON.stringify({ id: 1, type: 'prompt', text: subtask.prompt }) + '\n');
      child.stdin.end();
    });

    if (!result.ok) {
      await finish('fail', result.error);
      return false;
    }
    if (!(result.text ?? '').trim()) {
      await finish('fail', 'omp produced no text');
      return false;
    }
    await writeFile(join(outDir, 'answer.md'), [`# ${subtask.title ?? subtask.id}`, '', '## Prompt', '', subtask.prompt, '', '## Brief', '', result.text, ''].join('\n'));
    const durationMs = Date.now() - startedAt;
    const usageDir = join(workspaceRoot, 'artifacts', '_usage');
    await mkdir(usageDir, { recursive: true });
    await writeFile(join(usageDir, `${subtask.id}.json`), JSON.stringify({ note: 'usage via omp runner (not aggregated)', durationMs }) + '\n');
    await finish('done');
    console.log(`subtask ${subtask.id} done (omp)`);
    return true;
  } catch (error) {
    await finish('fail', error instanceof Error ? error.message : String(error));
    return false;
  }

  function locationOfSessionFiles(id) {
    return join(workspaceRoot, '.omp-sessions', id);
  }
}

const results = [];
for (let i = 0; i < subtasks.length; i += concurrency) {
  results.push(...(await Promise.all(subtasks.slice(i, i + concurrency).map((s) => runSubtask(s)))));
}
console.log(`pack done: ${results.filter(Boolean).length}/${subtasks.length} subtasks ok (omp)`);
