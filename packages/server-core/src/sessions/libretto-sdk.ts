import { spawn } from "child_process";

/**
 * Thin Libretto adapter used by SessionManager.
 *
 * For now this is intentionally CLI-backed: every method shells out to
 * `npx libretto ...` and returns stdout/stderr/exitCode to the caller.
 * The goal is to centralize Craft's Libretto integration behind one small
 * interface so we can later swap the internals to a real Libretto SDK
 * without rewriting SessionManager's browser-tool wiring.
 */

export interface LibrettoCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface LibrettoSessionOptions {
  cwd: string;
  sessionName: string;
}

interface LibrettoPageCommandOptions extends LibrettoSessionOptions {
  pageTargetId?: string | null;
}

export type LibrettoBrowserCommandName = "snapshot" | "exec" | "run" | "resume";

interface LibrettoRunCommandOptions {
  cwd: string;
  sessionName: string;
  pageTargetId?: string | null;
}

const LIBRETTO_PAGE_COMMANDS = new Set(["snapshot", "exec"]);

/**
 * TODO: Replace this with a real Libretto SDK once it exists. For now, this is
 * just a thin wrapper around the Libretto CLI that SessionManager can use to
 * run commands and manage sessions without needing to know about the CLI
 * details. This keeps our options open for how we integrate with Libretto in
 * the future without coupling SessionManager to a specific implementation.
 */
export class LibrettoSDK {
  async attachToBrowser(
    options: LibrettoSessionOptions & { cdpUrl: string },
  ): Promise<LibrettoCliResult> {
    return await this.runCli(options.cwd, [
      "connect",
      options.cdpUrl,
      "--session",
      options.sessionName,
    ]);
  }

  async closeSession(
    options: LibrettoSessionOptions,
  ): Promise<LibrettoCliResult> {
    return await this.runCli(options.cwd, [
      "close",
      "--session",
      options.sessionName,
    ]);
  }

  async snapshot(
    args: string[],
    options: LibrettoPageCommandOptions,
  ): Promise<LibrettoCliResult> {
    return await this.runPageCommand("snapshot", args, options);
  }

  async exec(
    args: string[],
    options: LibrettoPageCommandOptions,
  ): Promise<LibrettoCliResult> {
    return await this.runPageCommand("exec", args, options);
  }

  async run(
    args: string[],
    options: LibrettoSessionOptions,
  ): Promise<LibrettoCliResult> {
    return await this.runSessionCommand("run", args, options);
  }

  async resume(
    args: string[],
    options: LibrettoSessionOptions,
  ): Promise<LibrettoCliResult> {
    return await this.runSessionCommand("resume", args, options);
  }

  async runBrowserCommand(
    commandName: LibrettoBrowserCommandName,
    args: string[],
    options: LibrettoRunCommandOptions,
  ): Promise<LibrettoCliResult> {
    if (commandName === "snapshot") return await this.snapshot(args, options);
    if (commandName === "exec") return await this.exec(args, options);
    if (commandName === "run") return await this.run(args, options);
    return await this.resume(args, options);
  }

  private async runPageCommand(
    commandName: string,
    args: string[],
    options: LibrettoPageCommandOptions,
  ): Promise<LibrettoCliResult> {
    const finalArgs = [commandName, "--session", options.sessionName];

    if (
      options.pageTargetId &&
      LIBRETTO_PAGE_COMMANDS.has(commandName.toLowerCase())
    ) {
      finalArgs.push("--page", options.pageTargetId);
    }

    finalArgs.push(...this.sanitizeCliArgs(args));
    return await this.runCli(options.cwd, finalArgs);
  }

  private async runSessionCommand(
    commandName: string,
    args: string[],
    options: LibrettoSessionOptions,
  ): Promise<LibrettoCliResult> {
    return await this.runCli(options.cwd, [
      commandName,
      "--session",
      options.sessionName,
      ...this.sanitizeCliArgs(args),
    ]);
  }

  private sanitizeCliArgs(rawArgs: string[]): string[] {
    const sanitized: string[] = [];
    for (let i = 0; i < rawArgs.length; i += 1) {
      const arg = rawArgs[i]!;
      if (arg === "--session" || arg === "--page") {
        i += 1;
        continue;
      }
      sanitized.push(arg);
    }
    return sanitized;
  }

  private async runCli(
    cwd: string,
    args: string[],
  ): Promise<LibrettoCliResult> {
    return await this.runProcess(
      this.getNpxCommand(),
      ["libretto", ...args],
      cwd,
    );
  }

  private getNpxCommand(): string {
    return process.platform === "win32" ? "npx.cmd" : "npx";
  }

  private async runProcess(
    command: string,
    args: string[],
    cwd: string,
  ): Promise<LibrettoCliResult> {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          exitCode: code ?? 0,
        });
      });
    });
  }
}
