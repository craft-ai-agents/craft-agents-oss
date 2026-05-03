---
name: viral
description: "When the user wants short-form video idea generation — scored viral ideas with research, trend velocity, contrarian angles, series potential, and an opening line ready to record. Also use when they say 'give me video ideas,' 'what should I post,' 'viral ideas for,' 'content ideas,' '/viral,' 'tiktok ideas,' 'reels ideas,' 'youtube shorts ideas,' or ask for trending angles in their niche. Pulls multi-source research (Reddit + YouTube + Google Trends + news) and integrates with the spy hook library if installed. Quick mode runs in ~60s."
tags: [marketing, content, social-media, video, ideas, research]
metadata:
  version: 2.0.0
  author: mikeoptimax
  source: https://github.com/mikeoptimax/viral-skill
---

```
██╗   ██╗██╗██████╗  █████╗ ██╗     
██║   ██║██║██╔══██╗██╔══██╗██║     
██║   ██║██║██████╔╝███████║██║     
╚██╗ ██╔╝██║██╔══██╗██╔══██║██║     
 ╚████╔╝ ██║██║  ██║██║  ██║███████╗
  ╚═══╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
  Research-Backed Idea Engine
```

# VIRAL — Research-Backed Idea Engine

## Usage
- `/viral` → deep mode (20 ideas, full research)
- `/viral --quick` → quick mode (5 ideas, no research, 60 seconds)
- `/viral --niche "AI tools for solopreneurs"` → one-shot niche override, skips config
- `/viral --series` → only surface ideas with multi-part series potential

---

## Step 0 — Setup

Check if `~/.viral/config.json` exists.

**If it exists:** Read it. Load user profile. Check `"setupComplete": true`. If complete, skip to Step 1.

**If it does NOT exist (or setupComplete is false):** Run first-time setup:

Say:
```
Welcome to /viral v2! Let's get you set up. Takes 3 minutes, happens once.
```

Ask these questions one at a time. Do NOT batch them.

1. "What's your name?"
2. "What's your social media handle?" (e.g. @yourhandle)
3. "What's your niche? One sentence." (e.g. "AI automation for small business owners")
4. "Who's your audience? Give me 1-2 specific segments." (e.g. "Agency owners automating ops" + "Beginners starting their first AI business")
5. "What's your credibility? One sentence with a real result." (e.g. "Built and sold 3 agencies, $4M total revenue")
6. "Give me 5-10 subreddits where your audience hangs out."
7. "Give me 5-10 hashtags your niche uses on TikTok or Instagram."

Then check for optional enhancements (do NOT block on these):

**Spy library:** Check if `~/.spy/hooks.md` exists.
- If yes → "Found your spy hook library — will use top performers as idea seeds."
- If no → "No spy library found. Run /spy to build one and I'll auto-pull proven hooks next time."

**Apify (optional):** Try calling `mcp__apify__search-actors` with query "tiktok scraper".
- If works → set `"apifyConnected": true`. Say "Apify connected — TikTok/Instagram scraping enabled."
- If fails → set `"apifyConnected": false`. Say "Apify not connected — running on web search only (full research still works)."
- Do NOT block setup. Do NOT make Apify sound required.

**Voice file:** Check if `~/.viral/voice.md` exists.
- If yes → "Found your voice file."
- If no → Ask: "Do you want to add voice examples now? (3-5 opening lines you've actually used) Or skip and I'll use defaults." If they provide examples, write them to `~/.viral/voice.md`.

Save config to `~/.viral/config.json`:
```json
{
  "name": "User Name",
  "handle": "@handle",
  "niche": "niche description",
  "audiences": ["segment 1", "segment 2"],
  "credibility": "proof line with specific result",
  "subreddits": ["r/sub1", "r/sub2"],
  "hashtags": ["#tag1", "#tag2"],
  "apifyConnected": false,
  "spyLibraryFound": false,
  "voiceFileFound": false,
  "setupComplete": true,
  "setupDate": "YYYY-MM-DD"
}
```

Say: "Setup complete! Running /viral now..."

---

## Step 1 — Mode Detection

Check the flag passed by the user:

- `--quick` flag present → jump to **QUICK MODE** below. Skip Steps 2-3.
- `--series` flag present → run full Deep Mode but filter final output to series-only ideas.
- `--niche "..."` flag present → override config niche with the provided value for this run only.
- No flag → run **DEEP MODE** (Steps 2-4).

---

## QUICK MODE (--quick flag)

Skip all research. Use only: config profile + voice file + spy hooks (if available).

Generate exactly 5 ideas in under 60 seconds. No agent spawning. No web searches.

Rules for Quick Mode ideas:
- Use a hook structure from voice.md. If no voice file, use one of: Credential Opener / Confession Opener / Specific Result Opener / Contrarian Claim / Pattern Interrupt.
- Ground every idea in the user's stated credibility from config.
- Every idea must have an opening line ready to record — the exact words, not a description.
- Vary formats across the 5: at least 1 TALKING HEAD, 1 TEXT ON SCREEN, 1 GREEN SCREEN.
- Score each idea (see Scoring Guide). Rewrite any below 65 before showing.

