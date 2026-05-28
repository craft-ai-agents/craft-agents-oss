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
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

type Phase = "plan" | "implement" | "review" | "merge";
type LinearIssue = { id: string; identifier: string; title: string; branch: string };

function parseArg(flag: string, fallback: number): number {
    const idx = process.argv.indexOf(flag);
    if (idx !== -1 && process.argv[idx + 1]) {
        const n = parseInt(process.argv[idx + 1], 10);
        if (!isNaN(n) && n > 0) return n;
    }
    return fallback;
}

function parseStringArg(flag: string, fallback: string): string {
    const idx = process.argv.indexOf(flag);
    return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function parseBoolArg(flag: string): boolean {
    return process.argv.includes(flag);
}

function parseIssueIdentifiers(): string[] {
    const values: string[] = [];
    for (let i = 0; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (arg === "--issue" && process.argv[i + 1]) {
            values.push(...process.argv[i + 1].split(","));
            i++;
        }
    }
    return values.map((value) => value.trim()).filter(Boolean);
}

function parseStartPhase(): Phase {
    const raw = parseStringArg("--start-from", parseStringArg("--from", "plan"));
    if (raw === "plan" || raw === "implement" || raw === "review" || raw === "merge") {
        return raw;
    }
    throw new Error(`Invalid phase '${raw}'. Use one of: plan, implement, review, merge.`);
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
const LAST_PLAN_PATH = join(PROMPTS, "logs", "linear-last-plan.json");
const START_FROM = parseStartPhase();
const ISSUE_IDENTIFIERS = parseIssueIdentifiers();
const RESUME_FROM_PLAN = parseBoolArg("--resume");
const IS_SINGLE_SHOT = ISSUE_IDENTIFIERS.length > 0 || START_FROM !== "plan" || RESUME_FROM_PLAN;
const SHOULD_RESUME = RESUME_FROM_PLAN || START_FROM !== "plan";

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

function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60)
        .replace(/-+$/g, "");
}

function branchForIssue(identifier: string, title: string): string {
    return `afk/issue-${identifier.toLowerCase()}-${slugify(title)}`;
}

