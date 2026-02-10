/**
 * Dynamic API Tool Factory
 *
 * Creates a single flexible MCP tool per API configuration.
 * Each tool accepts { path, method, params } and auto-injects authentication.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ApiConfig } from './types.ts';
import { debug } from '../utils/debug.ts';
import { handleLargeResponse, estimateTokens, TOKEN_LIMIT } from '../utils/large-response.ts';
import type { ApiCredential, BasicAuthCredential } from './credential-manager.ts';
import { isMultiHeaderCredential } from './credential-manager.ts';

// Maximum file size for binary downloads (500MB)
// Prevents memory exhaustion from malicious or unexpectedly large API responses
const MAX_DOWNLOAD_SIZE = 500 * 1024 * 1024;

// Re-export for convenience
export type { ApiCredential, BasicAuthCredential } from './credential-manager.ts';

/**
 * Build an Authorization header value for bearer-style authentication.
 *
 * Supports three cases:
 * - `authScheme: undefined` → defaults to "Bearer {token}"
 * - `authScheme: "Token"` → "Token {token}" (custom prefix)
 * - `authScheme: ""` → "{token}" (no prefix, for APIs that expect raw tokens)
 *
 * The empty string case is needed for APIs like some GraphQL endpoints or
 * internal services that expect the raw JWT/token without a "Bearer" prefix.
 *
 * @param authScheme - The auth scheme prefix (undefined defaults to "Bearer", empty string means no prefix)
 * @param token - The authentication token
 * @returns The full Authorization header value
 */
export function buildAuthorizationHeader(authScheme: string | undefined, token: string): string {
  // Use nullish coalescing (??) so empty string "" is preserved, only undefined/null falls back to 'Bearer'
  const scheme = authScheme ?? 'Bearer';
  // If scheme is empty string, return just the token; otherwise prefix with scheme
  return scheme ? `${scheme} ${token}` : token;
}

/**
 * API credential source - can be a static credential or a function that returns a token.
 * Token getter functions are used for OAuth sources that need auto-refresh.
 */
export type ApiCredentialSource = ApiCredential | (() => Promise<string>);

/**
 * Type guard to check if credential is BasicAuthCredential
 */
function isBasicAuthCredential(cred: ApiCredential): cred is BasicAuthCredential {
  return typeof cred === 'object' && cred !== null && 'username' in cred && 'password' in cred;
}

/**
 * Type guard to check if credential source is a token getter function
 */
function isTokenGetter(cred: ApiCredentialSource): cred is () => Promise<string> {
  return typeof cred === 'function';
}

/** Summarize callback type — typically agent.runMiniCompletion.bind(agent) */
export type SummarizeCallback = (prompt: string) => Promise<string | null>;


// ============================================================
// Binary Response Detection and Handling
// ============================================================

/**
 * Text MIME types that should be processed as text.
 * We whitelist text types because they're finite and well-defined.
 * Everything else is treated as binary - this is future-proof since
 * new binary types (application/vnd.x-whatever) automatically work.
 */
const TEXT_MIME_TYPES = [
  'text/',                    // text/plain, text/html, text/css, etc.
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'application/x-www-form-urlencoded',
  'application/ld+json',      // JSON-LD
  'application/graphql',
  'application/x-yaml',
  'application/yaml',
];

/**
 * Check if a Content-Type indicates text content.
 * Returns true for text types, false for binary.
 * If no Content-Type, defaults to true (safer for APIs that typically return JSON).
 */
function isTextContentType(contentType: string | null): boolean {
  if (!contentType) return true; // Assume text if unknown (safer for APIs)

  const normalized = (contentType.toLowerCase().split(';')[0] ?? '').trim();

  // Handle +json, +xml suffixes (application/vnd.api+json, image/svg+xml)
  if (normalized.endsWith('+json') || normalized.endsWith('+xml')) {
    return true;
  }

  return TEXT_MIME_TYPES.some(t =>
    t.endsWith('/') ? normalized.startsWith(t) : normalized === t
  );
}