Output format: same as Deep Mode idea cards (see Step 4). No research citations needed in Quick Mode.

After 5 ideas:
```
---
Quick mode: 5 ideas, no research. Run /viral (no flag) for 20 research-backed ideas.
Pick a number and I'll write the full script right now.
---
```

---

## DEEP MODE — Step 2: Load Spy Hook Intelligence

Before research, check for the spy library at `~/.spy/hooks.md`.

**If it exists:**
- Read the file. Find the top 5 hook entries with the highest scores (or the first 5 if unscored).
- Extract the TEMPLATE pattern from each hook — not the hook text itself, but the underlying structure.
  - Example: Hook text "I went from 0 to $47k in 6 months with one change" → Template: "[Starting point] to [result] in [timeframe] with [one change]"
- Store these 5 templates as "proven angles."
- Tell the user: "Found [X] hooks in your spy library — using top 5 as idea seeds."

**If not found:** Skip silently. Continue without spy intelligence.

---

## DEEP MODE — Step 3: Spawn Research Agent

Use the Agent tool to launch a parallel researcher. Do NOT wait to finish Step 2 first — spawn as soon as spy check is done. Build the prompt dynamically from the user's config:

```
You are a research agent for [NAME] ([HANDLE]). Their niche: [NICHE]. Their audiences: [AUDIENCES].

Your job is NOT to generate content ideas. Your job is to find what's happening in this niche RIGHT NOW — pain points, limiting beliefs, timely events, bad advice, and underserved angles. This is ammunition for a content creator. Research only.

IMPORTANT: For every finding, assess trend velocity:
- 🔥 Rising fast = high and growing interest in the last 7 days
- 📊 Evergreen = consistently searched/discussed, not spiking
- 📉 Peaking or declining = was hot, now fading

---

TRACK A — WEB SEARCH (always runs — use WebSearch for all of these)

1. REDDIT — Search hot posts and top comments from:
   [LIST SUBREDDITS FROM CONFIG]
   
   Find: repeated pain points, frustrations being vented, limiting beliefs in comments, questions asked more than once this week. Quote exact phrases where possible — these become raw hook material.

2. GOOGLE TRENDS — Search "[niche] problems 2026", "[niche] mistakes", "[niche] trends", "[niche] tools". Note which topics have rising search interest vs. declining.

3. YOUTUBE TITLES — Search "[niche] most viewed 2026" and "[niche] viral". Scan titles only — what angles are getting clicks? What topics have multiple creators covering right now (signal of hot demand)?

4. INDUSTRY NEWS — Search "[niche] news this week", "[niche] platform update", "[niche] stats 2026". Find: any tool changes, new data drops, viral moments in the niche from the last 7 days.

5. COMPETITOR CONTENT — Search top 3 creators in [NICHE]. What are they posting right now? What angles are they NOT covering? Gaps = opportunity.

---

[IF apifyConnected IS TRUE:]
TRACK B — APIFY SCRAPING (supplement, not replacement for Track A)

Before calling any actor, search Apify Store via mcp__apify__search-actors. Selection rules:
1. Pay-per-use pricing only (PAY_PER_EVENT or PRICE_PER_DATASET_ITEM)
2. Prefer official Apify actors (isOfficialApify: true)
3. Unofficial: only if rating 4.5+, high success rate, substantial reviews
4. Limit ALL scrapers to 15 results max per run

TIKTOK — Search hashtags: [LIST HASHTAGS FROM CONFIG]
Look for: limiting beliefs in captions, fears in comments, bad advice being spread, hooks on high-view videos.

INSTAGRAM REELS — Search hashtags: [LIST HASHTAGS FROM CONFIG]
Look for: same as TikTok. Note engagement rates where visible.
[END IF]

---

Return structured research output:

**1. Top 5 Pain Points Right Now**
[Pain point] — Source: [subreddit/platform] — Velocity: [🔥/📊/📉]
(Include exact quotes from posts/comments where possible)

**2. Top 5 Limiting Beliefs**
[The false belief being repeated] — Where it's showing up — Velocity: [🔥/📊/📉]

**3. Timely Events or Stats (last 7 days)**
[Event/stat] — Source — Why it matters for content

**4. Bad Advice Being Spread**
[The bad advice] — Who's spreading it — Contrarian opportunity

**5. Underserved Angles**
[Topic with clear audience interest but thin or low-quality content coverage] — Evidence
```

Wait for the researcher to return before proceeding to Step 4.

---

## DEEP MODE — Step 4: Generate 20 Ideas

This is the core output. Read every rule before writing a single idea.

**Generation order (mandatory):**
1. Start from the user's voice + credibility (config + voice.md)
2. Match to a pain point, limiting belief, or event from research
3. Write hook in their voice — use their real hook examples as style templates
4. Apply spy hook templates where they fit (at least 3 of the 20 must use spy templates if library exists)
5. Score it. If below 65, rewrite before including.

**Voice test (apply before every hook):** Could this person say this out loud to a friend without reading from notes? If it sounds like a content calendar entry or blog post title, rewrite it.