async function execJson<T>(command: string, args: string[]): Promise<T> {
    return new Promise<T>((resolveResult, reject) => {
        const child = spawn(command, args, {
            cwd: ROOT,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.on("close", (code) => {
            if (code !== 0) {
                reject(new Error(`${command} ${args.join(" ")} failed with ${code}\n${stderr}`));
                return;
            }
            try {
                resolveResult(JSON.parse(stdout) as T);
            } catch (error) {
                reject(new Error(`Failed to parse JSON from ${command} ${args.join(" ")}\n${stdout}\n${error}`));
            }
        });
    });
}

async function loadIssuesFromLinear(identifiers: string[]): Promise<LinearIssue[]> {
    const issues = await Promise.all(
        identifiers.map(async (identifier) => {
            const issue = await execJson<{
                id: string;
                identifier: string;
                title: string;
            }>("bun", [LINEAR_CLI, "read", identifier]);
            return {
                id: issue.id,
                identifier: issue.identifier,
                title: issue.title,
                branch: branchForIssue(issue.identifier, issue.title),
            };
        })
    );
    return issues.slice(0, MAX_ISSUES);
}

function saveLastPlan(issues: LinearIssue[]): void {
    writeFileSync(
        LAST_PLAN_PATH,
        JSON.stringify({ savedAt: new Date().toISOString(), issues }, null, 2)
    );
}

function loadLastPlan(): LinearIssue[] | null {
    if (!existsSync(LAST_PLAN_PATH)) {
        return null;
    }

    try {
        const parsed = JSON.parse(readFileSync(LAST_PLAN_PATH, "utf8")) as { issues?: LinearIssue[] };
        if (!Array.isArray(parsed.issues) || parsed.issues.length === 0) {
            return null;
        }
        return parsed.issues.slice(0, MAX_ISSUES);
    } catch {
        return null;
    }
}

async function planIssues(): Promise<LinearIssue[]> {
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

    const { issues } = JSON.parse(planMatch[1]) as { issues: LinearIssue[] };
    const selected = issues.slice(0, MAX_ISSUES);
    saveLastPlan(selected);
    return selected;
}

async function loadOrPlanIssues(): Promise<LinearIssue[]> {
    const savedIssues = loadLastPlan();
    if (savedIssues) {
        console.log(`Using saved Linear plan from ${LAST_PLAN_PATH}.`);
        return savedIssues;
    }

    console.log("No saved Linear plan found. Running planner.");
    return planIssues();
}

async function resolveExecutionIssues(plannedIssues: LinearIssue[]): Promise<LinearIssue[]> {
    if (ISSUE_IDENTIFIERS.length > 0) {
        const issues = await loadIssuesFromLinear(ISSUE_IDENTIFIERS);
        saveLastPlan(issues);
        return issues;
    }

    return plannedIssues;
}

async function reviewIssue(issue: LinearIssue): Promise<void> {
    await using sandbox = await sandcastle.createSandbox({
        sandbox: localProvider,
        cwd: ROOT,
        branch: issue.branch,
        hooks: {
            host: {
                onWorktreeReady: [{ command: "ln -sfn \"$(git worktree list | awk 'NR==1{print $1}')/node_modules\" node_modules" }],
            },
        },
    });

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

async function implementIssue(issue: LinearIssue): Promise<SandboxRunResult> {
    await using sandbox = await sandcastle.createSandbox({
        sandbox: localProvider,
        cwd: ROOT,
        branch: issue.branch,
        hooks: {
            host: {
                onWorktreeReady: [{ command: "ln -sfn \"$(git worktree list | awk 'NR==1{print $1}')/node_modules\" node_modules" }],
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
        await reviewIssue(issue);
    }

    return result;
}

async function runIssuePhase<T>(
    issues: LinearIssue[],
    task: (issue: LinearIssue) => Promise<T>
): Promise<PromiseSettledResult<T>[]> {
    const sem = makeSemaphore(MAX_PARALLEL);
    return Promise.allSettled(
        issues.map(async (issue) => {
            await sem.acquire();
            try {
                return await task(issue);
            } finally {
                sem.release();
            }
        })
    );
}

function logSettledErrors<T>(issues: LinearIssue[], settled: PromiseSettledResult<T>[]): void {
    for (const [idx, outcome] of settled.entries()) {
        if (outcome.status === "rejected") {
            console.error(`  x ${issues[idx].identifier} failed: ${outcome.reason}`);
        }
    }
}

async function mergeIssues(issues: LinearIssue[]): Promise<void> {
    if (issues.length === 0) {
        console.log("Nothing to merge.");
        return;
    }

    await sandcastle.run({
        sandbox: localProvider,
        cwd: ROOT,
        agent,
        promptFile: join(PROMPTS, "merge-linear-prompt.md"),
        promptArgs: {
            BRANCHES: issues.map((iss) => `- ${iss.branch}`).join("\n"),
            ISSUES: issues.map((iss) => `- ${iss.identifier} (${iss.id}): ${iss.title}`).join("\n"),
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

const agent = parseAgent();

for (let i = 1; i <= MAX_ITERATIONS; i++) {
    console.log(`\n=== Iteration ${i}/${MAX_ITERATIONS} ===\n`);

    const plannedIssues = SHOULD_RESUME ? await loadOrPlanIssues() : await planIssues();
    const phase = i === 1 ? START_FROM : "plan";
    const issues = await resolveExecutionIssues(plannedIssues);

    if (issues.length === 0) {
        console.log("No unblocked issues. Exiting.");
        break;
    }

    console.log(`${issues.length} issue(s) to work on:`);
    for (const issue of issues) {
        console.log(`  ${issue.identifier}: ${issue.title} -> ${issue.branch}`);
    }

    if (phase === "review") {
        const settled = await runIssuePhase(issues, reviewIssue);
        logSettledErrors(issues, settled);
        const reviewed = settled
            .map((outcome, idx) => ({ outcome, issue: issues[idx] }))
            .filter(
                (entry): entry is { outcome: PromiseFulfilledResult<void>; issue: LinearIssue } =>
                    entry.outcome.status === "fulfilled"
            )
            .map((entry) => entry.issue);
        await mergeIssues(reviewed);
        break;
    }

    if (phase === "merge") {
        await mergeIssues(issues);
        break;
    }

    const settled = await runIssuePhase(issues, implementIssue);
    logSettledErrors(issues, settled);

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
        if (IS_SINGLE_SHOT) {
            break;
        }
        continue;
    }

    await mergeIssues(completed);

    if (IS_SINGLE_SHOT) {
        break;
    }
}

console.log("\nAll done.");
