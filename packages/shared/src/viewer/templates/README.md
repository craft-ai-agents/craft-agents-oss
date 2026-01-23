# Session HTML Template Generator

This module provides functionality to generate standalone HTML files for Vespr sessions.

## Features

- **Self-contained HTML**: All CSS is embedded, no external dependencies
- **XSS Protection**: All content is properly escaped to prevent security vulnerabilities
- **Responsive Design**: Works on mobile and desktop devices
- **Print-friendly**: Optimized for printing with proper page breaks
- **Rich Message Support**: Handles all message types including tools, errors, attachments

## Usage

```typescript
import { generateSessionHTML } from '@craft-agent/shared/viewer/templates';
import type { StoredSession } from '@craft-agent/core/types';

// Load or create a session
const session: StoredSession = {
  id: 'session-123',
  workspaceId: 'workspace-456',
  name: 'My Conversation',
  createdAt: Date.now(),
  lastUsedAt: Date.now(),
  messages: [
    {
      id: 'msg-1',
      type: 'user',
      content: 'Hello, can you help me with this task?',
      timestamp: Date.now(),
    },
    {
      id: 'msg-2',
      type: 'assistant',
      content: 'Of course! I\'d be happy to help you with that.',
      timestamp: Date.now(),
    },
  ],
  tokenUsage: {
    inputTokens: 150,
    outputTokens: 200,
    totalTokens: 350,
    contextTokens: 1000,
    costUsd: 0.0025,
  },
};

// Generate HTML
const html = generateSessionHTML(session);

// Save to file
await Bun.write('session-export.html', html);
```

## Message Types Supported

The template supports all Vespr message types with appropriate styling:

- **user**: User messages (blue)
- **assistant**: AI assistant responses (purple)
- **tool**: Tool executions with input/output (orange)
- **error**: Error messages with details (red)
- **system**: System messages (green)
- **status**: Status updates (green)
- **info**: Informational messages (green)
- **warning**: Warning messages (yellow)
- **plan**: Plan documents (teal)
- **auth-request**: Authentication requests (pink)

## Tool Messages

Tool messages display additional information:
- Tool name and display name
- Intent/description
- Input parameters (formatted JSON)
- Execution result
- Status (pending, executing, completed, error)
- Duration

## Error Messages

Error messages show:
- Error title
- Detailed error message
- Diagnostic details (bulleted list)
- Original error (if available)

## Attachments

Attachments are listed with:
- File name
- File type/MIME type
- Visual indicator in the message

## Security

The `escapeHtml()` function ensures all user content is properly escaped to prevent XSS attacks. Characters escaped:
- `&` → `&amp;`
- `<` → `&lt;`
- `>` → `&gt;`
- `"` → `&quot;`
- `'` → `&#39;`

## Styling

The template includes embedded CSS with:
- Professional color scheme matching Vespr's UI
- Gradient header
- Message-type-specific colors
- Code blocks with monospace font
- Hover effects
- Mobile-responsive layout
- Print-optimized styles

## Export Options

The generated HTML can be:
1. **Saved to disk**: Write directly to a `.html` file
2. **Uploaded to hosting**: Deploy to static hosting (S3, Netlify, etc.)
3. **Embedded**: Include in email or other documents
4. **Printed**: Use browser print functionality for PDF export

## Example Output

The generated HTML will look like:

```
┌─────────────────────────────────────────┐
│  Session Name                           │
│  Created: Jan 23, 2026, 6:20 PM        │
│  Messages: 15 | Workspace: main        │
├─────────────────────────────────────────┤
│  YOU                    6:20 PM         │
│  Hello, can you help me?                │
├─────────────────────────────────────────┤
│  ASSISTANT              6:20 PM         │
│  Of course! I'd be happy to help.       │
├─────────────────────────────────────────┤
│  Token Usage:                           │
│  Input: 1,234 | Output: 5,678          │
│  Total: 6,912 | Cost: $0.0123          │
└─────────────────────────────────────────┘
```

## API Reference

### `generateSessionHTML(session: StoredSession): string`

Generates a complete HTML document for a session.

**Parameters:**
- `session`: StoredSession - The session to render

**Returns:**
- `string` - Complete HTML document with embedded CSS

### `escapeHtml(text: string): string`

Escapes HTML special characters to prevent XSS.

**Parameters:**
- `text`: string - Text to escape

**Returns:**
- `string` - Escaped text safe for HTML insertion
