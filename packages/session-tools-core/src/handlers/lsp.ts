/**
 * LSP Handler
 *
 * Read-only language intelligence backed by the TypeScript language service.
 *
 * This is the concrete capability behind the `lsp` session tool. Availability is
 * reported honestly: if the TypeScript language service cannot be loaded in the
 * current environment, the tool reports `available: false` instead of silently
 * degrading to text search.
 *
 * Scope is deliberately TypeScript/JavaScript-only for now. Other languages
 * should be added by extending the service resolution, not by faking results.
 */

import { dirname, extname, isAbsolute, resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';

export type LspOperation = 'diagnostics' | 'definition' | 'references' | 'symbols';

export interface LspArgs {
  operation: LspOperation;
  file: string;
  /** 1-based line, required for `definition` and `references`. */
  line?: number;
  /** 1-based column, required for `definition` and `references`. */
  column?: number;
}

/** Extensions the TypeScript language service can meaningfully analyze. */
const SUPPORTED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

/** Operations that need a cursor position. */
const POSITION_OPERATIONS = new Set<LspOperation>(['definition', 'references']);

/** Upper bound on returned locations so a hot symbol can't flood the transcript. */
const MAX_LOCATIONS = 200;

type TsModule = typeof import('typescript');

/**
 * Load the TypeScript language service lazily.
 *
 * Dynamic so that environments without `typescript` resolvable (packaged
 * subprocesses, trimmed installs) degrade to an explicit "unavailable" result
 * rather than crashing tool registration at import time.
 */
async function loadTypeScript(): Promise<TsModule | null> {
  try {
    const mod = (await import('typescript')) as unknown as { default?: TsModule };
    return (mod.default ?? (mod as unknown as TsModule)) ?? null;
  } catch {
    return null;
  }
}

function unavailableResult(operation: LspOperation): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            operation,
            available: false,
            reason:
              'TypeScript language service is not available in this environment. Install/resolve the "typescript" package to enable LSP features.',
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}

