import type { Session, Message, Workspace } from '../../shared/types'

export const mockWorkspaces: Workspace[] = [
  { id: 'ws-personal', name: 'Personal Notes', mcpUrl: 'https://mcp.craft.do/personal', createdAt: Date.now() - 86400000 * 30 },
  { id: 'ws-work', name: 'Work Projects', mcpUrl: 'https://mcp.craft.do/work', createdAt: Date.now() - 86400000 * 60 },
  { id: 'ws-research', name: 'Research', mcpUrl: 'https://mcp.craft.do/research', createdAt: Date.now() - 86400000 * 15 },
  { id: 'ws-linktest', name: 'Link Testing', mcpUrl: 'https://mcp.craft.do/linktest', createdAt: Date.now() - 86400000 * 1 },
]

// Helper to create message IDs
const msgId = (n: number) => `msg-mock-${n}`

// Sample messages showcasing different message types
const sampleConversation: Message[] = [
  {
    id: msgId(1),
    role: 'user',
    content: 'Can you help me organize my notes about the new project?',
    timestamp: Date.now() - 300000,
  },
  {
    id: msgId(2),
    role: 'assistant',
    content: `I'd be happy to help you organize your project notes. Let me first take a look at what documents you have in your workspace.`,
    timestamp: Date.now() - 295000,
  },
  {
    id: msgId(3),
    role: 'tool',
    content: JSON.stringify({
      documents: [
        { title: 'Project Overview', lastModified: '2024-01-15' },
        { title: 'Meeting Notes - Jan 10', lastModified: '2024-01-10' },
        { title: 'Technical Requirements', lastModified: '2024-01-12' },
      ]
    }, null, 2),
    timestamp: Date.now() - 290000,
    toolName: 'craft_search',
    toolUseId: 'tool-1',
    toolInput: { query: 'project notes' },
    toolResult: 'Found 3 documents',
  },
  {
    id: msgId(4),
    role: 'assistant',
    content: `I found 3 documents related to your project:

1. **Project Overview** - Last updated Jan 15
2. **Meeting Notes - Jan 10** - From your kickoff meeting
3. **Technical Requirements** - Last updated Jan 12

I can help you:
- Create a summary document that links all of these
- Add tags or organize them into a folder
- Extract action items from the meeting notes

What would you prefer?`,
    timestamp: Date.now() - 285000,
  },
  {
    id: msgId(5),
    role: 'user',
    content: 'Extract the action items from the meeting notes please',
    timestamp: Date.now() - 200000,
  },
  {
    id: msgId(6),
    role: 'tool',
    content: `# Meeting Notes - Jan 10

## Attendees
- Alice, Bob, Charlie

## Discussion
- Reviewed project timeline
- Discussed technical approach

## Action Items
- [ ] Alice: Create wireframes by Jan 20
- [ ] Bob: Set up dev environment
- [ ] Charlie: Draft API spec`,
    timestamp: Date.now() - 195000,
    toolName: 'craft_read_document',
    toolUseId: 'tool-2',
    toolInput: { documentId: 'meeting-notes-jan-10' },
  },
  {
    id: msgId(7),
    role: 'assistant',
    content: `Here are the action items from the Jan 10 meeting:

| Assignee | Task | Deadline |
|----------|------|----------|
| Alice | Create wireframes | Jan 20 |
| Bob | Set up dev environment | Not specified |
| Charlie | Draft API spec | Not specified |

Would you like me to create a dedicated "Action Items" document to track these, or add them to an existing task list?`,
    timestamp: Date.now() - 190000,
  },
]

// A shorter conversation for variety
const shortConversation: Message[] = [
  {
    id: msgId(100),
    role: 'user',
    content: 'What documents did I create last week?',
    timestamp: Date.now() - 86400000,
  },
  {
    id: msgId(101),
    role: 'assistant',
    content: 'Let me search for documents created in the last 7 days.',
    timestamp: Date.now() - 86395000,
  },
  {
    id: msgId(102),
    role: 'tool',
    content: 'Found 2 documents: "Weekly Review", "Ideas Brainstorm"',
    timestamp: Date.now() - 86390000,
    toolName: 'craft_search',
    toolUseId: 'tool-100',
    toolInput: { dateRange: 'last_week' },
  },
  {
    id: msgId(103),
    role: 'assistant',
    content: `You created 2 documents last week:

1. **Weekly Review**
2. **Ideas Brainstorm**

Would you like me to open either of these?`,
    timestamp: Date.now() - 86385000,
  },
]

