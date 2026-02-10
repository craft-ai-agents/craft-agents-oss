import type { ComponentEntry } from './types'
import { Markdown, CollapsibleMarkdownProvider, CodeBlock, InlineCode, MarkdownDatatableBlock, MarkdownSpreadsheetBlock } from '@craft-agent/ui'

const sampleMarkdown = `# Welcome to Markdown

This is a **bold** statement and this is *italic*.

## Code Examples

Here's some inline code: \`const x = 42\`

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`
}

// Call the function
console.log(greet("World"))
\`\`\`

## Lists

- First item
- Second item
  - Nested item
- Third item

1. Numbered one
2. Numbered two
3. Numbered three

## Table

| Name | Role | Status |
|------|------|--------|
| Alice | Developer | Active |
| Bob | Designer | Away |

## Blockquote

> This is a blockquote with some important information
> that spans multiple lines.

---

That's all folks!`

const codeHeavyMarkdown = `# API Response

The endpoint returned:

\`\`\`json
{
  "status": "success",
  "data": {
    "users": [
      { "id": 1, "name": "Alice" },
      { "id": 2, "name": "Bob" }
    ]
  }
}
\`\`\`

Process with:

\`\`\`python
import json

def process_response(data: dict) -> list:
    return [user["name"] for user in data["users"]]
\`\`\`

Or in TypeScript:

\`\`\`typescript
interface User {
  id: number
  name: string
}

const getNames = (users: User[]): string[] =>
  users.map(u => u.name)
\`\`\``

const typescriptCode = `import { useState, useEffect } from 'react'

interface Todo {
  id: number
  title: string
  completed: boolean
}

export function useTodos() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/todos')
      .then(res => res.json())
      .then(data => {
        setTodos(data)
        setLoading(false)
      })
  }, [])

  return { todos, loading }
}`

const pythonCode = `from dataclasses import dataclass
from typing import Optional

@dataclass
class User:
    id: int
    name: str
    email: Optional[str] = None

def get_user_by_id(user_id: int) -> Optional[User]:
    """Fetch user from database."""
    # Simulated database lookup
    users = {
        1: User(1, "Alice", "alice@example.com"),
        2: User(2, "Bob"),
    }
    return users.get(user_id)`

const jsonCode = `{
  "name": "craft-agent",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.2.0",
    "typescript": "^5.0.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  }
}`

// Wrapper for collapsible markdown
function CollapsibleWrapper({ children }: { children: React.ReactNode }) {
  return <CollapsibleMarkdownProvider>{children}</CollapsibleMarkdownProvider>
}

