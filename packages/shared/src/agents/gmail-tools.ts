/**
 * Gmail MCP Server
 *
 * Creates an in-process MCP server providing Gmail API tools:
 * - gmail_list_messages: List emails with optional search query
 * - gmail_get_message: Get full email content by ID
 * - gmail_search: Search emails using Gmail syntax
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { debug } from '../utils/debug.ts';
import { estimateTokens, summarizeLargeResult, TOKEN_LIMIT } from '../utils/summarize.ts';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

/**
 * Token getter function - called before each request to get a fresh token
 * This allows token refresh during long-running sessions
 */
export type GmailTokenGetter = () => Promise<string>;

/**
 * Gmail message header
 */
interface GmailHeader {
  name: string;
  value: string;
}

/**
 * Gmail message part (for multipart messages)
 */
interface GmailMessagePart {
  mimeType: string;
  body?: {
    data?: string;
    size: number;
  };
  parts?: GmailMessagePart[];
  headers?: GmailHeader[];
}

/**
 * Gmail message from API
 */
interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    mimeType: string;
    headers?: GmailHeader[];
    body?: {
      data?: string;
      size: number;
    };
    parts?: GmailMessagePart[];
  };
  internalDate?: string;
}

/**
 * Gmail messages list response
 */
interface GmailMessagesListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/**
 * Decode base64url encoded string
 */
