# LLM Tool (`call_llm`)

Invoke a secondary LLM for focused subtasks. The tool loads file content automatically from paths you provide.

## When to Use

| Use Case | Model | Features |
|----------|-------|----------|
| Summarize large file | haiku | `attachments` |
| Classify content | haiku | `outputFormat: "classification"` |
| Extract structured data | haiku | `outputSchema` |
| Deep analysis | sonnet/opus | `thinking: true` (API key only) |
| Parallel processing | any | Multiple calls in one message |

## Authentication Paths

Features depend on how you authenticate:

| Feature | API Key | OAuth |
|---------|---------|-------|
| Text attachments | Yes | Yes |
| Image attachments | Yes | No |
| Structured output | Guaranteed (tool_choice) | Prompt-based |
| Extended thinking | Yes | No |
| All models | Yes | Yes |

- **API key**: Full features via direct Anthropic SDK
- **OAuth**: Basic features via agent-native callback

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | string | Instructions for the LLM (required) |
| `attachments` | array | File/image paths to include |
| `model` | string | Any model from the model registry. Defaults to Haiku (fastest) |
| `systemPrompt` | string | Optional system prompt |
| `maxTokens` | number | Max output tokens (1-64000, default 4096) |
| `temperature` | number | Sampling temperature 0-1 (ignored if thinking=true) |
| `thinking` | boolean | Enable extended thinking (API key only) |
| `thinkingBudget` | number | Token budget for thinking (1024-100000, default 10000) |
| `outputFormat` | enum | Predefined output format |
| `outputSchema` | object | Custom JSON Schema |

## Attachments

```typescript
// Simple file
attachments: ["/src/auth.ts"]

// Large file - use line range (required for files >2000 lines)
attachments: [{ path: "/logs/app.log", startLine: 1000, endLine: 1500 }]

// Mix of files and images (API key only for images)
attachments: ["/src/component.tsx", "/designs/mockup.png"]
```

### Line Ranges

For files larger than 2000 lines or 500KB, you must specify a line range:

```typescript
{ path: "/path/to/large-file.log", startLine: 100, endLine: 600 }
```

The tool will tell you the file structure if you try to load a file that's too large.

### Supported Formats

- **Text files**: Any UTF-8 encoded file (`.ts`, `.js`, `.py`, `.md`, `.json`, etc.)
- **Images**: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` (max 5MB each, API key only)

## Output Formats

| Format | Returns |
|--------|---------|
| `summary` | `{ summary, key_points[], word_count }` |
| `classification` | `{ category, confidence, reasoning }` |
| `extraction` | `{ items[], count }` |
| `analysis` | `{ findings[], issues[], recommendations[] }` |
| `comparison` | `{ similarities[], differences[], verdict }` |
| `validation` | `{ valid, errors[], warnings[] }` |

## Parallel Processing

Call multiple times in a single message for parallel execution:

```
call_llm(prompt: "Summarize", attachments: ["/file1.ts"])
call_llm(prompt: "Summarize", attachments: ["/file2.ts"])
call_llm(prompt: "Summarize", attachments: ["/file3.ts"])
// All run simultaneously - ~3x faster than sequential!
```

Use cases for parallel calls:
- Analyze multiple files at once
- Get multiple perspectives on the same code
- Process batch data
- Generate variations

## Examples

### Summarize a File (Cheap)

```typescript
call_llm({
  prompt: "Summarize the main functionality",
  attachments: ["/src/auth/handler.ts"],
  model: "claude-haiku-4-5-20251001"
})
```

### Extract Structured Data

```typescript
call_llm({
  prompt: "Extract all API endpoints from this file",
  attachments: ["/src/routes.ts"],
  outputSchema: {
    type: "object",
    properties: {
      endpoints: {
        type: "array",
        items: {
          type: "object",
          properties: {
            method: { type: "string" },
            path: { type: "string" },
            handler: { type: "string" }
          }
        }
      }
    },
    required: ["endpoints"]
  }
})
```

### Classify Content

```typescript
call_llm({
  prompt: "Classify this support ticket by urgency and category",
  attachments: ["/tickets/latest.txt"],
  outputFormat: "classification"
})
// Returns: { category: "billing", confidence: 0.92, reasoning: "..." }
```

### Deep Analysis with Thinking (API Key Only)

```typescript
call_llm({
  prompt: "Analyze this algorithm for edge cases and potential bugs",
  attachments: ["/src/sorting.ts"],
  model: "claude-sonnet-4-5-20250929",
  thinking: true,
  thinkingBudget: 15000
})
```

### Analyze Screenshot (API Key Only)

```typescript
call_llm({
  prompt: "Describe the UI issues in this screenshot",
  attachments: ["/screenshots/bug-report.png"],
  model: "claude-sonnet-4-5-20250929"
})
```

## Constraints

| Constraint | Limit |
|------------|-------|
| Max attachments | 20 per call |
| Max text file size | 2000 lines or 500KB |
| Max image size | 5MB |
| Max total content | 2MB across all attachments |
| thinking + structured output | Mutually exclusive |
| thinking + haiku | Not supported (use Sonnet/Opus) |
| thinking + OAuth | Not supported (use API key) |
| images + OAuth | Not supported (use API key) |

## Error Handling

The tool provides detailed error messages with recovery suggestions. Common errors:

### Attachment Errors

| Error | Cause | Solution |
|-------|-------|----------|
| File not found | Path doesn't exist | Check path spelling, use absolute paths |
| File too large | >2000 lines or >500KB | Use line range: `{ path, startLine, endLine }` |
| Line range too large | Range exceeds 2000 lines | Reduce range or split into multiple calls |
| Binary file detected | Non-text file without image extension | Use only text files or supported images |
| Permission denied | Cannot read file | Check file permissions |
| Empty file | File has no content | Skip empty files |
| Broken symlink | Symlink target missing | Fix or remove symlink |

### Parameter Errors

| Error | Cause | Solution |
|-------|-------|----------|
| thinking + outputFormat | Incompatible modes | Remove one option |
| thinking + haiku | Haiku doesn't support thinking | Use Sonnet or Opus |
| thinking + OAuth | OAuth doesn't support thinking | Use API key or remove thinking |
| images + OAuth | OAuth doesn't support images | Use API key or remove images |
| thinkingBudget without thinking | Missing thinking=true | Add `thinking: true` |
| Invalid line range | startLine > endLine | Fix range values |
| Unknown model | Model not in registry | Check available models in settings |

### API Errors (API Key Path)

| Status | Meaning | Recovery |
|--------|---------|----------|
| 401 | Invalid API key | Check/refresh credentials |
| 403 | Access denied | Verify model access on your plan |
| 429 | Rate limited | Reduce parallel calls, wait before retry |
| 500/502/503 | API unavailable | Retry in a few seconds |

## When NOT to Use

- You can reason through it yourself without needing a cheaper model
- The task requires your conversation context
- You need tools (Read, Bash, Glob) - use Task tool with subagents instead
- Simple one-liner responses that don't need isolation
