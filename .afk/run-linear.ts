#!/usr/bin/env bun
/**
 * AFK agent loop - Linear issue variant.
 *
 * Same orchestration as run.ts but reads from Linear via .afk/linear.ts.
 * Issue shape: { id, identifier, title, branch }.
 */

import * as sandcastle from "@ai-hero/sandcastle";
import { createBindMountSandboxProvider } from "@ai-hero/sandcastle";
import type { AgentProvider, SandboxRunResult } from "@ai-hero/sandcastle";
import { spawn } from "child_process";
import { join, resolve } from "path";

function parseArg(flag: string, fallback: number): number {
    const idx = process.argv.indexOf(flag);
    if (idx !== -1 && process.argv[idx + 1]) {
        const n = parseInt(process.argv[idx + 1], 10);
        if (!isNaN(n) && n > 0) return n;
    }
    return fallback;
}

function parseAgent(): AgentProvider {
    const idx = process.argv.indexOf("--agent");
    const name = idx !== -1 ? process.argv[idx + 1] : "claude";
    if (name === "codex") return sandcastle.codex("gpt-5.5", { effort: "medium" });
    return sandcastle.claudeCode("claude-sonnet-4-6", { effort: "medium", captureSessions: false });
}

const MAX_ITERATIONS = parseArg("--iterations", 10);
const MAX_PARALLEL = parseArg("--parallel", 4);
const MAX_ISSUES = parseArg("--issues", 2);
const IDLE_SECONDS = 12 * 60 * 60;
const ROOT = resolve(import.meta.dir, "..");
const PROMPTS = import.meta.dir;
const LINEAR_CLI = join(PROMPTS, "linear.ts");

// Local bind-mount provider (no Docker).

const localProvider = createBindMountSandboxProvider({
    name: "local",
    create: async ({ worktreePath, env }) => ({
        worktreePath,
        async exec(command, options = {}) {
            const cwd = options.cwd ?? worktreePath;
            return new Promise<{ stdout: string; stderr: string; exitCode: number }>(
                (resolveResult) => {
                    const child = spawn("/bin/sh", ["-c", command], {
                        cwd,
                        env: { ...process.env, ...env },
                        stdio: ["pipe", "pipe", "pipe"],
                    });

                    if (options.stdin) {
                        child.stdin!.write(options.stdin);
                    }
                    child.stdin!.end();

                    let stdout = "";
                    let stderr = "";

                    child.stdout?.on("data", (chunk: Buffer) => {
                        const text = chunk.toString();
                        stdout += text;
                        if (options.onLine) {
                            text.split("\n").forEach((line) => {
                                if (line) options.onLine!(line);
                            });
                        }
                    });

                    child.stderr?.on("data", (chunk: Buffer) => {
                        stderr += chunk.toString();
                    });

                    child.on("close", (code) => {
                        resolveResult({ stdout, stderr, exitCode: code ?? 0 });
                    });
                }
            );
        },
        copyFileIn: async () => { },
        copyFileOut: async () => { },
        close: async () => { },
    }),
});

function makeSemaphore(limit: number) {
    let running = 0;
    const queue: (() => void)[] = [];

    const acquire = (): Promise<void> =>
        running < limit
            ? (running++, Promise.resolve())
            : new Promise<void>((res) => queue.push(res));

    const release = () => {
        running--;
        const next = queue.shift();
        if (next) {
            running++;
            next();
        }
    };

    return { acquire, release };
}

const agent = parseAgent();

