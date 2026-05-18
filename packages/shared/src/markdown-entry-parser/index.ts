import { createHash } from 'node:crypto';

// ── Types ───────────────────────────────────────────────────────

export type MarkdownEntryKind =
  | 'alias'
  | 'slang'
  | 'concept'
  | 'convention'
  | 'rule'
  | 'process'
  | 'warning'
  | 'background';

/**
 * Optional metadata parsed from an explicit marker line.
 */
export interface MarkdownEntryMetadata {
  id?: string;
  tags?: string[];
  scope?: string;
  defaults?: Record<string, string>;
  validUntil?: string;
}

/**
 * An explicit marker parsed from a single `<!-- kind ... -->` line.
 */
export interface ExplicitMarker {
  kind: MarkdownEntryKind;
  metadata: MarkdownEntryMetadata;
  title?: string;
  summary?: string;
  term?: string;
  canonical?: string;
}

/**
 * A single structured entry produced by the parser.
 */
export interface MarkdownEntry {
  kind: MarkdownEntryKind;
  metadata: MarkdownEntryMetadata;
  title?: string;
  summary?: string;
  term?: string;
  canonical?: string;
  content: string;
  headingPath: string[];
  sourceDocId?: string;
  sourceTitle?: string;
  updatedAt?: number;
  contentHash?: string;
  priority?: number;
}

/**
 * Optional source metadata passed into the parser.
 */
export interface ParseMarkdownOptions {
  sourceDocId?: string;
  sourceTitle?: string;
  updatedAt?: number;
  priority?: number;
}

// ── Constants ───────────────────────────────────────────────────

const VALID_KINDS: readonly MarkdownEntryKind[] = [
  'alias',
  'slang',
  'concept',
  'convention',
  'rule',
  'process',
  'warning',
  'background',
];

// ── Main parser ─────────────────────────────────────────────────

/**
 * Parses a Markdown string into entry-level chunks.
 *
 * Documents are split by headings to build heading paths. Within each section,
 * explicit `<!-- kind ... -->` markers are detected and parsed. Content following
 * a marker line becomes the entry body. Sections without markers are split into
 * entries based on table rows or paragraphs.
 */