export const markdownComponents: ComponentEntry[] = [
  {
    id: 'markdown',
    name: 'Markdown',
    category: 'Markdown',
    description: 'Customizable markdown renderer with three render modes: terminal, minimal, full',
    component: Markdown,
    layout: 'top',
    props: [
      {
        name: 'children',
        description: 'Markdown content to render',
        control: { type: 'textarea', rows: 10 },
        defaultValue: sampleMarkdown,
      },
      {
        name: 'mode',
        description: 'Render mode controlling formatting level',
        control: {
          type: 'select',
          options: [
            { label: 'Terminal', value: 'terminal' },
            { label: 'Minimal', value: 'minimal' },
            { label: 'Full', value: 'full' },
          ],
        },
        defaultValue: 'minimal',
      },
      {
        name: 'collapsible',
        description: 'Enable collapsible headings',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      { name: 'Terminal', props: { children: sampleMarkdown, mode: 'terminal' } },
      { name: 'Minimal', props: { children: sampleMarkdown, mode: 'minimal' } },
      { name: 'Full', props: { children: sampleMarkdown, mode: 'full' } },
      { name: 'Code Heavy', props: { children: codeHeavyMarkdown, mode: 'minimal' } },
      { name: 'Collapsible', props: { children: sampleMarkdown, mode: 'full', collapsible: true } },
    ],
    mockData: () => ({
      onUrlClick: (url: string) => console.log('[Playground] URL clicked:', url),
      onFileClick: (path: string) => console.log('[Playground] File clicked:', path),
    }),
    wrapper: CollapsibleWrapper,
  },
  {
    id: 'code-block',
    name: 'CodeBlock',
    category: 'Markdown',
    description: 'Syntax highlighted code block using Shiki with copy button',
    component: CodeBlock,
    props: [
      {
        name: 'code',
        description: 'Code to display',
        control: { type: 'textarea', rows: 8 },
        defaultValue: typescriptCode,
      },
      {
        name: 'language',
        description: 'Programming language for syntax highlighting',
        control: {
          type: 'select',
          options: [
            { label: 'TypeScript', value: 'typescript' },
            { label: 'JavaScript', value: 'javascript' },
            { label: 'Python', value: 'python' },
            { label: 'JSON', value: 'json' },
            { label: 'Bash', value: 'bash' },
            { label: 'Plain Text', value: 'text' },
          ],
        },
        defaultValue: 'typescript',
      },
      {
        name: 'mode',
        description: 'Render mode',
        control: {
          type: 'select',
          options: [
            { label: 'Terminal', value: 'terminal' },
            { label: 'Minimal', value: 'minimal' },
            { label: 'Full', value: 'full' },
          ],
        },
        defaultValue: 'full',
      },
    ],
    variants: [
      { name: 'TypeScript Full', props: { code: typescriptCode, language: 'typescript', mode: 'full' } },
      { name: 'TypeScript Minimal', props: { code: typescriptCode, language: 'typescript', mode: 'minimal' } },
      { name: 'Python', props: { code: pythonCode, language: 'python', mode: 'full' } },
      { name: 'JSON', props: { code: jsonCode, language: 'json', mode: 'full' } },
    ],
  },
  {
    id: 'inline-code',
    name: 'InlineCode',
    category: 'Markdown',
    description: 'Styled inline code span with subtle background and border',
    component: InlineCode,
    props: [
      {
        name: 'children',
        description: 'Code text',
        control: { type: 'string' },
        defaultValue: 'const x = 42',
      },
    ],
    variants: [
      { name: 'Variable', props: { children: 'useState' } },
      { name: 'Function', props: { children: 'handleClick()' } },
      { name: 'Type', props: { children: 'React.FC<Props>' } },
      { name: 'Path', props: { children: 'src/components/App.tsx' } },
    ],
  },
  {
    id: 'datatable-block',
    name: 'MarkdownDatatableBlock',
    category: 'Markdown',
    description: 'Interactive data table with sorting for ```datatable code blocks',
    component: MarkdownDatatableBlock,
    props: [
      {
        name: 'code',
        description: 'JSON string with columns and rows',
        control: { type: 'textarea', rows: 12 },
        defaultValue: JSON.stringify({
          title: 'Sales by Region',
          columns: [
            { key: 'region', label: 'Region', type: 'text' },
            { key: 'revenue', label: 'Revenue', type: 'currency' },
            { key: 'growth', label: 'Growth', type: 'percent' },
            { key: 'units', label: 'Units Sold', type: 'number' },
            { key: 'status', label: 'Status', type: 'badge' },
          ],
          rows: [
            { region: 'North America', revenue: 1250000, growth: 0.124, units: 8420, status: 'Active' },
            { region: 'Europe', revenue: 980000, growth: 0.087, units: 6230, status: 'Active' },
            { region: 'Asia Pacific', revenue: 1580000, growth: 0.215, units: 12100, status: 'Active' },
            { region: 'Latin America', revenue: 420000, growth: -0.032, units: 2800, status: 'Revoked' },
            { region: 'Middle East', revenue: 310000, growth: 0.156, units: 1900, status: 'Active' },
          ],
        }, null, 2),
      },
    ],
    variants: [
      {
        name: 'Sales Data',
        props: {
          code: JSON.stringify({
            title: 'Sales by Region',
            columns: [
              { key: 'region', label: 'Region', type: 'text' },
              { key: 'revenue', label: 'Revenue', type: 'currency' },
              { key: 'growth', label: 'Growth', type: 'percent' },
              { key: 'status', label: 'Status', type: 'badge' },
            ],
            rows: [
              { region: 'North America', revenue: 1250000, growth: 0.124, status: 'Active' },
              { region: 'Europe', revenue: 980000, growth: 0.087, status: 'Active' },
              { region: 'Asia Pacific', revenue: 1580000, growth: 0.215, status: 'Active' },
              { region: 'Latin America', revenue: 420000, growth: -0.032, status: 'Revoked' },
            ],
          }),
        },
      },
      {
        name: 'Boolean & Badge Types',
        props: {
          code: JSON.stringify({
            title: 'API Keys',
            columns: [
              { key: 'name', label: 'Name', type: 'text' },
              { key: 'active', label: 'Active', type: 'boolean' },
              { key: 'status', label: 'Status', type: 'badge' },
            ],
            rows: [
              { name: 'Production', active: true, status: 'Passing' },
              { name: 'Staging', active: true, status: 'Passing' },
              { name: 'Legacy', active: false, status: 'Failed' },
            ],
          }),
        },
      },
      {
        name: 'Invalid JSON (Fallback)',
        props: { code: '{ invalid json here' },
      },
    ],
  },
  {
    id: 'spreadsheet-block',
    name: 'MarkdownSpreadsheetBlock',
    category: 'Markdown',
    description: 'Excel-style grid with column letters and row numbers for ```spreadsheet code blocks',
    component: MarkdownSpreadsheetBlock,
    props: [
      {
        name: 'code',
        description: 'JSON string with columns and rows',
        control: { type: 'textarea', rows: 12 },
        defaultValue: JSON.stringify({
          filename: 'Q1_Revenue.xlsx',
          sheetName: 'Summary',
          columns: [
            { key: 'region', label: 'Region', type: 'text' },
            { key: 'q1', label: 'Q1', type: 'currency' },
            { key: 'q2', label: 'Q2', type: 'currency' },
            { key: 'change', label: 'Change', type: 'percent' },
            { key: 'total', label: 'Total', type: 'formula' },
          ],
          rows: [
            { region: 'North', q1: 500000, q2: 620000, change: 0.24, total: 1120000 },
            { region: 'South', q1: 340000, q2: 310000, change: -0.088, total: 650000 },
            { region: 'East', q1: 780000, q2: 850000, change: 0.09, total: 1630000 },
            { region: 'West', q1: 420000, q2: 480000, change: 0.143, total: 900000 },
          ],
        }, null, 2),
      },
    ],
    variants: [
      {
        name: 'Revenue Sheet',
        props: {
          code: JSON.stringify({
            filename: 'Q1_Revenue.xlsx',
            sheetName: 'Summary',
            columns: [
              { key: 'region', label: 'Region', type: 'text' },
              { key: 'q1', label: 'Q1', type: 'currency' },
              { key: 'q2', label: 'Q2', type: 'currency' },
              { key: 'change', label: 'Change', type: 'percent' },
            ],
            rows: [
              { region: 'North', q1: 500000, q2: 620000, change: 0.24 },
              { region: 'South', q1: 340000, q2: 310000, change: -0.088 },
              { region: 'East', q1: 780000, q2: 850000, change: 0.09 },
            ],
          }),
        },
      },
      {
        name: 'Simple Sheet (No Filename)',
        props: {
          code: JSON.stringify({
            columns: [
              { key: 'item', label: 'Item', type: 'text' },
              { key: 'qty', label: 'Quantity', type: 'number' },
              { key: 'price', label: 'Price', type: 'currency' },
            ],
            rows: [
              { item: 'Widget A', qty: 100, price: 29 },
              { item: 'Widget B', qty: 250, price: 15 },
              { item: 'Widget C', qty: 50, price: 89 },
            ],
          }),
        },
      },
      {
        name: 'Invalid JSON (Fallback)',
        props: { code: '{ invalid json here' },
      },
    ],
  },
]