/**
 * Inspect buffer contents to detect binary data.
 * Used as fallback when Content-Type is missing or ambiguous.
 * Checks for null bytes and high ratio of non-printable characters.
 *
 * UTF-8 handling: We skip ALL bytes >= 0x80 (multibyte sequences) to avoid
 * misclassifying international text (accented chars, emojis, CJK) as binary.
 * Only ASCII bytes (0x00-0x7F) are analyzed for printability.
 */
function looksLikeBinary(buffer: Buffer): boolean {
  // Check first 8KB for binary indicators
  const sample = buffer.slice(0, 8192);

  // Null bytes are a dead giveaway for binary
  if (sample.includes(0x00)) return true;

  // Count non-printable ASCII characters (skip UTF-8 multibyte entirely)
  let nonPrintable = 0;
  let asciiCount = 0;
  for (const byte of sample) {
    // Skip UTF-8 multibyte sequences (both leading and continuation bytes)
    // This ensures files with non-ASCII text aren't misclassified as binary
    if (byte >= 0x80) continue;

    asciiCount++;
    // Check if ASCII byte is non-printable (excluding common whitespace)
    if (byte < 0x09 || (byte > 0x0D && byte < 0x20)) {
      nonPrintable++;
    }
  }

  // If >10% of ASCII bytes are non-printable, likely binary
  // Use asciiCount as denominator to avoid false positives on UTF-8 heavy files
  return asciiCount > 0 && (nonPrintable / asciiCount) > 0.10;
}

/**
 * MIME type to file extension mapping for binary downloads.
 * Used when extracting filename from Content-Type.
 */
const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/gzip': '.gz',
  'application/x-gzip': '.gz',
  'application/x-tar': '.tar',
  'application/x-rar-compressed': '.rar',
  'application/x-7z-compressed': '.7z',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/octet-stream': '.bin',
};

/**
 * Magic bytes (file signatures) for common binary formats.
 * Used to detect file type when MIME type is unknown or generic.
 * Each entry has the byte sequence to match and the resulting extension.
 */
const MAGIC_SIGNATURES: Array<{ bytes: number[]; ext: string }> = [
  { bytes: [0x25, 0x50, 0x44, 0x46], ext: '.pdf' },           // %PDF
  { bytes: [0x89, 0x50, 0x4E, 0x47], ext: '.png' },           // .PNG
  { bytes: [0xFF, 0xD8, 0xFF], ext: '.jpg' },                  // JPEG
  { bytes: [0x47, 0x49, 0x46, 0x38], ext: '.gif' },           // GIF8
  { bytes: [0x50, 0x4B, 0x03, 0x04], ext: '.zip' },           // PK.. (also docx, xlsx, pptx)
  { bytes: [0x52, 0x61, 0x72, 0x21], ext: '.rar' },           // Rar!
  { bytes: [0x1F, 0x8B], ext: '.gz' },                         // gzip
  { bytes: [0x42, 0x4D], ext: '.bmp' },                        // BM
  { bytes: [0x49, 0x44, 0x33], ext: '.mp3' },                  // ID3 (MP3 with ID3 tag)
  { bytes: [0xFF, 0xFB], ext: '.mp3' },                        // MP3 frame sync
  { bytes: [0x52, 0x49, 0x46, 0x46], ext: '.wav' },           // RIFF (WAV container)
  { bytes: [0x4F, 0x67, 0x67, 0x53], ext: '.ogg' },           // OggS
  { bytes: [0x66, 0x4C, 0x61, 0x43], ext: '.flac' },          // fLaC
];

/**
 * Detect file extension from magic bytes (file signature).
 * Inspects first bytes of buffer to identify common file formats.
 * Returns extension with dot (e.g., '.pdf') or empty string if unknown.
 */
function detectExtensionFromMagic(buffer: Buffer): string {
  if (buffer.length < 8) return '';

  for (const sig of MAGIC_SIGNATURES) {
    if (sig.bytes.every((byte, i) => buffer[i] === byte)) {
      return sig.ext;
    }
  }
  return '';
}

/**
 * Get file extension from MIME type, with optional magic byte fallback.
 * First tries MIME type mapping, then falls back to buffer inspection.
 */
