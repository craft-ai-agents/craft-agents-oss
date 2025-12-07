import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';
import { createHighlighter, type Highlighter } from 'shiki';

// Lazy-loaded highlighter instance
let highlighter: Highlighter | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighter) {
    highlighter = await createHighlighter({
      themes: ['tokyo-night'],
      langs: ['javascript', 'typescript', 'python', 'json', 'bash', 'markdown', 'html', 'css', 'sql', 'yaml', 'go', 'rust', 'java', 'c', 'cpp'],
    });
  }
  return highlighter;
}

/**
 * Map hex color to nearest ANSI color for terminal theme adaptation
 */
function hexToAnsiColor(hex: string): typeof chalk {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // Map based on dominant channel / hue
  if (r > 200 && g < 150 && b < 150) return chalk.red;
  if (r < 150 && g > 180 && b < 150) return chalk.green;
  if (r < 150 && g < 150 && b > 200) return chalk.blue;
  if (r > 180 && g > 180 && b < 150) return chalk.yellow;
  if (r > 180 && g < 150 && b > 180) return chalk.magenta;
  if (r < 150 && g > 180 && b > 180) return chalk.cyan;
  if (r < 100 && g < 100 && b < 100) return chalk.gray;
  return chalk.white;
}

/**
 * Convert highlighted tokens to ANSI escape codes
 */
function tokensToANSI(tokens: { color?: string; content: string }[][]): string {
  const lines: string[] = [];

  for (const line of tokens) {
    let lineStr = '';
    for (const token of line) {
      const color = token.color || '#dcdee8';
      const chalkColor = hexToAnsiColor(color);
      lineStr += chalkColor(token.content);
    }
    lines.push(lineStr);
  }

  return lines.join('\n');
}


// Simple LRU cache for markdown rendering to avoid re-parsing
const markdownCache = new Map<string, string>();
const CACHE_MAX_SIZE = 100;

// Cache for highlighted code blocks (key: "lang:code" -> highlighted ANSI string)
const codeBlockCache = new Map<string, string>();

// Track terminal width for dynamic sizing
let lastConfiguredWidth = 0;

function getCachedMarkdown(text: string): string | undefined {
  return markdownCache.get(text);
}

function setCachedMarkdown(text: string, rendered: string): void {
  if (markdownCache.size >= CACHE_MAX_SIZE) {
    const firstKey = markdownCache.keys().next().value;
    if (firstKey) markdownCache.delete(firstKey);
  }
  markdownCache.set(text, rendered);
}

function getCodeBlockKey(code: string, lang: string): string {
  return `${lang}:${code}`;
}

/**
 * Pre-highlight code blocks in markdown text using Shiki with Tokyo Night theme.
 * Call this before renderMarkdown for syntax-highlighted code blocks.
 */
export async function prepareCodeBlocks(text: string): Promise<void> {
  // Extract code blocks using regex
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const matches = [...text.matchAll(codeBlockRegex)];

  const hl = await getHighlighter();

  const highlightPromises = matches.map(async (match) => {
    const lang = match[1] ?? 'text';
    const code = (match[2] ?? '').trimEnd();
    const key = getCodeBlockKey(code, lang);

    // Skip if already cached
    if (codeBlockCache.has(key)) return;

    try {
      // Get tokens and convert to ANSI with color replacements
      const result = hl.codeToTokens(code, { lang: lang as any, theme: 'tokyo-night' });
      const highlighted = tokensToANSI(result.tokens);
      codeBlockCache.set(key, highlighted);
    } catch {
      // Fallback to plain styling if language not supported
      codeBlockCache.set(key, chalk.white(code));
    }
  });

  await Promise.all(highlightPromises);
}

/**
 * Replace code blocks in markdown with pre-highlighted versions.
 * This allows us to bypass cli-highlight and use Shiki's Tokyo Night highlighting.
 */
function injectHighlightedCodeBlocks(text: string): string {
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;

  return text.replace(codeBlockRegex, (_, lang, code) => {
    const trimmedCode = (code as string).trimEnd();
    const key = getCodeBlockKey(trimmedCode, lang || 'text');
    const highlighted = codeBlockCache.get(key);

    if (highlighted) {
      // Return a special marker that won't be re-highlighted
      const langLabel = lang ? chalk.gray(`  ${lang}`) : '';
      return `\n${langLabel}\n${highlighted}\n`;
    }

    // Keep original if not cached
    return '```' + lang + '\n' + code + '```';
  });
}

/**
 * Get current terminal width, with fallback
 */
function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

/**
 * Configure marked-terminal with current terminal width.
 * Only reconfigures if width has changed to avoid unnecessary work.
 */
