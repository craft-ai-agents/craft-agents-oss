#!/usr/bin/env bun
/**
 * Creates a local issue file under .scratch/issues/ using a sandcastle agent.
 *
 * Usage:
 *   bun .afk/create-local-issue.ts "description"
 *   bun .afk/create-local-issue.ts --agent codex "description"
 */

import * as sandcastle from "@ai-hero/sandcastle";
import { createBindMountSandboxProvider } from "@ai-hero/sandcastle";
import type { AgentProvider } from "@ai-hero/sandcastle";
import { spawn } from "child_process";
import { join, resolve } from "path";

function parseAgent(): AgentProvider {
    const idx = process.argv.indexOf("--agent");
    const name = idx !== -1 ? process.argv[idx + 1] : "claude";
    if (name === "codex") return sandcastle.codex("gpt-5.4-mini", { effort: "medium" });
    return sandcastle.claudeCode("claude-haiku-4-5", { effort: "medium", captureSessions: false });
}

function parseDescription(): string {
    const args = process.argv.slice(2);
    const filtered: string[] = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--agent") {
            i++;
        } else {
            filtered.push(args[i]);
        }
    }
    return filtered.join(" ").trim();
}

const description = parseDescription();
if (!description) {
    console.error("Usage: create-local-issue.ts [--agent claude|codex] <description>");
    process.exit(1);
}

const IDLE_SECONDS = 5 * 60;
const ROOT = resolve(import.meta.dir, "..");
const PROMPTS = import.meta.dir;

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
        copyFileIn: async () => {},
        copyFileOut: async () => {},
        close: async () => {},
    }),
});

const agent = parseAgent();

await sandcastle.run({
    sandbox: localProvider,
    cwd: ROOT,
    agent,
    promptFile: join(PROMPTS, "create-local-issue-prompt.md"),
    promptArgs: {
        DESCRIPTION: description,
    },
    completionSignal: "<promise>COMPLETE</promise>",
    idleTimeoutSeconds: IDLE_SECONDS,
    name: "LocalIssueCreator",
    logging: {
        type: "file",
        path: ".afk/logs/create-local-issue.log",
    },
});