function getMimeExtension(mimeType: string | null, buffer?: Buffer): string {
  // First try MIME type mapping (fastest)
  if (mimeType) {
    const normalized = (mimeType.toLowerCase().split(';')[0] ?? '').trim();
    const ext = MIME_TO_EXT[normalized];
    if (ext && ext !== '.bin') return ext; // Don't use .bin from MIME, let magic detect
  }

  // Fallback to magic byte detection
  if (buffer) {
    return detectExtensionFromMagic(buffer);
  }

  return '';
}

/**
 * Sanitize filename by removing unsafe characters.
 */
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[/\\:*?"<>|]/g, '_') // Replace unsafe chars with underscore
    .replace(/\s+/g, '_')          // Replace whitespace with underscore
    .replace(/_+/g, '_')           // Collapse multiple underscores
    .replace(/^_|_$/g, '')         // Trim leading/trailing underscores
    .slice(0, 200);                // Limit length
}

/**
 * Extract filename from response headers or URL path.
 * Priority: Content-Disposition > URL path > generated name (with magic byte detection)
 *
 * @param buffer - Optional buffer for magic byte detection when mime type is unknown
 */
function extractFilename(
  response: Response,
  apiPath: string,
  mimeType: string | null,
  buffer?: Buffer
): string {
  // Priority 1: Content-Disposition header
  const disposition = response.headers.get('content-disposition');
  if (disposition) {
    // Handle both filename="name" and filename*=UTF-8''name formats
    const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i);
    if (match && match[1]) {
      const decoded = decodeURIComponent(match[1]);
      return sanitizeFilename(decoded);
    }
  }

  // Priority 2: URL path - extract filename if it has an extension
  const urlPart = apiPath.split('/').pop()?.split('?')[0];
  if (urlPart && urlPart.includes('.')) {
    return sanitizeFilename(urlPart);
  }

  // Priority 3: Generate from timestamp + detected extension
  // Uses MIME type first, falls back to magic byte detection from buffer
  const ext = getMimeExtension(mimeType, buffer) || '.bin';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `download_${timestamp}${ext}`;
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}

/**
 * Binary download result returned to the agent.
 * Contains file metadata instead of content - agents can reference the file path.
 */
interface BinaryDownloadResult {
  type: 'file_download';
  path: string;
  filename: string;
  mimeType: string | null;
  size: number;
  sizeHuman: string;
}

/**
 * Error result returned when binary save fails.
 */
interface BinaryDownloadError {
  type: 'file_download_error';
  error: string;
}

/**
 * Save binary response to session's downloads folder.
 * Uses atomic file creation (O_EXCL) to prevent TOCTOU race conditions.
 * Returns structured metadata for the agent, or error if save fails.
 */
function saveBinaryResponse(
  sessionPath: string,
  filename: string,
  buffer: Buffer,
  mimeType: string | null
): BinaryDownloadResult | BinaryDownloadError {
  const downloadsDir = join(sessionPath, 'downloads');

  // Create downloads directory with error handling
  try {
    mkdirSync(downloadsDir, { recursive: true });
  } catch (err) {
    return {
      type: 'file_download_error',
      error: `Failed to create downloads directory: ${(err as Error).message}`,
    };
  }

  // Atomic file creation with collision handling
  // Uses 'wx' flag (O_CREAT | O_EXCL) which fails if file exists - no TOCTOU race
  let finalFilename = filename;
  let filePath = join(downloadsDir, finalFilename);
  let counter = 0;
  const maxAttempts = 100;

  while (counter < maxAttempts) {
    try {
      // 'wx' = exclusive creation, fails atomically if file exists
      writeFileSync(filePath, buffer, { flag: 'wx' });
      // Success - file was created
      return {
        type: 'file_download',
        path: filePath,
        filename: finalFilename,
        mimeType,
        size: buffer.length,
        sizeHuman: formatBytes(buffer.length),
      };
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'EEXIST') {
        // File exists - try next numbered filename
        counter++;
        const dotIdx = filename.lastIndexOf('.');
        if (dotIdx > 0) {
          const base = filename.slice(0, dotIdx);
          const ext = filename.slice(dotIdx);
          finalFilename = `${base}-${counter}${ext}`;
        } else {
          finalFilename = `${filename}-${counter}`;
        }
        filePath = join(downloadsDir, finalFilename);
      } else {
        // Other error (permissions, disk full, etc.)
        return {
          type: 'file_download_error',
          error: `Failed to save file: ${error.message}`,
        };
      }
    }
  }

  return {
    type: 'file_download_error',
    error: `Failed to save file after ${maxAttempts} attempts - too many collisions`,
  };
}