function ensureMarkedConfigured(): void {
  const currentWidth = getTerminalWidth();

  if (currentWidth === lastConfiguredWidth) {
    return; // Already configured for this width
  }

  // Width changed - reconfigure and clear cache
  lastConfiguredWidth = currentWidth;
  markdownCache.clear();

  marked.use(
    markedTerminal({
      // Semantic ANSI colors - terminal remaps these based on light/dark theme
      code: chalk.white,
      blockquote: chalk.gray.italic,
      html: chalk.gray,
      heading: chalk.blue.bold,
      firstHeading: chalk.magenta.bold,
      hr: chalk.gray,
      listitem: chalk.reset,
      list: (body: string) => body,
      table: chalk.reset,
      paragraph: chalk.reset,
      strong: chalk.yellow.bold,
      em: chalk.green.italic,
      codespan: chalk.cyan,
      del: chalk.gray.strikethrough,
      link: chalk.blue.underline,
      href: chalk.cyan,
      showSectionPrefix: false,
      unescape: true,
      reflowText: true,  // Required for width to affect HR
      width: currentWidth - 2,  // Account for paddingX={1} in Messages.tsx
    })
  );
}

// Enable GFM for task lists, tables, etc.
marked.use({ gfm: true });

// Initial configuration
ensureMarkedConfigured();

/**
 * Pre-process markdown to fix rendering issues:
 * 1. Convert GFM task checkboxes to unicode symbols to avoid duplication
 * 2. Convert tight lists to loose lists for proper inline markdown rendering
 */
function preprocessMarkdown(text: string): string {
  // Convert GFM task list checkboxes to unicode to avoid marked-terminal duplication bug
  // - [ ] -> - ☐  and  - [x] or - [X] -> - ✓
  let processed = text.replace(/^(\s*[-*])\s*\[\s*\]/gm, '$1 ☐');
  processed = processed.replace(/^(\s*[-*])\s*\[[xX]\]/gm, '$1 ✓');

  // Convert tight lists to loose lists by adding blank lines between items
  // This fixes inline markdown (bold, italic, etc.) not rendering in list items
  // Match consecutive list items and add blank line between them
  processed = processed.replace(/^(\s*[-*+]\s+.+)\n(?=\s*[-*+]\s+)/gm, '$1\n\n');

  return processed;
}

/**
 * Post-process rendered markdown to fix spacing issues.
 */
function postprocessMarkdown(text: string): string {
  // Process line by line
  const lines = text.split('\n');
  const filtered: string[] = [];
  let lastWasBlank = false;
  let lastWasListItem = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // Strip ANSI codes to check content
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
    const trimmed = stripped.trim();
    const isBlank = trimmed === '';
    const isListItem = /^\s*\*\s/.test(stripped);

    // Check if next non-blank line is a list item
    let nextIsListItem = false;
    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j] ?? '';
      const nextStripped = nextLine.replace(/\x1b\[[0-9;]*m/g, '');
      if (nextStripped.trim() !== '') {
        nextIsListItem = /^\s*\*\s/.test(nextStripped);
        break;
      }
    }

    if (isBlank) {
      // Skip blank lines between list items
      if (lastWasListItem && nextIsListItem) {
        continue;
      }
      // Only keep one consecutive blank line
      if (!lastWasBlank) {
        filtered.push('');
        lastWasBlank = true;
      }
    } else {
      filtered.push(line);
      lastWasBlank = false;
      lastWasListItem = isListItem;
    }
  }

  return filtered.join('\n');
}

/**
 * Render markdown text for terminal display (with caching).
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';

  // Ensure marked is configured for current terminal width
  ensureMarkedConfigured();

  const cached = getCachedMarkdown(text);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const processed = preprocessMarkdown(text);
    const rendered = marked.parse(processed, { async: false }) as string;
    const result = postprocessMarkdown(rendered.replace(/\n+$/, ''));
    setCachedMarkdown(text, result);
    return result;
  } catch {
    return text;
  }
}

/**
 * Render markdown with async Shiki code block highlighting.
 * Pre-highlights code blocks, injects them, then renders.
 */
export async function renderMarkdownAsync(text: string): Promise<string> {
  if (!text) return '';

  // Ensure marked is configured for current terminal width
  ensureMarkedConfigured();

  // Prepare code block highlighting
  await prepareCodeBlocks(text);

  // Inject highlighted code blocks into the markdown
  let processedText = injectHighlightedCodeBlocks(text);

  // Apply general markdown preprocessing
  processedText = preprocessMarkdown(processedText);

  // Clear cache entry to force re-render with highlighted code
  markdownCache.delete(text);
  markdownCache.delete(processedText);

  try {
    const rendered = marked.parse(processedText, { async: false }) as string;
    const result = postprocessMarkdown(rendered.replace(/\n+$/, ''));
    // Cache with original text key
    setCachedMarkdown(text, result);
    return result;
  } catch {
    return text;
  }
}

/**
 * Render inline markdown (no block elements)
 */
export function renderInlineMarkdown(text: string): string {
  if (!text) return '';

  try {
    const rendered = marked.parseInline(text, { async: false }) as string;
    return rendered;
  } catch {
    return text;
  }
}

/**
 * Truncate text with ellipsis, preserving word boundaries
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const truncated = text.slice(0, maxLength - 3);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.7) {
    return truncated.slice(0, lastSpace) + '...';
  }

  return truncated + '...';
}

/**
 * Format a duration in ms to human readable
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

/**
 * Format token count
 */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1000000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1000000).toFixed(2)}M`;
}