function jsonResult(payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Build a language service rooted at the nearest tsconfig.json.
 *
 * Falling back to standalone defaults (rather than failing) keeps single-file
 * and scratch-directory analysis working; cross-file resolution simply narrows
 * to what the file itself imports.
 */
function createLanguageService(ts: TsModule, filePath: string) {
  const searchDir = dirname(filePath);
  const configPath = ts.findConfigFile(searchDir, ts.sys.fileExists, 'tsconfig.json');

  let options: import('typescript').CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowJs: true,
    strict: true,
    noEmit: true,
  };
  let rootFiles: string[] = [filePath];
  let projectRoot = searchDir;

  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!configFile.error) {
      projectRoot = dirname(configPath);
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot);
      options = { ...parsed.options, noEmit: true };
      rootFiles = parsed.fileNames.length > 0 ? parsed.fileNames : [filePath];
    }
  }

  // The requested file may sit outside the project's include globs; analyzing it
  // is still the user's explicit intent, so make sure it is part of the program.
  if (!rootFiles.some((f) => resolve(f) === resolve(filePath))) {
    rootFiles = [...rootFiles, filePath];
  }

  const host: import('typescript').LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => rootFiles,
    getScriptVersion: () => '1',
    getScriptSnapshot: (fileName) => {
      const content = ts.sys.readFile(fileName);
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => projectRoot,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

function toLineColumn(
  ts: TsModule,
  sourceFile: import('typescript').SourceFile,
  position: number
): { line: number; column: number } {
  const lc = ts.getLineAndCharacterOfPosition(sourceFile, position);
  return { line: lc.line + 1, column: lc.character + 1 };
}

function flattenNavigationTree(
  ts: TsModule,
  sourceFile: import('typescript').SourceFile,
  node: import('typescript').NavigationTree,
  depth: number,
  out: Array<{ name: string; kind: string; line: number; column: number }>
): void {
  // Depth 0 is the synthetic file-level node; it carries no useful symbol info.
  if (depth > 0) {
    const span = node.spans[0];
    if (span) {
      const { line, column } = toLineColumn(ts, sourceFile, span.start);
      out.push({ name: node.text, kind: String(node.kind), line, column });
    }
  }

  for (const child of node.childItems ?? []) {
    flattenNavigationTree(ts, sourceFile, child, depth + 1, out);
  }
}

/**
 * Handle the `lsp` tool call.
 */
export async function handleLsp(ctx: SessionToolContext, args: LspArgs): Promise<ToolResult> {
  const { operation } = args;

  if (!args.file) {
    return errorResponse('A "file" path is required.');
  }

  const filePath = isAbsolute(args.file) ? args.file : resolve(ctx.workspacePath, args.file);

  if (!ctx.fs.exists(filePath)) {
    return errorResponse(`File not found: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return errorResponse(
      `File type "${ext || '(none)'}" is not supported by the LSP tool. Supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}`
    );
  }

  if (POSITION_OPERATIONS.has(operation)) {
    if (typeof args.line !== 'number' || typeof args.column !== 'number') {
      return errorResponse(
        `Operation "${operation}" requires both "line" and "column" (1-based).`
      );
    }
    if (args.line < 1 || args.column < 1) {
      return errorResponse('"line" and "column" are 1-based and must be >= 1.');
    }
  }

  const ts = await loadTypeScript();
  if (!ts) {
    return unavailableResult(operation);
  }

  let service: import('typescript').LanguageService;
  try {
    service = createLanguageService(ts, filePath);
  } catch (error) {
    return errorResponse(
      `Failed to start the TypeScript language service: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  try {
    const program = service.getProgram();
    const sourceFile = program?.getSourceFile(filePath);
    if (!sourceFile) {
      return errorResponse(`Could not load "${filePath}" into the TypeScript program.`);
    }

    if (operation === 'diagnostics') {
      const diagnostics = [
        ...service.getSyntacticDiagnostics(filePath),
        ...service.getSemanticDiagnostics(filePath),
      ];

      return jsonResult({
        operation,
        available: true,
        file: filePath,
        diagnostics: diagnostics.map((d) => {
          const start = typeof d.start === 'number' ? d.start : 0;
          const { line, column } = toLineColumn(ts, sourceFile, start);
          return {
            line,
            column,
            category: ts.DiagnosticCategory[d.category].toLowerCase(),
            code: d.code,
            message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
          };
        }),
      });
    }

    if (operation === 'symbols') {
      const tree = service.getNavigationTree(filePath);
      const symbols: Array<{ name: string; kind: string; line: number; column: number }> = [];
      if (tree) {
        flattenNavigationTree(ts, sourceFile, tree, 0, symbols);
      }

      return jsonResult({
        operation,
        available: true,
        file: filePath,
        symbols: symbols.slice(0, MAX_LOCATIONS),
      });
    }

    // Position-based operations
    const position = ts.getPositionOfLineAndCharacter(
      sourceFile,
      args.line! - 1,
      args.column! - 1
    );

    const rawLocations =
      operation === 'definition'
        ? service.getDefinitionAtPosition(filePath, position)
        : service.getReferencesAtPosition(filePath, position);

    const locations = (rawLocations ?? [])
      .map((entry) => {
        const target = program?.getSourceFile(entry.fileName);
        if (!target) return null;
        const { line, column } = toLineColumn(ts, target, entry.textSpan.start);
        return { file: entry.fileName, line, column };
      })
      .filter((l): l is { file: string; line: number; column: number } => l !== null);

    return jsonResult({
      operation,
      available: true,
      file: filePath,
      locations: locations.slice(0, MAX_LOCATIONS),
    });
  } catch (error) {
    return errorResponse(
      `LSP ${operation} failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  } finally {
    service.dispose();
  }
}
