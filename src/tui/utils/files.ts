import { existsSync, readFileSync, statSync, writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { extname, basename, resolve, join } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

export interface FileAttachment {
  type: 'image' | 'text' | 'pdf' | 'unknown';
  path: string;
  name: string;
  mimeType: string;
  base64?: string;
  text?: string;
  size: number;
}

// Supported image types for Claude API
const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// Text file extensions
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h',
  '.css', '.scss', '.html', '.xml', '.yaml', '.yml', '.toml',
  '.sh', '.bash', '.zsh', '.fish', '.sql', '.graphql',
  '.env', '.gitignore', '.dockerfile', '.makefile',
  '.csv', '.log', '.conf', '.ini', '.cfg',
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB limit
const MAX_TEXT_SIZE = 100 * 1024; // 100KB for text files

/**
 * Extract file paths from input text
 * Handles:
 * - Absolute paths (/path/to/file)
 * - Home-relative paths (~/path/to/file)
 * - Quoted paths ("path with spaces")
 * - Multiple paths on the same line
 */
export function extractFilePaths(input: string): string[] {
  const paths: string[] = [];

  // Match quoted paths first
  const quotedRegex = /["']([^"']+)["']/g;
  let match;
  while ((match = quotedRegex.exec(input)) !== null) {
    const path = match[1];
    if (path && looksLikeFilePath(path)) {
      paths.push(path);
    }
  }

  // Match unquoted paths (starting with / or ~)
  const unquotedRegex = /(?:^|\s)((?:\/|~\/)[^\s"']+)/g;
  while ((match = unquotedRegex.exec(input)) !== null) {
    const path = match[1];
    if (path && !paths.includes(path)) {
      paths.push(path);
    }
  }

  return paths;
}

/**
 * Check if a string looks like a file path
 */
function looksLikeFilePath(str: string): boolean {
  // Must start with / or ~/
  if (!str.startsWith('/') && !str.startsWith('~/')) {
    return false;
  }
  // Must have some content after the prefix
  if (str.length < 2) {
    return false;
  }
  // Should have a file extension or be a directory
  return true;
}

/**
 * Resolve a path (handle ~ expansion)
 */
export function resolvePath(filePath: string): string {
  if (filePath.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return resolve(home, filePath.slice(2));
  }
  return resolve(filePath);
}

/**
 * Determine the type of a file based on extension
 */
export function getFileType(filePath: string): 'image' | 'text' | 'pdf' | 'unknown' {
  const ext = extname(filePath).toLowerCase();

  if (ext in IMAGE_EXTENSIONS) {
    return 'image';
  }
  if (ext === '.pdf') {
    return 'pdf';
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return 'text';
  }

  return 'unknown';
}

/**
 * Get MIME type for a file
 */
export function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();

  const imageMime = IMAGE_EXTENSIONS[ext];
  if (imageMime) {
    return imageMime;
  }
  if (ext === '.pdf') {
    return 'application/pdf';
  }

  // Default to text for known text extensions
  if (TEXT_EXTENSIONS.has(ext)) {
    return 'text/plain';
  }

  return 'application/octet-stream';
}

/**
 * Read a file and return attachment info
 */
export function readFileAttachment(filePath: string): FileAttachment | null {
  try {
    const resolved = resolvePath(filePath);

    if (!existsSync(resolved)) {
      return null;
    }

    const stats = statSync(resolved);

    if (!stats.isFile()) {
      return null;
    }

    if (stats.size > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${basename(resolved)} (${Math.round(stats.size / 1024 / 1024)}MB > 20MB limit)`);
    }

    const type = getFileType(resolved);
    const mimeType = getMimeType(resolved);
    const name = basename(resolved);

    const attachment: FileAttachment = {
      type,
      path: resolved,
      name,
      mimeType,
      size: stats.size,
    };

    if (type === 'image') {
      // Read as base64 for images
      const buffer = readFileSync(resolved);
      attachment.base64 = buffer.toString('base64');
    } else if (type === 'text') {
      // Read as text for text files (with size limit)
      if (stats.size > MAX_TEXT_SIZE) {
        // Read only first part of large text files
        const buffer = readFileSync(resolved);
        attachment.text = buffer.toString('utf-8').slice(0, MAX_TEXT_SIZE) +
          `\n\n[File truncated - showing first ${MAX_TEXT_SIZE / 1024}KB of ${Math.round(stats.size / 1024)}KB]`;
      } else {
        attachment.text = readFileSync(resolved, 'utf-8');
      }
    } else if (type === 'pdf') {
      // Read PDF as base64
      const buffer = readFileSync(resolved);
      attachment.base64 = buffer.toString('base64');
    }

    return attachment;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('File too large')) {
      throw error;
    }
    return null;
  }
}

/**
 * Process input text and extract any file attachments
 * Returns the cleaned text and any file attachments
 */
export function processInputWithFiles(input: string): {
  text: string;
  attachments: FileAttachment[];
  errors: string[];
} {
  const paths = extractFilePaths(input);
  const attachments: FileAttachment[] = [];
  const errors: string[] = [];

  // Process each path
  for (const path of paths) {
    try {
      const attachment = readFileAttachment(path);
      if (attachment) {
        attachments.push(attachment);
      } else {
        // File doesn't exist - might just be text that looks like a path
      }
    } catch (error) {
      if (error instanceof Error) {
        errors.push(error.message);
      }
    }
  }

  // Remove successfully attached file paths from the text
  let cleanedText = input;
  for (const attachment of attachments) {
    // Remove the path from the text (both quoted and unquoted forms)
    cleanedText = cleanedText.replace(`"${attachment.path}"`, '');
    cleanedText = cleanedText.replace(`'${attachment.path}'`, '');
    cleanedText = cleanedText.replace(attachment.path, '');

    // Also try with original path (before resolution)
    const originalPath = paths.find(p => resolvePath(p) === attachment.path);
    if (originalPath && originalPath !== attachment.path) {
      cleanedText = cleanedText.replace(`"${originalPath}"`, '');
      cleanedText = cleanedText.replace(`'${originalPath}'`, '');
      cleanedText = cleanedText.replace(originalPath, '');
    }
  }

  // Clean up extra whitespace
  cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

  return { text: cleanedText, attachments, errors };
}

/**
 * Format attachment info for display
 */
export function formatAttachmentDisplay(attachment: FileAttachment): string {
  const sizeStr = attachment.size < 1024
    ? `${attachment.size}B`
    : attachment.size < 1024 * 1024
    ? `${Math.round(attachment.size / 1024)}KB`
    : `${(attachment.size / 1024 / 1024).toFixed(1)}MB`;

  const icon = attachment.type === 'image' ? '🖼'
    : attachment.type === 'pdf' ? '📄'
    : attachment.type === 'text' ? '📝'
    : '📎';

  return `${icon} ${attachment.name} (${sizeStr})`;
}

/**
 * Read from clipboard (macOS only)
 * Checks for: 1) File URLs (copied files), 2) Images
 * Returns FileAttachment[] - could be multiple files
 */
export function readClipboard(): FileAttachment[] {
  if (process.platform !== 'darwin') {
    return [];
  }

  const attachments: FileAttachment[] = [];

  // First, check for file URLs in clipboard (when files are copied in Finder)
  try {
    const scriptFile = join(tmpdir(), `craft-clipboard-files-${Date.now()}.js`);
    const jxaScript = `
ObjC.import('AppKit');
ObjC.import('Foundation');

var pb = $.NSPasteboard.generalPasteboard;

// Check for file URLs
var fileURLs = pb.propertyListForType($.NSFilenamesPboardType);
if (fileURLs && !fileURLs.isNil()) {
  var paths = ObjC.deepUnwrap(fileURLs);
  if (Array.isArray(paths) && paths.length > 0) {
    JSON.stringify({ type: 'files', paths: paths });
  } else {
    "no_files";
  }
} else {
  "no_files";
}
`;
    writeFileSync(scriptFile, jxaScript);

    const result = execSync(`osascript -l JavaScript "${scriptFile}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
    }).trim();

    try { unlinkSync(scriptFile); } catch {}

    if (result !== 'no_files' && result.startsWith('{')) {
      const parsed = JSON.parse(result);
      if (parsed.type === 'files' && Array.isArray(parsed.paths)) {
        for (const filePath of parsed.paths) {
          const attachment = readFileAttachment(filePath);
          if (attachment) {
            attachments.push(attachment);
          }
        }
      }
    }
  } catch {
    // File URL reading failed
  }

  // If we got files, return them
  if (attachments.length > 0) {
    return attachments;
  }

  // Otherwise, check for image data in clipboard
  const imageAttachment = readClipboardImageData();
  if (imageAttachment) {
    return [imageAttachment];
  }

  return [];
}

/**
 * Read image data directly from clipboard (for screenshots, copied images)
 */
function readClipboardImageData(): FileAttachment | null {
  const tempFile = join(tmpdir(), `craft-clipboard-${Date.now()}.png`);

  // Method 1: Try pngpaste first (most reliable if installed via: brew install pngpaste)
  try {
    execSync(`pngpaste "${tempFile}" 2>/dev/null`, { stdio: 'pipe' });
    if (existsSync(tempFile)) {
      const result = readImageFile(tempFile);
      if (result) return result;
    }
  } catch {
    // pngpaste not available or failed
  }

  // Method 2: Use osascript with JXA (JavaScript for Automation)
  try {
    const scriptFile = join(tmpdir(), `craft-clipboard-script-${Date.now()}.js`);
    const jxaScript = `
ObjC.import('AppKit');
ObjC.import('Foundation');

var pb = $.NSPasteboard.generalPasteboard;

// Try PNG first
var imgData = pb.dataForType($.NSPasteboardTypePNG);

// If no PNG, try TIFF
if (!imgData || imgData.isNil()) {
  imgData = pb.dataForType($.NSPasteboardTypeTIFF);
}

if (imgData && !imgData.isNil()) {
  var path = $.NSString.stringWithString("${tempFile}");
  var success = imgData.writeToFileAtomically(path, true);
  success ? "success" : "write_failed";
} else {
  "no_image";
}
`;
    writeFileSync(scriptFile, jxaScript);

    const result = execSync(`osascript -l JavaScript "${scriptFile}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
    }).trim();

    try { unlinkSync(scriptFile); } catch {}

    if (result === 'success' && existsSync(tempFile)) {
      const imageResult = readImageFile(tempFile);
      if (imageResult) return imageResult;
    }
  } catch {
    // JXA method failed
  }

  return null;
}

/**
 * Legacy function for backwards compatibility
 */
export function readClipboardImage(): FileAttachment | null {
  const attachments = readClipboard();
  // Return first image, or first file if no images
  return attachments.find(a => a.type === 'image') || attachments[0] || null;
}

/**
 * Helper to read image file and create attachment
 */
function readImageFile(tempFile: string): FileAttachment | null {
  try {
    const stats = statSync(tempFile);
    const buffer = readFileSync(tempFile);
    const base64 = buffer.toString('base64');

    // Clean up temp file
    try {
      unlinkSync(tempFile);
    } catch {
      // Ignore cleanup errors
    }

    return {
      type: 'image',
      path: 'clipboard',
      name: `clipboard-${Date.now()}.png`,
      mimeType: 'image/png',
      base64,
      size: stats.size,
    };
  } catch {
    return null;
  }
}