/**
 * Check if JSON response looks like a Gmail attachment (base64-wrapped binary).
 * Gmail attachments have format: { size: number, data: "base64string" }
 */
function isGmailAttachment(json: unknown): json is { size: number; data: string } {
  if (!json || typeof json !== 'object') return false;
  const obj = json as Record<string, unknown>;
  return (
    typeof obj.data === 'string' &&
    typeof obj.size === 'number' &&
    obj.data.length > 100 // Real attachments have substantial base64 data
  );
}


/**
 * Build headers for an API request, injecting authentication and default headers
 */
export function buildHeaders(
  auth: ApiConfig['auth'],
  credential: ApiCredential,
  defaultHeaders?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Merge default headers (e.g., beta feature flags)
    ...defaultHeaders,
  };

  // No auth needed for type='none' or missing auth
  if (!auth || auth.type === 'none') {
    return headers;
  }

  // Basic auth requires username:password credential
  if (auth.type === 'basic') {
    if (isBasicAuthCredential(credential)) {
      const encoded = Buffer.from(`${credential.username}:${credential.password}`).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
    }
    return headers;
  }

  // Handle header auth (supports both single and multi-header)
  if (auth.type === 'header') {
    // Multi-header: credential is { headerName: value, ... }
    if (isMultiHeaderCredential(credential)) {
      Object.assign(headers, credential);
    }
    // Single header: existing behavior
    else if (typeof credential === 'string' && credential) {
      headers[auth.headerName || 'x-api-key'] = credential;
    }
    return headers;
  }

  // Other types use string credential (API key/token)
  const apiKey = typeof credential === 'string' ? credential : '';
  if (!apiKey) {
    return headers;
  }

  if (auth.type === 'bearer') {
    headers['Authorization'] = buildAuthorizationHeader(auth.authScheme, apiKey);
  }
  // Query type is handled in buildUrl

  return headers;
}

/**
 * Build the full URL for an API request
 */
function buildUrl(
  baseUrl: string,
  path: string,
  method: string,
  params: Record<string, unknown> | undefined,
  auth: ApiConfig['auth'],
  credential: ApiCredential
): string {
  // Normalize: remove trailing slash from baseUrl and ensure path starts with /
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  let url = `${normalizedBase}${normalizedPath}`;

  // Handle query param auth (only for string credentials)
  const apiKey = typeof credential === 'string' ? credential : '';
  if (auth?.type === 'query' && auth.queryParam && apiKey) {
    const separator = url.includes('?') ? '&' : '?';
    url += `${separator}${auth.queryParam}=${encodeURIComponent(apiKey)}`;
  }

  // Handle GET params in query string
  if (method === 'GET' && params && Object.keys(params).length > 0) {
    const urlParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        // Handle arrays and objects
        if (typeof value === 'object') {
          urlParams.append(key, JSON.stringify(value));
        } else {
          urlParams.append(key, String(value));
        }
      }
    }
    const queryString = urlParams.toString();
    if (queryString) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}${queryString}`;
    }
  }

  return url;
}

/**
 * Build tool description from API config
 */
function buildToolDescription(config: ApiConfig): string {
  let desc = `Make authenticated requests to ${config.name} API (${config.baseUrl})\n\n`;
  desc += `Authentication is handled automatically - just specify path, method, and params.\n\n`;

  // Check for old cache format (no documentation field)
  if (!config.documentation) {
    desc += `⚠️ This API was cached with an older format. You can still make requests but you'll need to figure out the endpoints yourself.`;
    return desc;
  }

  // Include the rich documentation extracted from the agent definition
  desc += config.documentation;

  if (config.docsUrl) {
    desc += `\n\nOfficial docs: ${config.docsUrl}`;
  }

  // Inform agent about binary file handling
  desc += `\n\n**Binary Files:** Binary responses (PDFs, images, archives, etc.) are automatically saved to the session downloads folder. You'll receive: { type: "file_download", path, filename, mimeType, size, sizeHuman }. Reference the path when telling users about downloaded files.`;

  return desc;
}