for (let i = 1; i <= MAX_ITERATIONS; i++) {
    console.log(`\n=== Iteration ${i}/${MAX_ITERATIONS} ===\n`);

    const plan = await sandcastle.run({
        sandbox: localProvider,
        cwd: ROOT,
        agent,
        promptFile: join(PROMPTS, "plan-linear-prompt.md"),
        promptArgs: {
            LINEAR_CLI,
        },
        completionSignal: "</plan>",
        idleTimeoutSeconds: IDLE_SECONDS,
        name: "Linear Planner",
        logging: {
            type: "file",
            path: ".afk/logs/linear-plan.log"
        }
    });

    const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/);
    if (!planMatch) {
        throw new Error("Planner did not produce a <plan> tag.\n\n" + plan.stdout);
    }

    let { issues } = JSON.parse(planMatch[1]) as {
        issues: { id: string; identifier: string; title: string; branch: string }[];
    };

    if (issues.length === 0) {
        console.log("No unblocked issues. Exiting.");
        break;
    }

    issues = issues.slice(0, MAX_ISSUES);

    console.log(`${issues.length} issue(s) to work on:`);
    for (const issue of issues) {
        console.log(`  ${issue.identifier}: ${issue.title} -> ${issue.branch}`);
    }

    const sem = makeSemaphore(MAX_PARALLEL);

    const settled = await Promise.allSettled(
        issues.map(async (issue) => {
            await sem.acquire();
            try {
                await using sandbox = await sandcastle.createSandbox({
                    sandbox: localProvider,
                    cwd: ROOT,
                    branch: issue.branch,
                    hooks: {
                        host: {
                            onWorktreeReady: [{ command: "bun install" }],
                        },
                    },
                });

                const result = await sandbox.run({
                    agent,
                    promptFile: join(PROMPTS, "implement-linear-prompt.md"),
                    promptArgs: {
                        ISSUE_ID: issue.id,
                        ISSUE_IDENTIFIER: issue.identifier,
                        ISSUE_TITLE: issue.title,
                        BRANCH: issue.branch,
                        LINEAR_CLI,
                    },
                    completionSignal: "<promise>COMPLETE</promise>",
                    idleTimeoutSeconds: IDLE_SECONDS,
                    name: `Linear Implementer ${issue.identifier}`,
                    logging: {
                        type: "file",
                        path: ".afk/logs/linear-impl.log"
                    }
                });

                if (result.commits.length > 0) {
                    await sandbox.run({
                        agent,
                        promptFile: join(PROMPTS, "review-linear-prompt.md"),
                        promptArgs: {
                            ISSUE_ID: issue.id,
                            ISSUE_IDENTIFIER: issue.identifier,
                            ISSUE_TITLE: issue.title,
                            BRANCH: issue.branch,
                            LINEAR_CLI,
                        },
                        completionSignal: "<promise>COMPLETE</promise>",
                        idleTimeoutSeconds: IDLE_SECONDS,
                        name: `Linear Reviewer ${issue.identifier}`,
                        logging: {
                            type: "file",
                            path: ".afk/logs/linear-review.log"
                        }
                    });
                }

                return result;
            } finally {
                sem.release();
            }
        })
    );

    for (const [idx, outcome] of settled.entries()) {
        if (outcome.status === "rejected") {
            console.error(
                `  x ${issues[idx].identifier} failed: ${outcome.reason}`
            );
        }
    }

    const completed = settled
        .map((o, idx) => ({ outcome: o, issue: issues[idx] }))
        .filter(
            (
                e
            ): e is {
                outcome: PromiseFulfilledResult<SandboxRunResult>;
                issue: (typeof issues)[number];
            } =>
                e.outcome.status === "fulfilled" &&
                e.outcome.value.commits.length > 0
        )
        .map((e) => e.issue);

    console.log(`\n${completed.length} branch(es) ready to merge.`);

    if (completed.length === 0) {
        console.log("Nothing to merge.");
        continue;
    }

    await sandcastle.run({
        sandbox: localProvider,
        cwd: ROOT,
        agent,
        promptFile: join(PROMPTS, "merge-linear-prompt.md"),
        promptArgs: {
            BRANCHES: completed.map((iss) => `- ${iss.branch}`).join("\n"),
            ISSUES: completed.map((iss) => `- ${iss.identifier} (${iss.id}): ${iss.title}`).join("\n"),
            LINEAR_CLI,
        },
        maxIterations: 10,
        completionSignal: "<promise>COMPLETE</promise>",
        idleTimeoutSeconds: IDLE_SECONDS,
        name: "Linear Merger",
        logging: {
            type: "file",
            path: ".afk/logs/linear-merge.log"
        }
    });

    console.log("Branches merged.");
}

console.log("\nAll done.");