// Conversation to test link detection
const linkTestConversation: Message[] = [
  {
    id: msgId(300),
    role: 'user',
    content: 'Test various link formats',
    timestamp: Date.now() - 60000,
  },
  {
    id: msgId(301),
    role: 'assistant',
    content: `Here are various link formats to test auto-detection:

## Full URLs
- HTTPS: https://github.com/anthropics/claude-code
- HTTP: http://example.com/path?query=value
- With port: https://localhost:3000/api

## Bare Domains (no protocol)
- Simple: google.com
- With path: github.com/user/repo
- Subdomain: docs.craft.do/getting-started

## WWW URLs
- Basic: www.example.org
- With path: www.npmjs.com/package/linkify-it

## File Paths
- Absolute: /Users/test/Documents/project/src/index.ts
- Home: ~/Documents/notes.md
- Relative: ./src/components/App.tsx
- Deep: /var/log/app.log

## Real File Paths (click to test!)
- This project's README: /Users/balintorosz/Documents/GitHub/craft-tui-agent/README.md
- The linkify module: /Users/balintorosz/Documents/GitHub/craft-tui-agent/apps/electron/src/renderer/components/markdown/linkify.ts
- Package.json: /Users/balintorosz/Documents/GitHub/craft-tui-agent/package.json

## Emails
- Simple: hello@example.com
- Complex: support+test@company.io

## Already Linked (should NOT double-link)
- Markdown: [Google](https://google.com)
- Reference: Check the [documentation](https://docs.craft.do)

## In Code (should NOT link)
\`\`\`typescript
const apiUrl = 'https://api.example.com/v1';
const configPath = '/etc/app/config.json';
\`\`\`

Inline code: \`https://should-not-link.com\` and \`/path/to/file.ts\`

## Edge Cases
- Trailing punctuation: https://example.com.
- In parentheses: (see https://mcp.linear.app/mcp)
- Multiple on one line: https://a.com https://b.com https://c.com`,
    timestamp: Date.now() - 55000,
  },
  {
    id: msgId(302),
    role: 'user',
    content: 'Done! I\'ve updated my instructions with the correct Linear MCP server configuration:\n\nURL: https://mcp.linear.app/mcp',
    timestamp: Date.now() - 50000,
  },
  {
    id: msgId(303),
    role: 'assistant',
    content: `Great! I can confirm the Linear MCP server is configured at https://mcp.linear.app/mcp

For reference, here are some other useful MCP endpoints:
- Craft: https://mcp.craft.do/workspace
- GitHub: https://mcp.github.com/repos

You can also check the documentation at docs.linear.app/mcp for more details, or email support@linear.app if you have questions.`,
    timestamp: Date.now() - 45000,
  },
]

// Conversation showing an error state
const errorConversation: Message[] = [
  {
    id: msgId(200),
    role: 'user',
    content: 'Delete all my documents',
    timestamp: Date.now() - 3600000,
  },
  {
    id: msgId(201),
    role: 'error',
    content: 'Permission denied: Bulk delete operations require explicit confirmation. Please specify which documents you want to delete.',
    timestamp: Date.now() - 3595000,
  },
  {
    id: msgId(202),
    role: 'user',
    content: 'Okay, just show me my recent documents then',
    timestamp: Date.now() - 3500000,
  },
  {
    id: msgId(203),
    role: 'status',
    content: 'Searching workspace...',
    timestamp: Date.now() - 3495000,
  },
  {
    id: msgId(204),
    role: 'assistant',
    content: 'Here are your 5 most recent documents. Let me know if you want to work with any of them.',
    timestamp: Date.now() - 3490000,
  },
]

export const mockSessions: Session[] = [
  {
    id: 'session-linktest',
    workspaceId: 'ws-linktest',
    workspaceName: 'Link Testing',
    lastMessageAt: Date.now() - 45000,
    messages: linkTestConversation,
    isProcessing: false,
  },
  {
    id: 'session-1',
    workspaceId: 'ws-personal',
    workspaceName: 'Personal Notes',
    lastMessageAt: Date.now() - 190000,
    messages: sampleConversation,
    isProcessing: false,
  },
  {
    id: 'session-2',
    workspaceId: 'ws-work',
    workspaceName: 'Work Projects',
    lastMessageAt: Date.now() - 86385000,
    messages: shortConversation,
    isProcessing: false,
  },
  {
    id: 'session-3',
    workspaceId: 'ws-research',
    workspaceName: 'Research',
    lastMessageAt: Date.now() - 3490000,
    messages: errorConversation,
    isProcessing: false,
  },
]

// Sample streaming responses for mock sendMessage
export const mockStreamingResponses = [
  {
    text: `I'll help you with that. Let me search through your documents to find the relevant information.`,
    includeToolCall: true,
    toolName: 'craft_search',
    toolInput: { query: 'relevant documents' },
    toolResult: 'Found 3 matching documents',
  },
  {
    text: `Based on my analysis, here are the key points:

1. **First point** - This is important because it establishes the foundation
2. **Second point** - This builds on the first point
3. **Third point** - This ties everything together

Would you like me to elaborate on any of these?`,
    includeToolCall: false,
  },
  {
    text: `I found what you're looking for. The document contains detailed information about the topic you mentioned. Here's a summary:

> The main concept revolves around efficient organization and retrieval of information. By structuring your notes properly, you can significantly improve your productivity.

Let me know if you need more details!`,
    includeToolCall: false,
  },
]
