import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleLsp } from './lsp.ts';
import type { SessionToolContext } from '../context.ts';

function createCtx(workspacePath: string): SessionToolContext {
  return {
    sessionId: 'test-session',
    workspacePath,
    fs: {
      exists: (path: string) => existsSync(path),
      readFile: (path: string) => readFileSync(path, 'utf-8'),
      readFileBuffer: (path: string) => readFileSync(path),
      writeFile: (path: string, content: string) => writeFileSync(path, content),
      isDirectory: (path: string) => existsSync(path) && statSync(path).isDirectory(),
      readdir: (path: string) => readdirSync(path),
      stat: (path: string) => {
        const s = statSync(path);
        return { size: s.size, isDirectory: () => s.isDirectory() };
      },
    },
  } as unknown as SessionToolContext;
}

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2020',
      module: 'CommonJS',
      moduleResolution: 'Node',
      strict: true,
      noEmit: true,
    },
  },
  null,
  2
);

const HELPER_TS = `export function greet(name: string): string {
  return \`Hello \${name}\`;
}
`;

// line 3, column 11 is the \`greet\` call site in \`const a = greet('world')\`
const MAIN_TS = `import { greet } from './helper';

const a = greet('world');
const b = greet(42);
export { a, b };
`;

function parseResult(text: string): any {
  return JSON.parse(text);
}

describe('lsp tool', () => {
  let tempDir: string;
  let mainPath: string;
  let helperPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lsp-tool-'));
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'tsconfig.json'), TSCONFIG);
    helperPath = join(tempDir, 'src', 'helper.ts');
    mainPath = join(tempDir, 'src', 'main.ts');
    writeFileSync(helperPath, HELPER_TS);
    writeFileSync(mainPath, MAIN_TS);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports type diagnostics for a file', async () => {
    const ctx = createCtx(tempDir);
    const result = await handleLsp(ctx, { operation: 'diagnostics', file: mainPath });
    const payload = parseResult(result.content[0]!.text);

    expect(payload.available).toBe(true);
    expect(payload.diagnostics.length).toBeGreaterThan(0);

    const messages = payload.diagnostics.map((d: any) => d.message).join('\n');
    expect(messages).toContain('number');
    expect(messages).toContain('string');

    const errorLines = payload.diagnostics.map((d: any) => d.line);
    expect(errorLines).toContain(4);
  });

  it('resolves a cross-file definition', async () => {
    const ctx = createCtx(tempDir);
    const result = await handleLsp(ctx, {
      operation: 'definition',
      file: mainPath,
      line: 3,
      column: 11,
    });
    const payload = parseResult(result.content[0]!.text);

    expect(payload.available).toBe(true);
    expect(payload.locations.length).toBeGreaterThan(0);
    expect(payload.locations.some((l: any) => l.file.endsWith('helper.ts'))).toBe(true);
  });

  it('finds references across files', async () => {
    const ctx = createCtx(tempDir);
    const result = await handleLsp(ctx, {
      operation: 'references',
      file: mainPath,
      line: 3,
      column: 11,
    });
    const payload = parseResult(result.content[0]!.text);

    expect(payload.available).toBe(true);
    const files = payload.locations.map((l: any) => l.file);
    expect(files.some((f: string) => f.endsWith('helper.ts'))).toBe(true);
    expect(files.some((f: string) => f.endsWith('main.ts'))).toBe(true);
  });

  it('lists document symbols', async () => {
    const ctx = createCtx(tempDir);
    const result = await handleLsp(ctx, { operation: 'symbols', file: helperPath });
    const payload = parseResult(result.content[0]!.text);

    expect(payload.available).toBe(true);
    expect(payload.symbols.some((s: any) => s.name === 'greet')).toBe(true);
  });

  it('rejects unsupported file types with a clear error', async () => {
    const ctx = createCtx(tempDir);
    const mdPath = join(tempDir, 'notes.md');
    writeFileSync(mdPath, '# notes\n');

    const result = await handleLsp(ctx, { operation: 'diagnostics', file: mdPath });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('not supported');
  });

  it('errors clearly when the file does not exist', async () => {
    const ctx = createCtx(tempDir);
    const result = await handleLsp(ctx, {
      operation: 'diagnostics',
      file: join(tempDir, 'src', 'missing.ts'),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('not found');
  });

  it('requires line and column for position-based operations', async () => {
    const ctx = createCtx(tempDir);
    const result = await handleLsp(ctx, { operation: 'definition', file: mainPath });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('line');
  });
});
