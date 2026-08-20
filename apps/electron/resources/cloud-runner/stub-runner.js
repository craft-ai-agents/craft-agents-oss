// @bun
// packages/cloud-runner/src/runners/stub-runner.ts
import { appendFile, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
var dirFlag = process.argv.indexOf("--dir");
var dir = dirFlag > 0 ? process.argv[dirFlag + 1] : undefined;
if (!dir) {
  console.error("usage: stub-runner --dir <runDir>");
  process.exit(2);
}
var spec = JSON.parse(await readFile(join(dir, "spec.json"), "utf8"));
var statePath = join(dir, "state.json");
var eventsPath = join(dir, "events.jsonl");
async function setState(state) {
  await writeFile(statePath, JSON.stringify(state, null, 2));
  await appendFile(eventsPath, JSON.stringify({ type: "state", status: state }) + `
`);
}
await setState({ id: spec.id, state: "running", startedAt: Date.now() });
try {
  const total = spec.subtasks.length;
  let completed = 0;
  for (const subtask of spec.subtasks) {
    const outDir = join(dir, "artifacts", subtask.id);
    await mkdir(outDir, { recursive: true });
    const markerPath = join(outDir, "done.marker");
    const already = await readFile(markerPath, "utf8").catch(() => null);
    if (already === null) {
      const { promise, resolve } = Promise.withResolvers();
      setTimeout(resolve, 30);
      await promise;
      await writeFile(join(outDir, "notes.md"), [
        `# ${subtask.title ?? subtask.id}`,
        "",
        `> Stub artifact for run ${spec.id}.`,
        "",
        "## Prompt",
        "",
        subtask.prompt,
        ""
      ].join(`
`));
      await writeFile(markerPath, new Date().toISOString() + `
`);
    }
    completed += 1;
    await appendFile(eventsPath, JSON.stringify({ type: "progress", completed, total }) + `
`);
  }
  await setState({ id: spec.id, state: "done", startedAt: Date.now(), finishedAt: Date.now(), progress: { completed: total, total } });
} catch (error) {
  await setState({
    id: spec.id,
    state: "failed",
    failureReason: "runner_error",
    finishedAt: Date.now(),
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
}