function decodeBase64Url(data: string): string {
  // Convert base64url to base64
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Extract header value from message
 */
function getHeader(headers: GmailHeader[] | undefined, name: string): string | undefined {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;
}

/**
 * Extract plain text body from message parts
 */
function extractTextBody(part: GmailMessagePart): string {
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }

  if (part.parts) {
    for (const subPart of part.parts) {
      const text = extractTextBody(subPart);
      if (text) return text;
    }
  }

  // Fall back to HTML if no plain text
  if (part.mimeType === 'text/html' && part.body?.data) {
    // Simple HTML to text conversion - strip tags
    const html = decodeBase64Url(part.body.data);
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return '';
}

/**
 * Format message for display
 */
function formatMessage(message: GmailMessage): string {
  const headers = message.payload?.headers;
  const from = getHeader(headers, 'From') || 'Unknown';
  const to = getHeader(headers, 'To') || '';
  const subject = getHeader(headers, 'Subject') || '(no subject)';
  const date = getHeader(headers, 'Date') || '';

  let body = '';
  if (message.payload) {
    if (message.payload.body?.data) {
      body = decodeBase64Url(message.payload.body.data);
    } else if (message.payload.parts) {
      body = extractTextBody(message.payload as GmailMessagePart);
    }
  }

  return `
From: ${from}
To: ${to}
Date: ${date}
Subject: ${subject}

${body || message.snippet || '(no content)'}
`.trim();
}

/**
 * Format message list item
 */
function formatMessageListItem(message: GmailMessage): string {
  const headers = message.payload?.headers;
  const from = getHeader(headers, 'From') || 'Unknown';
  const subject = getHeader(headers, 'Subject') || '(no subject)';
  const date = getHeader(headers, 'Date') || '';

  return `[${message.id}] ${date} | ${from} | ${subject}`;
}

/**
 * Create Gmail list messages tool
 */
function createListMessagesTool(getToken: GmailTokenGetter) {
  return tool(
    'gmail_list_messages',
    `List emails from Gmail inbox.

Use this to browse recent emails or search for specific messages.
Returns message IDs, subjects, senders, and snippets.

Common queries:
- Empty query: Get recent messages
- "from:someone@example.com": Messages from specific sender
- "subject:meeting": Messages with subject containing "meeting"
- "is:unread": Unread messages
- "has:attachment": Messages with attachments
- "after:2024/01/01": Messages after a date`,
    {
      query: z.string().optional().describe('Gmail search query (optional). Examples: "from:user@example.com", "is:unread", "subject:invoice"'),
      maxResults: z.number().min(1).max(100).optional().describe('Maximum number of messages to return (default: 10, max: 100)'),
      _intent: z.string().optional().describe('REQUIRED: Describe what you are looking for in these emails'),
    },
    async (args) => {
      const { query, maxResults = 10, _intent } = args;

      try {
        // Get fresh token for this request
        const accessToken = await getToken();

        // First, get message IDs
        const listUrl = new URL(`${GMAIL_API_BASE}/users/me/messages`);
        listUrl.searchParams.set('maxResults', String(maxResults));
        if (query) {
          listUrl.searchParams.set('q', query);
        }

        debug(`[gmail-tools] Listing messages: ${listUrl}`);

        const listResponse = await fetch(listUrl.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!listResponse.ok) {
          const error = await listResponse.text();
          return {
            content: [{ type: 'text' as const, text: `Gmail API error: ${error}` }],
            isError: true,
          };
        }

        const listData = await listResponse.json() as GmailMessagesListResponse;

        if (!listData.messages || listData.messages.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No messages found.' }],
          };
        }

        // Fetch metadata for each message
        const messages: GmailMessage[] = [];
        for (const msg of listData.messages) {
          const msgResponse = await fetch(
            `${GMAIL_API_BASE}/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );

          if (msgResponse.ok) {
            messages.push(await msgResponse.json() as GmailMessage);
          }
        }

        // Format output
        const output = messages.map(formatMessageListItem).join('\n');
        const resultText = `Found ${messages.length} messages:\n\n${output}`;

        // Check if response needs summarization
        const estimatedTokens = estimateTokens(resultText);
        if (estimatedTokens > TOKEN_LIMIT && _intent) {
          debug(`[gmail-tools] Response too large (~${estimatedTokens} tokens), summarizing...`);
          const summary = await summarizeLargeResult(resultText, {
            toolName: 'gmail_list_messages',
            input: { query, maxResults },
            modelIntent: _intent,
          });
          return {
            content: [{
              type: 'text' as const,
              text: `[Large response summarized]\n\n${summary}`,
            }],
          };
        }

        return { content: [{ type: 'text' as const, text: resultText }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Failed to list messages: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create Gmail get message tool
 */
function createGetMessageTool(getToken: GmailTokenGetter) {
  return tool(
    'gmail_get_message',
    `Get full email content by message ID.

Use this after listing messages to read the complete content of a specific email.
Returns the full email including headers, body, and metadata.`,
    {
      messageId: z.string().describe('Gmail message ID (from gmail_list_messages)'),
      _intent: z.string().optional().describe('REQUIRED: Describe what information you need from this email'),
    },
    async (args) => {
      const { messageId, _intent } = args;

      try {
        // Get fresh token for this request
        const accessToken = await getToken();

        debug(`[gmail-tools] Getting message: ${messageId}`);

        const response = await fetch(
          `${GMAIL_API_BASE}/users/me/messages/${messageId}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!response.ok) {
          const error = await response.text();
          return {
            content: [{ type: 'text' as const, text: `Gmail API error: ${error}` }],
            isError: true,
          };
        }

        const message = await response.json() as GmailMessage;
        const formatted = formatMessage(message);

        // Check if response needs summarization
        const estimatedTokens = estimateTokens(formatted);
        if (estimatedTokens > TOKEN_LIMIT && _intent) {
          debug(`[gmail-tools] Response too large (~${estimatedTokens} tokens), summarizing...`);
          const summary = await summarizeLargeResult(formatted, {
            toolName: 'gmail_get_message',
            input: { messageId },
            modelIntent: _intent,
          });
          return {
            content: [{
              type: 'text' as const,
              text: `[Long email summarized]\n\n${summary}`,
            }],
          };
        }

        return { content: [{ type: 'text' as const, text: formatted }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Failed to get message: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create Gmail search tool
 */
function createSearchTool(getToken: GmailTokenGetter) {
  return tool(
    'gmail_search',
    `Search emails using Gmail's powerful search syntax.

Search operators:
- from:sender - Messages from specific sender
- to:recipient - Messages to specific recipient
- subject:text - Messages with text in subject
- has:attachment - Messages with attachments
- filename:name - Messages with specific attachment filename
- is:unread / is:read - Unread/read messages
- is:starred - Starred messages
- is:important - Important messages
- label:name - Messages with specific label
- after:YYYY/MM/DD - Messages after date
- before:YYYY/MM/DD - Messages before date
- older_than:Xd / newer_than:Xd - Relative date (d=days, m=months, y=years)
- larger:Xm - Messages larger than X megabytes
- "exact phrase" - Exact phrase match

Combine operators: from:boss@company.com after:2024/01/01 has:attachment`,
    {
      query: z.string().describe('Gmail search query'),
      maxResults: z.number().min(1).max(50).optional().describe('Maximum results (default: 20)'),
      _intent: z.string().optional().describe('REQUIRED: Describe what you are searching for'),
    },
    async (args) => {
      const { query, maxResults = 20, _intent } = args;

      try {
        // Get fresh token for this request
        const accessToken = await getToken();

        const listUrl = new URL(`${GMAIL_API_BASE}/users/me/messages`);
        listUrl.searchParams.set('maxResults', String(maxResults));
        listUrl.searchParams.set('q', query);

        debug(`[gmail-tools] Searching: ${query}`);

        const listResponse = await fetch(listUrl.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!listResponse.ok) {
          const error = await listResponse.text();
          return {
            content: [{ type: 'text' as const, text: `Gmail API error: ${error}` }],
            isError: true,
          };
        }

        const listData = await listResponse.json() as GmailMessagesListResponse;

        if (!listData.messages || listData.messages.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No messages found for query: ${query}` }],
          };
        }

        // Fetch metadata for each message
        const messages: GmailMessage[] = [];
        for (const msg of listData.messages) {
          const msgResponse = await fetch(
            `${GMAIL_API_BASE}/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );

          if (msgResponse.ok) {
            messages.push(await msgResponse.json() as GmailMessage);
          }
        }

        // Format output
        const output = messages.map(formatMessageListItem).join('\n');
        const resultText = `Search results for "${query}" (${messages.length} messages):\n\n${output}`;

        // Check if response needs summarization
        const estimatedTokens = estimateTokens(resultText);
        if (estimatedTokens > TOKEN_LIMIT && _intent) {
          debug(`[gmail-tools] Response too large (~${estimatedTokens} tokens), summarizing...`);
          const summary = await summarizeLargeResult(resultText, {
            toolName: 'gmail_search',
            input: { query, maxResults },
            modelIntent: _intent,
          });
          return {
            content: [{
              type: 'text' as const,
              text: `[Large response summarized]\n\n${summary}`,
            }],
          };
        }

        return { content: [{ type: 'text' as const, text: resultText }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Search failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create an in-process MCP server with Gmail tools.
 *
 * @param getToken - Function that returns a fresh Gmail OAuth access token
 *                   Called before each request to support token refresh during long sessions
 * @returns SDK MCP server that can be passed to query()
 */
export function createGmailServer(getToken: GmailTokenGetter): ReturnType<typeof createSdkMcpServer> {
  debug('[gmail-tools] Creating Gmail MCP server');

  return createSdkMcpServer({
    name: 'gmail',
    version: '1.0.0',
    tools: [
      createListMessagesTool(getToken),
      createGetMessageTool(getToken),
      createSearchTool(getToken),
    ],
  });
}
