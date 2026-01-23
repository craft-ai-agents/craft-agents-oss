/**
 * HTML template generator for session exports
 * Generates standalone HTML files with embedded CSS for viewing sessions in any browser
 */

import type { StoredSession } from '../../sessions/types';

/**
 * Escape HTML special characters to prevent XSS attacks
 */
export function escapeHtml(text: string): string {
  const htmlEscapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  return text.replace(/[&<>"']/g, (char) => htmlEscapeMap[char] || char);
}

/**
 * Format a timestamp to a human-readable date string
 */
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format tool input as readable text
 */
function formatToolInput(input: Record<string, unknown> | undefined): string {
  if (!input) return '';

  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

/**
 * Render a single message block based on its type
 */
function renderMessageContent(message: StoredSession['messages'][number]): string {
  const role = message.type;
  const timestamp = message.timestamp ? formatDate(message.timestamp) : '';

  // Determine role label and styling
  let roleLabel = 'Unknown';
  let roleClass = 'role-unknown';

  switch (role) {
    case 'user':
      roleLabel = 'You';
      roleClass = 'role-user';
      break;
    case 'assistant':
      roleLabel = 'Assistant';
      roleClass = 'role-assistant';
      break;
    case 'tool':
      roleLabel = message.toolName || 'Tool';
      roleClass = 'role-tool';
      break;
    case 'error':
      roleLabel = 'Error';
      roleClass = 'role-error';
      break;
    case 'system':
      roleLabel = 'System';
      roleClass = 'role-system';
      break;
    case 'status':
      roleLabel = 'Status';
      roleClass = 'role-status';
      break;
    case 'info':
      roleLabel = 'Info';
      roleClass = 'role-info';
      break;
    case 'warning':
      roleLabel = 'Warning';
      roleClass = 'role-warning';
      break;
    case 'plan':
      roleLabel = 'Plan';
      roleClass = 'role-plan';
      break;
    case 'auth-request':
      roleLabel = 'Auth Request';
      roleClass = 'role-auth';
      break;
  }

  // Build content sections
  let contentHtml = '';

  // Main content
  if (message.content) {
    const escapedContent = escapeHtml(message.content);
    const formattedContent = escapedContent.replace(/\n/g, '<br>');
    contentHtml += `<div class="message-text">${formattedContent}</div>`;
  }

  // Tool-specific information
  if (role === 'tool' && message.toolName) {
    contentHtml += `<div class="tool-info">`;
    contentHtml += `<div class="tool-name"><strong>Tool:</strong> ${escapeHtml(message.toolName)}</div>`;

    if (message.toolIntent) {
      contentHtml += `<div class="tool-intent"><strong>Intent:</strong> ${escapeHtml(message.toolIntent)}</div>`;
    }

    if (message.toolInput && Object.keys(message.toolInput).length > 0) {
      const inputFormatted = formatToolInput(message.toolInput);
      contentHtml += `<div class="tool-input"><strong>Input:</strong><pre>${escapeHtml(inputFormatted)}</pre></div>`;
    }

    if (message.toolResult) {
      contentHtml += `<div class="tool-result"><strong>Result:</strong><pre>${escapeHtml(message.toolResult)}</pre></div>`;
    }

    if (message.toolStatus) {
      const statusClass = message.toolStatus === 'error' ? 'status-error' : 'status-normal';
      contentHtml += `<div class="tool-status ${statusClass}"><strong>Status:</strong> ${escapeHtml(message.toolStatus)}</div>`;
    }

    contentHtml += `</div>`;
  }

  // Error-specific information
  if (role === 'error' || message.isError) {
    contentHtml += `<div class="error-info">`;

    if (message.errorTitle) {
      contentHtml += `<div class="error-title"><strong>${escapeHtml(message.errorTitle)}</strong></div>`;
    }

    if (message.errorDetails && message.errorDetails.length > 0) {
      contentHtml += `<div class="error-details"><ul>`;
      message.errorDetails.forEach((detail: string) => {
        contentHtml += `<li>${escapeHtml(detail)}</li>`;
      });
      contentHtml += `</ul></div>`;
    }

    contentHtml += `</div>`;
  }

  // Attachments
  if (message.attachments && message.attachments.length > 0) {
    contentHtml += `<div class="attachments">`;
    contentHtml += `<strong>Attachments:</strong><ul>`;
    message.attachments.forEach((att) => {
      contentHtml += `<li>${escapeHtml(att.name)} (${escapeHtml(att.type)})</li>`;
    });
    contentHtml += `</ul></div>`;
  }

  // Build complete message block
  return `
    <div class="message ${roleClass}">
      <div class="message-header">
        <span class="role-label">${roleLabel}</span>
        ${timestamp ? `<span class="timestamp">${timestamp}</span>` : ''}
      </div>
      <div class="message-content">
        ${contentHtml}
      </div>
    </div>
  `;
}

/**
 * Generate standalone HTML for a session
 * @param session The stored session to render
 * @returns Complete HTML document as a string
 */
export function generateSessionHTML(session: StoredSession): string {
  const sessionName = escapeHtml(session.name || 'Untitled Session');
  const createdDate = formatDate(session.createdAt);
  const messageCount = session.messages.length;

  // Render all messages
  const messagesHtml = session.messages
    .map((msg: StoredSession['messages'][number]) => renderMessageContent(msg))
    .join('\n');

  // Token usage summary
  const tokenSummary = `
    <div class="token-summary">
      <strong>Token Usage:</strong>
      Input: ${session.tokenUsage.inputTokens.toLocaleString()} |
      Output: ${session.tokenUsage.outputTokens.toLocaleString()} |
      Total: ${session.tokenUsage.totalTokens.toLocaleString()}
      ${session.tokenUsage.costUsd > 0 ? ` | Cost: $${session.tokenUsage.costUsd.toFixed(4)}` : ''}
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${sessionName} - Vespr Session</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #1a1a1a;
      background: #f5f5f5;
      padding: 20px;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }

    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 32px 24px;
    }

    .header h1 {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 12px;
    }

    .metadata {
      display: flex;
      gap: 24px;
      font-size: 14px;
      opacity: 0.9;
      flex-wrap: wrap;
    }

    .metadata-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .content {
      padding: 24px;
    }

    .message {
      margin-bottom: 24px;
      border-radius: 8px;
      padding: 16px;
      background: #fafafa;
      border-left: 4px solid #e0e0e0;
    }

    .message-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e0e0e0;
    }

    .role-label {
      font-weight: 600;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .timestamp {
      font-size: 12px;
      color: #666;
    }

    .message-content {
      color: #333;
    }

    .message-text {
      margin-bottom: 12px;
      line-height: 1.6;
    }

    /* Role-specific styling */
    .role-user {
      background: #e3f2fd;
      border-left-color: #2196f3;
    }

    .role-user .role-label {
      color: #1976d2;
    }

    .role-assistant {
      background: #f3e5f5;
      border-left-color: #9c27b0;
    }

    .role-assistant .role-label {
      color: #7b1fa2;
    }

    .role-tool {
      background: #fff3e0;
      border-left-color: #ff9800;
    }

    .role-tool .role-label {
      color: #f57c00;
    }

    .role-error {
      background: #ffebee;
      border-left-color: #f44336;
    }

    .role-error .role-label {
      color: #c62828;
    }

    .role-system,
    .role-status,
    .role-info {
      background: #e8f5e9;
      border-left-color: #4caf50;
    }

    .role-system .role-label,
    .role-status .role-label,
    .role-info .role-label {
      color: #2e7d32;
    }

    .role-warning {
      background: #fff8e1;
      border-left-color: #ffc107;
    }

    .role-warning .role-label {
      color: #f57f17;
    }

    .role-plan {
      background: #e0f2f1;
      border-left-color: #009688;
    }

    .role-plan .role-label {
      color: #00695c;
    }

    .role-auth {
      background: #fce4ec;
      border-left-color: #e91e63;
    }

    .role-auth .role-label {
      color: #c2185b;
    }

    /* Tool info styling */
    .tool-info {
      margin-top: 12px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.6);
      border-radius: 6px;
      font-size: 14px;
    }

    .tool-info > div {
      margin-bottom: 8px;
    }

    .tool-info > div:last-child {
      margin-bottom: 0;
    }

    .tool-info pre {
      background: #f5f5f5;
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 13px;
      margin-top: 4px;
      font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace;
    }

    .status-error {
      color: #c62828;
    }

    /* Error info styling */
    .error-info {
      margin-top: 12px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.6);
      border-radius: 6px;
    }

    .error-title {
      font-size: 16px;
      margin-bottom: 8px;
      color: #c62828;
    }

    .error-details ul {
      list-style-position: inside;
      padding-left: 12px;
    }

    .error-details li {
      margin-bottom: 4px;
    }

    /* Attachments styling */
    .attachments {
      margin-top: 12px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.6);
      border-radius: 6px;
      font-size: 14px;
    }

    .attachments ul {
      list-style-position: inside;
      padding-left: 12px;
      margin-top: 4px;
    }

    .attachments li {
      margin-bottom: 4px;
    }

    /* Token summary styling */
    .token-summary {
      margin-top: 24px;
      padding: 16px;
      background: #f5f5f5;
      border-radius: 8px;
      text-align: center;
      font-size: 14px;
      color: #666;
    }

    /* Footer styling */
    .footer {
      padding: 16px 24px;
      text-align: center;
      color: #666;
      font-size: 13px;
      border-top: 1px solid #e0e0e0;
    }

    .footer a {
      color: #667eea;
      text-decoration: none;
    }

    .footer a:hover {
      text-decoration: underline;
    }

    /* Responsive design */
    @media (max-width: 768px) {
      body {
        padding: 12px;
      }

      .header {
        padding: 24px 16px;
      }

      .header h1 {
        font-size: 24px;
      }

      .content {
        padding: 16px;
      }

      .message {
        padding: 12px;
      }

      .metadata {
        flex-direction: column;
        gap: 8px;
      }
    }

    @media print {
      body {
        background: white;
        padding: 0;
      }

      .container {
        box-shadow: none;
        border-radius: 0;
      }

      .header {
        background: #667eea;
        color: white;
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }

      .message {
        page-break-inside: avoid;
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${sessionName}</h1>
      <div class="metadata">
        <div class="metadata-item">
          <span>Created: ${createdDate}</span>
        </div>
        <div class="metadata-item">
          <span>Messages: ${messageCount}</span>
        </div>
        <div class="metadata-item">
          <span>Workspace: ${escapeHtml(session.workspaceRootPath)}</span>
        </div>
      </div>
    </div>

    <div class="content">
      ${messagesHtml}
      ${tokenSummary}
    </div>

    <div class="footer">
      Exported from <a href="https://vespr.atherslabs.com" target="_blank">Vespr</a> by Ather Labs
    </div>
  </div>
</body>
</html>`;
}
