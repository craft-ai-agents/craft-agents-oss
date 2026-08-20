/**
 * Lightweight source size / token stats (no embeddings).
 * Walks local folders when type=local; otherwise uses guide.md length.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { estimateTokens } from '../utils/large-response.ts';
import type { LoadedSource } from './types.ts';

const TEXT_EXTS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.swift',
  '.css',
  '.html',
  '.xml',
  '.csv',
  '.toml',
  '.ini',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
]);

const MAX_FILES = 500;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export interface SourceFileStat {
  path: string;
  bytes: number;
  chars: number;
  tokenEstimate: number;
}

export interface SourceTokenStats {
  fileCount: number;
  totalBytes: number;
  totalChars: number;
  tokenEstimate: number;
  /** Top files by tokens (capped). */
  files: SourceFileStat[];
  truncated: boolean;
  source: 'guide' | 'local-walk' | 'empty';
}

function isProbablyText(filePath: string, size: number): boolean {
  if (size <= 0 || size > MAX_FILE_BYTES) return false;
  const ext = extname(filePath).toLowerCase();
  if (TEXT_EXTS.has(ext)) return true;
  // extensionless small files (LICENSE, Makefile)
  if (!ext && size < 64 * 1024) return true;
  return false;
}

function walkLocal(root: string): { files: SourceFileStat[]; truncated: boolean; totalBytes: number } {
  const files: SourceFileStat[] = [];
  let truncated = false;
  let totalBytes = 0;
  const stack = [root];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '.craft') continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (files.length >= MAX_FILES) {
        truncated = true;
        return { files, truncated, totalBytes };
      }
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      totalBytes += st.size;
      if (totalBytes > MAX_TOTAL_BYTES) {
        truncated = true;
        return { files, truncated, totalBytes };
      }
      if (!isProbablyText(full, st.size)) continue;
      let text = '';
      try {
        text = readFileSync(full, 'utf-8');
      } catch {
        continue;
      }
      const rel = full.slice(root.length).replace(/^[/\\]/, '') || ent.name;
      files.push({
        path: rel,
        bytes: st.size,
        chars: text.length,
        tokenEstimate: estimateTokens(text),
      });
    }
  }
  return { files, truncated, totalBytes };
}

/**
 * Compute token/size stats for a loaded source.
 * Local sources walk the configured path; others use guide.md only.
 */
export function computeSourceTokenStats(source: LoadedSource): SourceTokenStats {
  if (source.config.type === 'local' && source.config.local?.path) {
    const root = source.config.local.path;
    if (existsSync(root)) {
      const { files, truncated, totalBytes } = walkLocal(root);
      const totalChars = files.reduce((s, f) => s + f.chars, 0);
      const tokenEstimate = files.reduce((s, f) => s + f.tokenEstimate, 0);
      files.sort((a, b) => b.tokenEstimate - a.tokenEstimate);
      return {
        fileCount: files.length,
        totalBytes,
        totalChars,
        tokenEstimate,
        files: files.slice(0, 20),
        truncated,
        source: 'local-walk',
      };
    }
  }

  const guide = source.guide?.raw ?? '';
  if (!guide) {
    return {
      fileCount: 0,
      totalBytes: 0,
      totalChars: 0,
      tokenEstimate: 0,
      files: [],
      truncated: false,
      source: 'empty',
    };
  }
  const tokenEstimate = estimateTokens(guide);
  return {
    fileCount: 1,
    totalBytes: Buffer.byteLength(guide, 'utf-8'),
    totalChars: guide.length,
    tokenEstimate,
    files: [
      {
        path: 'guide.md',
        bytes: Buffer.byteLength(guide, 'utf-8'),
        chars: guide.length,
        tokenEstimate,
      },
    ],
    truncated: false,
    source: 'guide',
  };
}