/**
 * Create a single flexible MCP tool for an API configuration.
 * The tool accepts { path, method, params } and handles auth automatically.
 *
 * @param config - API configuration with documentation
 * @param credential - API credential source (string for API key/token, BasicAuthCredential for basic auth,
 *                     empty string for public APIs, or async function for OAuth token refresh)
 * @param sessionPath - Optional path to session folder for saving large responses
 * @returns SDK tool that can be included in an MCP server
 */
export function createApiTool(
  config: ApiConfig,
  credential: ApiCredentialSource,
  sessionPath?: string,
  summarize?: SummarizeCallback
) {
  const toolName = `api_${config.name}`;
  debug(`[api-tools] Creating flexible tool: ${toolName}`);

  const description = buildToolDescription(config);

  return tool(
    toolName,
    description,
    {
      path: z.string().describe('API endpoint path, e.g., "/search" or "/v1/completions"'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('HTTP method - check documentation for correct method per endpoint'),
      params: z.record(z.string(), z.unknown()).optional().describe('Request body (POST/PUT/PATCH) or query parameters (GET)'),
      _intent: z.string().optional().describe('REQUIRED: Describe what you are trying to accomplish with this API call (1-2 sentences)'),
    },
    async (args) => {
      const { path, method, params, _intent } = args;

      try {
        // Resolve credential - if it's a token getter function, call it to get fresh token
        const resolvedCredential: ApiCredential = isTokenGetter(credential)
          ? await credential()
          : credential;

        const url = buildUrl(config.baseUrl, path, method, params, config.auth, resolvedCredential);
        const headers = buildHeaders(config.auth, resolvedCredential, config.defaultHeaders);

        debug(`[api-tools] ${config.name}: ${method} ${url}`);

        const fetchOptions: RequestInit = {
          method,
          headers,
        };

        // Add body for non-GET requests
        if (method !== 'GET' && params && Object.keys(params).length > 0) {
          fetchOptions.body = JSON.stringify(params);
        }

        const response = await fetch(url, fetchOptions);

        // ============================================================
        // Binary Detection: Check Content-Type and handle binary responses
        // ============================================================
        const contentType = response.headers.get('content-type');

        // Memory safety: Check Content-Length before loading response into memory
        // This prevents OOM crashes from malicious or unexpectedly large responses
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
          const size = parseInt(contentLength, 10);
          if (!isNaN(size) && size > MAX_DOWNLOAD_SIZE) {
            return {
              content: [{
                type: 'text' as const,
                text: `Response too large: ${formatBytes(size)} exceeds ${formatBytes(MAX_DOWNLOAD_SIZE)} limit. Use a streaming download tool for large files.`,
              }],
              isError: true,
            };
          }
        }

        // Step 1: If Content-Type clearly indicates binary, save directly to disk
        // This skips text processing entirely for PDFs, images, etc.
        if (contentType && !isTextContentType(contentType) && sessionPath) {
          debug(`[api-tools] ${config.name}: Binary content-type detected: ${contentType}`);
          const buffer = Buffer.from(await response.arrayBuffer());
          const filename = extractFilename(response, path, contentType, buffer);
          const result = saveBinaryResponse(sessionPath, filename, buffer, contentType);
          if (result.type === 'file_download_error') {
            return {
              content: [{ type: 'text' as const, text: result.error }],
              isError: true,
            };
          }
          debug(`[api-tools] ${config.name}: Binary file saved: ${result.path} (${result.sizeHuman})`);
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            }],
          };
        }

        // Step 2: For text types or unknown, get content as buffer first
        // This allows us to inspect for binary content even if Content-Type is wrong
        const buffer = Buffer.from(await response.arrayBuffer());

        // Step 3: Content inspection fallback for ambiguous cases
        // If Content-Type was missing/text but content looks binary, save as file
        if (sessionPath && looksLikeBinary(buffer)) {
          debug(`[api-tools] ${config.name}: Binary content detected via inspection`);
          const filename = extractFilename(response, path, contentType, buffer);
          const result = saveBinaryResponse(sessionPath, filename, buffer, contentType);
          if (result.type === 'file_download_error') {
            return {
              content: [{ type: 'text' as const, text: result.error }],
              isError: true,
            };
          }
          debug(`[api-tools] ${config.name}: Binary file saved: ${result.path} (${result.sizeHuman})`);
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            }],
          };
        }

        // Step 4: It's text - convert to string and continue with normal flow
        const text = buffer.toString('utf-8');

        // Check for error responses
        if (!response.ok) {
          debug(`[api-tools] ${config.name} error ${response.status}: ${text.substring(0, 200)}`);
          return {
            content: [{
              type: 'text' as const,
              text: `API Error ${response.status}: ${text}`,
            }],
            isError: true,
          };
        }

        // Step 5: Check for Gmail-style base64-wrapped binary attachments
        // Gmail attachments return JSON like: { size: 31934, data: "JVBERi0xLjQ..." }
        if (sessionPath && contentType?.includes('application/json')) {
          try {
            const json = JSON.parse(text);
            if (isGmailAttachment(json)) {
              const decoded = Buffer.from(json.data, 'base64');
              // Verify size roughly matches (allow small variance for padding)
              if (decoded.length > 0 && Math.abs(decoded.length - json.size) < 100) {
                debug(`[api-tools] ${config.name}: Gmail attachment detected, decoding base64`);
                // Pass decoded buffer for magic byte detection since Gmail doesn't provide mime type
                const filename = extractFilename(response, path, null, decoded);
                const result = saveBinaryResponse(sessionPath, filename, decoded, null);
                if (result.type === 'file_download_error') {
                  return {
                    content: [{ type: 'text' as const, text: result.error }],
                    isError: true,
                  };
                }
                debug(`[api-tools] ${config.name}: Gmail attachment saved: ${result.path} (${result.sizeHuman})`);
                return {
                  content: [{
                    type: 'text' as const,
                    text: JSON.stringify(result, null, 2),
                  }],
                };
              }
            }
          } catch {
            // Not valid JSON or not attachment format - continue with normal flow
          }
        }

        // ============================================================
        // Text Response Handling (existing flow)
        // ============================================================

        // Handle large responses: save to disk + summarize + format
        if (sessionPath && estimateTokens(text) > TOKEN_LIMIT) {
          const result = await handleLargeResponse({
            text,
            sessionPath,
            context: {
              toolName: `api_${config.name}`,
              path,
              input: params,
              intent: _intent,
            },
            summarize,
          });

          if (result) {
            return {
              content: [{ type: 'text' as const, text: result.message }],
            };
          }
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        debug(`[api-tools] ${config.name} request failed: ${message}`);
        return {
          content: [{ type: 'text' as const, text: `Request failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create an in-process MCP server with a single flexible API tool.
 *
 * @param config - API configuration
 * @param credential - API credential source (string for API key/token, BasicAuthCredential for basic auth,
 *                     empty string for public APIs, or async function for OAuth token refresh)
 * @param sessionPath - Optional path to session folder for saving large responses
 * @returns SDK MCP server that can be passed to query()
 */
export function createApiServer(
  config: ApiConfig,
  credential: ApiCredentialSource,
  sessionPath?: string,
  summarize?: SummarizeCallback
): ReturnType<typeof createSdkMcpServer> {
  debug(`[api-tools] Creating server for ${config.name}${sessionPath ? ` (session: ${sessionPath})` : ''}`);

  const apiTool = createApiTool(config, credential, sessionPath, summarize);

  return createSdkMcpServer({
    name: `api_${config.name}`,
    version: '1.0.0',
    tools: [apiTool],
  });
}
