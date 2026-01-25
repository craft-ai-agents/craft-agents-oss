---
status: complete
priority: p1
issue_id: "012"
tags: [code-review, quality, flowy, agent-native]
dependencies: []
---

# Problem Statement

Parser errors in the Flowy system go directly to console logs only, with no user notification and no feedback returned to Claude. This breaks the agent-native feedback loop, preventing Claude from detecting parsing failures and correcting malformed diagram syntax. Users see incomplete diagrams without understanding why, and Claude continues generating potentially invalid diagram code without realizing the renderer failed to parse it.

## Findings

**Location:** `apps/electron/src/renderer/utils/flowy-parser.ts:46-52,75-78`

**Silent Failures:**
```typescript
// Lines 46-52: Parsing error swallowed
try {
  const parsed = JSON.parse(content);
} catch (error) {
  console.error("Parse error:", error); // Silent - user/Claude never see this
  return null; // Null return loses context
}

// Lines 75-78: Invalid node structure ignored
if (!node.id || !node.type) {
  console.warn("Invalid node:", node); // Logged but not reported
  continue; // Silently skipped
}
```

**Impact:**
- User sees blank diagram with no error explanation
- Claude unaware parsing failed, continues with wrong assumptions
- Debugging impossible without browser console access
- Agent feedback loop completely broken for diagram corrections

## Proposed Solutions

### Option 1: Structured Error Objects with Content Injection
- Pros:
  - User immediately sees error in diagram
  - Claude sees error in content and can correct
  - Minimal performance impact
- Cons:
  - Requires content restructuring
- Effort: Medium
- Risk: Low

Implement:
- Return `{ success: boolean, error?: ParsingError, content: string }` from parser
- Inject error markers into content: `[PARSE_ERROR: line 5: Invalid JSON structure]`
- Include error details in session atom for UI display
- Claude reads error markers and corrects on next response

### Option 2: User Notification UI + Claude Feedback Channel
- Pros:
  - Clear visual error display
  - Explicit feedback to Claude via system message
  - Better user experience
- Cons:
  - More complex implementation
- Effort: Large
- Risk: Medium

Implement:
- Toast notification with error details
- Error boundary component in diagram area
- System message injection: "Note: Previous diagram had parsing errors: [details]"
- Store error history per session for debugging

## Acceptance Criteria

- [ ] Parser returns structured error objects with details
- [ ] Error messages include line number, context, and suggestions
- [ ] Errors injected into message content for Claude visibility
- [ ] User sees error notification (toast/inline) in diagram area
- [ ] Error state persisted to session for debugging
- [ ] Claude can detect parsing errors and respond with corrections
- [ ] Test cases: malformed JSON, invalid node structure, missing fields
- [ ] Integration test: Claude receives error feedback and corrects syntax

## Work Log

- 2026-01-25: Created from code review
- 2026-01-25: Verified fix committed - structured ParsingError interface added, error markers injected into content (e.g., [FLOWY_PARSE_ERROR: ...]), and parse results include success/error objects in apps/electron/src/renderer/utils/flowy-parser.ts

## Resources

- Branch: feat/inline-flowy-diagrams
- Related: Agent-native feedback loops, error recovery patterns
- Test: Create sample malformed diagrams and verify error reporting