export function parseMarkdownEntries(
  markdown: string,
  options?: ParseMarkdownOptions,
): MarkdownEntry[] {
  const trimmed = markdown.trim();
  if (!trimmed) return [];

  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  const headingMatches: { level: number; title: string; index: number; endIndex: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(trimmed)) !== null) {
    const level = match[1]!.length;
    const title = match[2]!.trim();
    headingMatches.push({
      level,
      title,
      index: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  // No headings → treat entire document as one unmarked section
  if (headingMatches.length === 0) {
    return processSectionContent(trimmed, [], options);
  }

  const entries: MarkdownEntry[] = [];
  const headingStack: { title: string; level: number }[] = [];

  for (let i = 0; i < headingMatches.length; i++) {
    const h = headingMatches[i]!;

    // Build heading path by maintaining hierarchy
    while (
      headingStack.length > 0 &&
      headingStack[headingStack.length - 1]!.level >= h.level
    ) {
      headingStack.pop();
    }
    headingStack.push({ title: h.title, level: h.level });

    // Section content starts after the heading line
    const sectionStart = h.endIndex;
    const sectionEnd =
      i + 1 < headingMatches.length
        ? headingMatches[i + 1]!.index
        : trimmed.length;
    const sectionContent = trimmed.slice(sectionStart, sectionEnd).trim();
    if (!sectionContent) continue;

    const headingPath = headingStack.map(s => s.title);
    const sectionEntries = processSectionContent(sectionContent, headingPath, options);
    entries.push(...sectionEntries);
  }

  return entries;
}

// ── Section processing ──────────────────────────────────────────

function processSectionContent(
  content: string,
  headingPath: string[],
  options?: ParseMarkdownOptions,
): MarkdownEntry[] {
  const lines = content.split('\n');

  // Find explicit marker lines and their line indices
  const markerSpans: { marker: ExplicitMarker; lineIndex: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const marker = parseMarkerLine(lines[i]!);
    if (marker) {
      markerSpans.push({ marker, lineIndex: i });
    }
  }

  if (markerSpans.length > 0) {
    return processMarkedSection(lines, markerSpans, headingPath, options);
  }

  // No explicit markers → try table rows, then paragraphs
  if (hasTable(lines)) {
    return processTableLines(lines, headingPath, options);
  }

  return processParagraphs(content, headingPath, options);
}

function processMarkedSection(
  lines: string[],
  markers: { marker: ExplicitMarker; lineIndex: number }[],
  headingPath: string[],
  options?: ParseMarkdownOptions,
): MarkdownEntry[] {
  const entries: MarkdownEntry[] = [];

  for (let i = 0; i < markers.length; i++) {
    const { marker, lineIndex } = markers[i]!;
    const nextMarkerLine = i + 1 < markers.length ? markers[i + 1]!.lineIndex : lines.length;

    const contentLines = lines
      .slice(lineIndex + 1, nextMarkerLine)
      .map(l => l.trim());
    const content = contentLines.join('\n').replace(/^\n+|\n+$/g, '');

    entries.push(buildEntry(marker, content, headingPath, options));
  }

  return entries;
}

function processTableLines(
  lines: string[],
  headingPath: string[],
  options?: ParseMarkdownOptions,
): MarkdownEntry[] {
  const rows = extractTableDataRows(lines);
  return rows.map(row => {
    const content = row.join(' | ');
    return buildEntry(
      { kind: 'concept', metadata: {} },
      content,
      headingPath,
      options,
    );
  });
}

function processParagraphs(
  content: string,
  headingPath: string[],
  options?: ParseMarkdownOptions,
): MarkdownEntry[] {
  const paragraphs = content
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  return paragraphs.map(p =>
    buildEntry({ kind: 'concept', metadata: {} }, p, headingPath, options),
  );
}

// ── Marker parsing ──────────────────────────────────────────────

/**
 * Parses a single `<!-- kind key:value ... -->` line into an ExplicitMarker.
 * Returns null if the line is not a valid marker.
 */
export function parseMarkerLine(line: string): ExplicitMarker | null {
  const trimmed = line.trim();
  const match = trimmed.match(/^<!--\s+(\w+)([\s\S]*?)-->\s*$/);
  if (!match) return null;

  const kind = match[1] as MarkdownEntryKind;
  if (!VALID_KINDS.includes(kind)) return null;

  const rest = match[2]!.trim();
  const marker: ExplicitMarker = { kind, metadata: {} };

  if (!rest) return marker;

  // Parse key:value pairs. Value captures greedily until next "word:" or end.
  const pairRegex = /(\w+):(.+?)(?=\s+\w+:|$)/g;
  let pairMatch: RegExpExecArray | null;
  while ((pairMatch = pairRegex.exec(rest)) !== null) {
    const key = pairMatch[1]!;
    const value = pairMatch[2]!.trim();

    switch (key) {
      case 'id':
        marker.metadata.id = value;
        break;
      case 'tags':
        marker.metadata.tags = value.split(',').map(t => t.trim()).filter(Boolean);
        break;
      case 'scope':
        marker.metadata.scope = value;
        break;
      case 'defaults':
        marker.metadata.defaults = parseDefaults(value);
        break;
      case 'validUntil':
        marker.metadata.validUntil = value;
        break;
      case 'title':
        marker.title = value;
        break;
      case 'summary':
        marker.summary = value;
        break;
      case 'term':
        marker.term = value;
        break;
      case 'canonical':
        marker.canonical = value;
        break;
    }
  }

  return marker;
}

function parseDefaults(value: string): Record<string, string> {
  const inner = value.replace(/^\{|\}$/g, '').trim();
  if (!inner) return {};

  const pairs: Record<string, string> = {};
  for (const part of inner.split(',')) {
    const colonIndex = part.indexOf(':');
    if (colonIndex === -1) continue;
    const k = part.slice(0, colonIndex).trim();
    const v = part.slice(colonIndex + 1).trim();
    if (k) pairs[k] = v;
  }
  return pairs;
}

// ── Table helpers ───────────────────────────────────────────────

function hasTable(lines: string[]): boolean {
  return lines.some(l => /^\s*\|/.test(l));
}

/**
 * Extracts data rows (non-header, non-separator) from table lines.
 * Returns each row as an array of cell values.
 */
function extractTableDataRows(lines: string[]): string[][] {
  const tableLines = lines
    .map(l => l.trim())
    .filter(l => l.startsWith('|') && l.endsWith('|'));

  // Skip header row (first) and separator row (second, contains only ---)
  const dataLines = tableLines.filter((l, idx) => {
    if (idx === 0) return false; // skip header
    // Skip separator rows: |---|---| etc.
    if (/^\|[\s\-:]+\|/.test(l)) return false;
    return true;
  });

  return dataLines.map(l => {
    const cells = l
      .split('|')
      .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1) // skip empty first/last from split
      .map(c => c.trim());
    return cells;
  });
}

// ── Entry builder ───────────────────────────────────────────────

function buildEntry(
  marker: ExplicitMarker,
  content: string,
  headingPath: string[],
  options?: ParseMarkdownOptions,
): MarkdownEntry {
  const entry: MarkdownEntry = {
    kind: marker.kind,
    metadata: marker.metadata,
    title: marker.title,
    summary: marker.summary,
    term: marker.term,
    canonical: marker.canonical,
    content,
    headingPath,
    contentHash: sha256(content),
  };

  if (options) {
    if (options.sourceDocId) entry.sourceDocId = options.sourceDocId;
    if (options.sourceTitle) entry.sourceTitle = options.sourceTitle;
    if (options.updatedAt !== undefined) entry.updatedAt = options.updatedAt;
    if (options.priority !== undefined) entry.priority = options.priority;
  }

  return entry;
}

// ── Utilities ───────────────────────────────────────────────────

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