**Target mix for the 20 ideas:**
- 8 evergreen (📊)
- 6 timely / trending (🔥)
- 4 contrarian-first (lead with the opposite take)
- 2 series starters (explicitly flag for multi-part arc)
- Vary formats: minimum 4 TALKING HEAD, 3 GREEN SCREEN, 3 TEXT ON SCREEN, 2 CAROUSEL, 2 TEARDOWN, 1 DUET/STITCH

---

### Each Idea Format:

**[#] [Hook — the exact opening line to record or put on screen]**

| Field | Value |
|-------|-------|
| Score | Avatar: X/25 · Specificity: X/25 · Simplicity: X/25 · Proof: X/25 = **XX/100** |
| Format | [TALKING HEAD / GREEN SCREEN / TEXT ON SCREEN / CAROUSEL / TEARDOWN / DUET/STITCH] |
| Platform | Instagram Reels · TikTok · YouTube Shorts |
| Trend | 🔥 Rising fast / 📊 Evergreen / 📉 Peaking — don't rush |
| Series? | Yes — Part 1 of [N]: [brief arc description] / No |
| Hook structure | [Name from voice.md OR default type: Credential Opener / Confession / Specific Result / Contrarian Claim / Pattern Interrupt / Question Hook] |
| The angle | One sentence — the user's actual opinion or point, not a topic summary |
| Why now | Timely event/stat from research OR reason it's always relevant |
| Proof anchor | Specific personal result, stat, or client outcome — no "some people say" |
| Spy match | [If a spy hook template fits this idea — show the template] / None |

After each idea, always show the contrarian flip:

↩️ **Contrarian angle:** [The opposite take. Often more viral than the original.]

---

## Scoring Guide

**Avatar (25 pts):** Would YOUR specific audience stop scrolling for this?
- 0 = generic, could be for anyone
- 10 = relevant to niche but not specific segment
- 20 = speaks directly to one audience segment from config
- 25 = hyper-specific to their exact pain or desire right now

**Specificity (25 pts):** Does it have a concrete number, timeframe, or named result?
- 0 = completely vague ("how to grow faster")
- 10 = some specificity ("how to grow your account")
- 20 = number present but soft ("doubled my revenue in 6 months")
- 25 = hard numbers + timeframe + specific context ("$0 to $23k/month in 4 months selling one thing")

**Simplicity (25 pts):** Does it cut complexity or add to the overwhelm?
- 0 = adds cognitive load, requires effort to parse
- 10 = clear but not compelling
- 20 = one clear idea, easy to grasp
- 25 = instantly understood, makes the audience feel relief

**Proof Anchor (25 pts):** Can the user back this from their real experience?
- 0 = "some people" or generic claim
- 10 = vague personal reference
- 20 = real result but unquantified
- 25 = specific personal result with numbers or named client outcome

**Minimum publishable: 65/100.** Any idea scored below 65 must be rewritten before it appears in the output.

---

## Format Options

| Tag | Format |
|-----|--------|
| `[TALKING HEAD]` | Direct to camera. Raw opinion. No props. |
| `[GREEN SCREEN]` | React to a stat, headline, or someone's result shown on screen |
| `[TEXT ON SCREEN]` | No face needed. Text-driven. B-roll or plain background. |
| `[CAROUSEL]` | Swipeable list or comparison. Instagram-first. |
| `[TEARDOWN]` | Walk through a real funnel, video, or launch and break it down live |
| `[DUET/STITCH]` | React to another creator's specific claim or content |

---

## Series Architecture

For every idea flagged `Series? Yes`, show the full arc immediately after the idea card:

```
Series arc — [Series Title]:
  Part 1: [exact hook for part 1]
  Part 2: [exact hook for part 2]
  Part 3: [exact hook for part 3]
  (Add Part 4+ if natural)
Compound effect: each part drives watch time on the others. Total reach multiplies.
```

---

## Step 5 — Deliver + Next Step

After all 20 ideas (or 5 in Quick Mode), output this closing block:

```
---
Scores summary: Average XX/100 · Best: #[N] at XX/100 · Lowest: #[N] at XX/100
Series starters: #[N], #[N]
Contrarian ready: #[N], #[N], #[N], #[N]

Pick a number and I'll write the full script right now.
Or run /spy first to build your hook intelligence library — it feeds directly back into /viral.
---
```

---

## Voice Rules

**Never use:**
- "game-changer", "in today's world", "journey", "leverage", "authentic", "groundbreaking", "as an AI", "unlock", "dive into", "delve", "it's important to note", "transformative"

**Always:**
- Concrete numbers, dollar amounts, timeframes
- First-person credibility ("I did X" not "experts say X")
- Direct address to the specific audience segment ("if you're running an agency under $50k/month...")
- Match hook structures from voice.md when they exist
- Ideas come from user's experience first — research adds the "why now" layer

**The one test:** Would this person say this sentence to a friend at a coffee shop without cringing? If not, rewrite it until they would.

---

*v2.0.0 — Multi-source research, trend velocity, spy library integration, 4-axis scoring, contrarian engine, series architecture. Apify optional.*
