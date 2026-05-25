# Markdown Preview Guide

This guide covers how to display rendered `.md` files inline using `markdown-preview` code blocks.

## Overview

The `markdown-preview` block renders a markdown file inline in chat messages — showing the parsed markdown with the same renderer chat uses, with an expand button for taller content and a tab bar for multi-item specs.

| Format | Best For | Rendering |
|--------|----------|-----------|
| **`markdown-preview` block** | `.md` files on disk (specs, drafts, READMEs) | Inline rendered markdown via the shared renderer |
| **`html-preview` block** | Emails, newsletters, styled HTML | Sandboxed iframe with full CSS |
| **`pdf-preview` block** | PDF documents, reports | First page inline, full navigation in fullscreen |
| **`image-preview` block** | Screenshots, captures | Inline image + fullscreen viewer |
| **`datatable`/`spreadsheet`** | Structured data | Interactive sortable/filterable tables |

**Key principle:** Like `pdf-preview` and `image-preview`, the file is already on disk — just reference the absolute path. No extraction step needed.

## When to Use

Use `markdown-preview` when:
- **You just wrote a `.md` file** — show the agent's output rendered, not as a raw code block.
- **The user references a markdown file** — README, spec, notes, plan.
- **You want to display rendered prose** with tables, code blocks, links, headings, etc.

Do NOT use `markdown-preview` when:
- The content is HTML — use `html-preview`.
- The content is structured data — use `datatable` / `spreadsheet`.
- The content is a PDF — use `pdf-preview`.
- The user wants to **edit** the file — use the agent's standard Read/Edit/Write tools.

## Basic Usage

### Single Item

````
```markdown-preview
{
  "src": "/absolute/path/to/file.md",
  "title": "Spec draft"
}
```
````

### Multiple Items (Tabs)

When you have multiple related markdown files (e.g., spec versions, README sections), use the `items` array. A tab bar appears in the header for switching between items.

````
```markdown-preview
{
  "title": "Spec drafts",
  "items": [
    { "src": "/path/to/v1.md", "label": "v1" },
    { "src": "/path/to/v2.md", "label": "v2" },
    { "src": "/path/to/final.md", "label": "Final" }
  ]
}
```
````

Content loads lazily on tab switch and is cached once loaded.

### Config Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `src` | Yes* | string | Absolute path to the `.md` file on disk (single-item mode) |
| `title` | No | string | Display title shown in the header bar (defaults to "Markdown Preview") |
| `items` | Yes* | array | Array of items with `src` and optional `label` (multi-item mode) |
| `items[].src` | Yes | string | Absolute path to the `.md` file |
| `items[].label` | No | string | Tab label (defaults to "Item 1", "Item 2", …) |

*Either `src` (single) or `items` (multiple) is required. If both are present, `items` takes precedence.

**Important:** The `src` path must be **absolute**. The renderer reads it via the same path validation as other preview blocks — paths under the user's home directory, the system tmp directory, or workspace directories are accepted; arbitrary absolute paths outside those scopes are rejected. When an agent is writing a file for preview, it must still obey the current permission mode (for example, Explore mode writes are limited to the session `plansFolderPath` / `dataFolderPath`).

## Common Patterns

### After Writing a `.md` File

Most common case — you used `Write` to create a `.md` file, then show it rendered:

````
```markdown-preview
{
  "src": "/Users/me/Workspace/notes/decision.md",
  "title": "Decision log"
}
```
````

### Showing a Plan to the User

The plans folder (under `plansFolderPath`) holds session plans. To display one inline rendered:

````
```markdown-preview
{
  "src": "/absolute/path/to/plans/feature-x.md"
}
```
````

### Comparing Spec Versions

````
```markdown-preview
{
  "title": "Spec evolution",
  "items": [
    { "src": "/path/to/v1.md", "label": "Initial" },
    { "src": "/path/to/v2.md", "label": "After review" },
    { "src": "/path/to/final.md", "label": "Accepted" }
  ]
}
```
````

## Rendering Behavior

- The file's contents are passed through the same markdown renderer chat uses. GFM tables, syntax-highlighted code, headings, lists, blockquotes, and inline math all work.
- Inline preview is capped at 400px tall with a bottom fade gradient. Click the expand button (top-right) to expand the height in place.
- A `markdown-preview` fence **inside** the rendered file falls through to a regular code block — no infinite recursion. Other preview blocks (mermaid, datatable, …) embedded in the file still render.
- Links inside the rendered markdown route through the same handlers as the rest of chat: file paths open via the OS file manager, URLs open in the system browser.

## Decision Tree

```
Does the user want to SEE the rendered markdown?
  → YES: Use markdown-preview (paste absolute path)
  → NO: Read the file and present the relevant text inline

Is the content a markdown file (.md, .markdown)?
  → YES: Use markdown-preview
  → NO: HTML? → html-preview
        PDF?  → pdf-preview
        Image? → image-preview
        Data? → datatable/spreadsheet
```

## Troubleshooting

### "Loading..." shown indefinitely
- The `src` must be an **absolute path**, not relative.
- Verify the file exists at that exact path.
- The path must fall inside an allowed directory (home, tmp, or workspace).

### Blank preview area
- The file may be empty.
- The file may be a non-text file with a `.md` extension. Confirm the contents are markdown.

### Block renders as raw JSON code
- The JSON spec is malformed, or both `src` and `items` are missing/empty.
- Check that `src` is a string (not an array) and `items` is an array of objects with a `src` field.

### Links inside the rendered markdown don't open
- Plain `https://` URLs open in the system browser.
- Absolute filesystem paths open via the OS file manager.
- `file://` URLs are blocked by the in-app URL safety layer (`shell.openExternal` can launch local executables on Windows) — use a plain filesystem path or reference the file through another preview block.
