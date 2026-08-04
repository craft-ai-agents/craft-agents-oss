#!/usr/bin/env -S deno run --allow-read

/**
 * Electron Security Scanner
 *
 * Static analysis for Electron security misconfigurations.
 * Detects common security anti-patterns and suggests fixes.
 *
 * Usage:
 *   deno run --allow-read scripts/analyze-security.ts <path> [options]
 *
 * Options:
 *   --strict      Enable all checks including medium severity
 *   --json        Output JSON for CI
 *   -h, --help    Show help
 */

// === Constants ===
const VERSION = "1.0.0";
const SCRIPT_NAME = "analyze-security";

// === Types ===
interface AnalyzeOptions {
  path: string;
  strict: boolean;
  json: boolean;
}

interface Issue {
  severity: "critical" | "high" | "medium";
  category: string;
  message: string;
  file: string;
  line: number;
  column: number;
  code: string;
  fix: string;
}

interface AnalysisResult {
  path: string;
  filesAnalyzed: number;
  issues: Issue[];
  summary: {
    critical: number;
    high: number;
    medium: number;
  };
}

// === Patterns to Detect ===
const PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  severity: Issue["severity"];
  category: string;
  message: string;
  fix: string;
}> = [
  {
    name: "node-integration",
    pattern: /nodeIntegration:\s*true/g,
    severity: "critical",
    category: "BrowserWindow Security",
    message: "nodeIntegration enabled allows renderer to access Node.js APIs",
    fix: "Remove nodeIntegration or set to false (default)",
  },
  {
    name: "context-isolation-disabled",
    pattern: /contextIsolation:\s*false/g,
    severity: "critical",
    category: "BrowserWindow Security",
    message: "Disabling contextIsolation exposes preload scope to renderer",
    fix: "Remove contextIsolation or set to true (default)",
  },
  {
    name: "sandbox-disabled",
    pattern: /sandbox:\s*false/g,
    severity: "high",
    category: "BrowserWindow Security",
    message: "Disabling sandbox gives preload full Node.js access",
    fix: "Remove sandbox setting or set to true (default since Electron 20)",
  },
  {
    name: "raw-ipc-exposure",
    pattern: /ipcRenderer[,\s]*[:,]\s*ipcRenderer|ipcRenderer:\s*ipcRenderer/g,
    severity: "high",
    category: "IPC Security",
    message: "Raw ipcRenderer exposure gives renderer full IPC access",
    fix: "Wrap IPC calls in contextBridge functions",
  },
  {
    name: "bind-all-interfaces-hostname",
    pattern: /hostname:\s*['"]0\.0\.0\.0['"]/g,
    severity: "critical",
    category: "Network Security",
    message: "Server bound to all interfaces is accessible from network",
    fix: "Bind to '127.0.0.1' (localhost only)",
  },
  {
    name: "bind-all-interfaces-host",
    pattern: /host:\s*['"]0\.0\.0\.0['"]/g,
    severity: "critical",
    category: "Network Security",
    message: "Server bound to all interfaces is accessible from network",
    fix: "Bind to '127.0.0.1' (localhost only)",
  },
  {
    name: "web-security-disabled",
    pattern: /webSecurity:\s*false/g,
    severity: "critical",
    category: "BrowserWindow Security",
    message: "Disabling web security removes same-origin policy",
    fix: "Remove webSecurity or set to true",
  },
  {
    name: "insecure-content",
    pattern: /allowRunningInsecureContent:\s*true/g,
    severity: "high",
    category: "Content Security",
    message: "Allows loading HTTP content in HTTPS context",
    fix: "Remove allowRunningInsecureContent",
  },
  {
    name: "experimental-features",
    pattern: /experimentalFeatures:\s*true/g,
    severity: "medium",
    category: "Feature Security",
    message: "Experimental Chromium features may have security issues",
    fix: "Disable unless specifically needed",
  },
  {
    name: "remote-module-enabled",
    pattern: /enableRemoteModule:\s*true/g,
    severity: "high",
    category: "Module Security",
    message: "Remote module is deprecated and has security risks",
    fix: "Use IPC instead of remote module",
  },
];

// === File Discovery ===
async function findProjectFiles(path: string): Promise<string[]> {
  const files: string[] = [];
  const extensions = [".ts", ".tsx", ".js", ".mjs"];

  try {
    const stat = await Deno.stat(path);

    if (stat.isFile) {
      const hasExt = extensions.some((ext) => path.endsWith(ext));
      if (hasExt) {
        files.push(path);
      }
    } else if (stat.isDirectory) {
      for await (const entry of Deno.readDir(path)) {
        // Skip node_modules and hidden directories
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          continue;
        }

        const fullPath = `${path}/${entry.name}`;

        if (entry.isFile) {
          const hasExt = extensions.some((ext) => entry.name.endsWith(ext));
          // Skip declaration files
          if (hasExt && !entry.name.endsWith(".d.ts")) {
            files.push(fullPath);
          }
        } else if (entry.isDirectory) {
          const subFiles = await findProjectFiles(fullPath);
          files.push(...subFiles);
        }
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.error(`Error: Path not found: ${path}`);
      Deno.exit(1);
    }
    throw error;
  }

  return files;
}

// === Analysis ===
function analyzeFilePatterns(
  filePath: string,
  content: string,
  options: AnalyzeOptions
): Issue[] {
  const issues: Issue[] = [];
  const lines = content.split("\n");

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    const trimmedLine = line.trim();

    // Skip comment-only lines for most checks
    const isCommentLine =
      trimmedLine.startsWith("//") || trimmedLine.startsWith("/*");

    for (const pattern of PATTERNS) {
      // Skip medium severity in non-strict mode
      if (!options.strict && pattern.severity === "medium") {
        continue;
      }

      // Reset regex lastIndex
      pattern.pattern.lastIndex = 0;

      let match;
      while ((match = pattern.pattern.exec(line)) !== null) {
        // Skip patterns found in comments
        if (isCommentLine) {
          continue;
        }

        issues.push({
          severity: pattern.severity,
          category: pattern.category,
          message: pattern.message,
          file: filePath,
          line: lineNum + 1,
          column: match.index + 1,
          code: match[0],
          fix: pattern.fix,
        });
      }
    }
  }

  return issues;
}

function analyzeFileLevelPatterns(
  filePath: string,
  content: string,
  options: AnalyzeOptions
): Issue[] {
  const issues: Issue[] = [];

  // Skip medium severity file-level checks in non-strict mode
  if (!options.strict) {
    return issues;
  }

  // Check: file contains new BrowserWindow but no explicit contextIsolation or sandbox
  const hasBrowserWindow = /new\s+BrowserWindow\s*\(/g.test(content);
  if (hasBrowserWindow) {
    const hasContextIsolation = /contextIsolation\s*:/g.test(content);
    const hasSandbox = /sandbox\s*:/g.test(content);

    if (!hasContextIsolation && !hasSandbox) {
      // Find the line where BrowserWindow is created
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (/new\s+BrowserWindow\s*\(/.test(lines[i])) {
          issues.push({
            severity: "medium",
            category: "BrowserWindow Security",
            message:
              "BrowserWindow may not have explicit security defaults",
            file: filePath,
            line: i + 1,
            column: 1,
            code: "new BrowserWindow(...)",
            fix: "Explicitly set contextIsolation: true, sandbox: true",
          });
          break;
        }
      }
    }
  }

  return issues;
}

async function analyze(options: AnalyzeOptions): Promise<AnalysisResult> {
  const files = await findProjectFiles(options.path);

  if (files.length === 0) {
    console.error(`No project files found in: ${options.path}`);
    Deno.exit(1);
  }

  const allIssues: Issue[] = [];

  for (const file of files) {
    const content = await Deno.readTextFile(file);
    const patternIssues = analyzeFilePatterns(file, content, options);
    const fileLevelIssues = analyzeFileLevelPatterns(file, content, options);
    allIssues.push(...patternIssues, ...fileLevelIssues);
  }

  // Sort by severity
  const severityOrder: Record<Issue["severity"], number> = {
    critical: 0,
    high: 1,
    medium: 2,
  };
  allIssues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const summary = {
    critical: allIssues.filter((i) => i.severity === "critical").length,
    high: allIssues.filter((i) => i.severity === "high").length,
    medium: allIssues.filter((i) => i.severity === "medium").length,
  };

  return {
    path: options.path,
    filesAnalyzed: files.length,
    issues: allIssues,
    summary,
  };
}

// === Output Formatting ===
function formatHumanOutput(result: AnalysisResult): void {
  console.log("\nELECTRON SECURITY ANALYSIS REPORT");
  console.log("==================================\n");
  console.log(`Path: ${result.path}`);
  console.log(`Files analyzed: ${result.filesAnalyzed}`);
  console.log();

  const total =
    result.summary.critical + result.summary.high + result.summary.medium;

  console.log("ISSUES BY SEVERITY");
  console.log(`  Critical: ${result.summary.critical}`);
  console.log(`  High: ${result.summary.high}`);
  console.log(`  Medium: ${result.summary.medium}`);
  console.log(`  Total: ${total}`);
  console.log();

  if (result.issues.length === 0) {
    console.log("No security issues found!");
    return;
  }

  console.log("ISSUES:");
  console.log();

  for (const issue of result.issues) {
    const severityLabel = `[${issue.severity.toUpperCase()}]`.padEnd(10);
    console.log(`${severityLabel} ${issue.category}: ${issue.message}`);
    console.log(`           File: ${issue.file}:${issue.line}:${issue.column}`);
    console.log(`           Code: ${issue.code}`);
    console.log(`           Fix: ${issue.fix}`);
    console.log();
  }
}

// === Help Text ===
function printHelp(): void {
  console.log(`
${SCRIPT_NAME} v${VERSION} - Electron Security Scanner

Usage:
  deno run --allow-read scripts/analyze-security.ts <path> [options]

Arguments:
  <path>          File or directory to scan

Options:
  --strict        Enable all checks including medium severity
  --json          Output JSON for CI
  -h, --help      Show this help

Examples:
  # Scan a single file
  deno run --allow-read scripts/analyze-security.ts ./src/main/index.ts

  # Scan entire project
  deno run --allow-read scripts/analyze-security.ts ./src

  # Strict mode (include medium severity)
  deno run --allow-read scripts/analyze-security.ts ./src --strict

  # JSON output for CI integration
  deno run --allow-read scripts/analyze-security.ts ./src --json

Checks Performed:

  BrowserWindow Security:
    - nodeIntegration enabled (critical)
    - contextIsolation disabled (critical)
    - sandbox disabled (high)
    - webSecurity disabled (critical)
    - Missing explicit security defaults (medium, --strict)

  IPC Security:
    - Raw ipcRenderer exposure (high)

  Network Security:
    - Server bound to all interfaces 0.0.0.0 (critical)

  Content Security:
    - allowRunningInsecureContent enabled (high)

  Module Security:
    - enableRemoteModule enabled (high)

  Feature Security:
    - experimentalFeatures enabled (medium, --strict)

Exit Codes:
  0  No critical issues found
  1  Critical issues detected
`);
}

// === CLI Handler ===
function parseArgs(args: string[]): AnalyzeOptions | null {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return null;
  }

  const options: AnalyzeOptions = {
    path: "",
    strict: false,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (!arg.startsWith("-")) {
      options.path = arg;
    }
  }

  if (!options.path) {
    console.error("Error: Path is required");
    return null;
  }

  return options;
}

// === Entry Point ===
async function main(): Promise<void> {
  const options = parseArgs(Deno.args);

  if (!options) {
    printHelp();
    Deno.exit(0);
  }

  const result = await analyze(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    formatHumanOutput(result);
  }

  // Exit with error code if critical issues found
  if (result.summary.critical > 0) {
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
