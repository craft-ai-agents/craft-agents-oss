# Humanize-Writing Integration Guide

This resource documents how the Deliberative Refinement skill integrates with the humanize-writing skill for final content polish.

## Integration with **Deliberative Refinement** allows for rigorous checking associated with human-like writing qualities. invoked during the final pass to eliminate AI tells while preserving viral mechanics.

### Invocation Template

```
Apply the humanize-writing skill to this draft. Focus on:
- Ensuring natural sentence rhythm 
- Maintaining the viral hooks I've established
- Preserving platform-specific tone calibration
```

## Platform Calibration Matrix

Different platforms require different humanization levels:

| Platform | Humanize Intensity | Preserve | Special Considerations |
|----------|-------------------|----------|----------------------|
| Reddit | High - max casual | Hook, TL;DR | Subreddit voice matching |
| LinkedIn | Medium - professional warmth | Authority, expertise signals | Story-based openers |
| Twitter/X | Medium-High - punchy | Thread hooks, quotables | No 1/ numbering |
| YouTube | High - conversational | Bold claims, engagement | First 2 seconds critical |
| Hacker News | Medium - understated | Technical accuracy | Understate over overstate |
| TikTok | High - ultra-casual | Immediate hook | 1-3 second capture window |
| Instagram | High - visual-first | Caption hooks | Sound-off viewing common |
| Email | Medium - personal | Subject line urgency | 30-50 char subjects |

## Mapping to Humanize-Writing Phases

### Phase 1: Identify AI Patterns
From humanize-writing:
- Scan for transition overuse ("Furthermore," "Here's the thing")
- Check hedging language density
- Identify marketing clichés

**Viral content addition:**
- Preserve intentional hook language
- Keep platform-specific conventions

### Phase 2: Apply Humanization
From humanize-writing:
- Replace AI vocabulary with human equivalents
- Vary sentence patterns
- Introduce human speech patterns

**Viral content addition:**
- Maintain hook architecture (first 2 seconds)
- Preserve closer authority
- Keep tribal identity patterns

### Phase 3: Validate Against Checklist
From humanize-writing:
- No transitions in first sentence
- Active voice dominates (70%+)
- Personal voice present

**Viral content addition:**
- Hook strength verified
- Platform word count met
- Specificity ratio satisfied

---

## Video Script Humanization

### Hook Humanization (First 3 Seconds)
**Remove:**
- "Hey everyone, welcome back"
- "Before we start, like and subscribe"
- "In today's video, we're going to..."

**Replace with:**
- Jump straight to the hook
- Pattern interrupt opening
- Immediate value or curiosity

### Body Humanization
**Remove:**
- "So without further ado, let's dive in"
- "Here's where it gets interesting"
- Excessive signposting

**Replace with:**
- Natural flow between points
- Conversational tangents where appropriate
- Specific examples over abstract claims

### Outro Humanization
**Remove:**
- "Let me know what you think in the comments"
- "If you enjoyed this, don't forget to..."
- Generic call to action

**Replace with:**
- Strong declarative statement
- Callback to opening hook
- Specific next action (not generic CTA)

---

## TikTok/Reels Humanization

### Text Overlay Humanization
- 1-2 words only if used
- Hook in caption, not text overlay
- Sound-off readability required

### Caption Humanization
- First 3 words must hook
- Keywords early for discoverability
- Avoid hashtag stuffing

---

## When Humanize-Writing Is Unavailable

Use the built-in manual checklist in SKILL.md:

1. Read aloud test
2. Transition audit
3. Enthusiasm check
4. Specificity check
5. Length check (cut 20%)

## Technical Notes

- Both skills can be installed simultaneously
- Claude dynamically loads humanize-writing when referenced
- Cross-skill calls do not require explicit imports
- Skill descriptions determine when each activates

---

## Quick Reference: Humanization by Content Type

| Content Type | Priority Removals | Priority Preserves |
|--------------|-------------------|-------------------|
| Reddit Post | Transition tells, engagement bait | Hook, TL;DR, specificity |
| YouTube Script | Intro fluff, CTA begging | Hook, personality, closer |
| TikTok | Verbose captions, explanation | Immediate hook, keywords |
| LinkedIn | Corporate speak, hashtags | Story, contrarian angle |
| Twitter Thread | Numbering, meta-commentary | Quotable lines, hooks |
| Email | Generic urgency, ALL CAPS | Personalization, curiosity |

