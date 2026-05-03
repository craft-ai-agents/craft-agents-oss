---
name: spy
description: "When the user wants to scrape, analyze, or spy on competitors' or creators' Instagram, TikTok, or YouTube content to find viral outliers, transcribe hooks, score them, or build a hook library. Also use when they say 'spy on,' 'analyze this creator,' 'find viral hooks,' 'what's working on TikTok,' 'scrape Instagram,' 'transcribe this video,' 'hook library,' 'viral outliers,' '/spy,' or share an IG/TikTok/YouTube handle or URL for analysis. Requires yt-dlp on the system. Builds a persistent library at ~/.spy/."
tags: [marketing, research, social-media, video, hooks, competitive-intelligence]
metadata:
  version: 2.0.0
  author: mikeoptimax
  source: https://github.com/mikeoptimax/spy-skill
---

```
███████╗██████╗ ██╗   ██╗
██╔════╝██╔══██╗╚██╗ ██╔╝
███████╗██████╔╝ ╚████╔╝ 
╚════██║██╔═══╝   ╚██╔╝  
███████║██║        ██║   
╚══════╝╚═╝        ╚═╝   
  Multi-Platform Hook Intelligence
```

# SPY — Multi-Platform Hook Intelligence

Scrape Instagram, TikTok, and YouTube. Find viral outliers. Transcribe hooks. Score them. Build a persistent library that gets smarter every run. Write full scripts on demand. No Apify required — yt-dlp does the heavy lifting.

---

## Usage

```
/spy @handle1 @handle2 @handle3               # scrape mode — analyze any handles
/spy https://youtu.be/abc123                  # direct URL mode — instant single video analysis
/spy https://www.tiktok.com/@handle/video/123 # direct URL, platform auto-detected
/spy --delta @handle                          # delta mode — show only NEW outliers since last run
/spy --bench @myhandle @comp1 @comp2          # benchmark mode — you vs competitors
/spy --search "fear hook"                     # search your saved hook library
```

Minimum 1 handle or URL. Maximum 10 handles per scrape run.

---

## Step 0 — Setup

Check config at `~/.spy/config.json`.

**If config exists:** Load paths from it. Skip to Step 1.

**If config does NOT exist:** Run setup:

### Check CLI Tools

```bash
YT_DLP=$(which yt-dlp 2>/dev/null)
WHISPER=$(which whisper 2>/dev/null)
FFMPEG=$(which ffmpeg 2>/dev/null)
```

For each missing tool, tell the user:
- `yt-dlp` missing → `pip3 install yt-dlp`
- `whisper` missing → `pip3 install openai-whisper`
- `ffmpeg` missing → `brew install ffmpeg` (Mac) or `sudo apt install ffmpeg` (Linux)

**yt-dlp and ffmpeg are required. whisper is required for transcription.**
If any of the three are missing, stop and show install instructions. Do not proceed.

### Check Apify (Optional)

Try calling `mcp__apify__search-actors` with query "instagram".
- If it works: note `"apifyAvailable": true` in config. Log: `Apify detected — enhanced handle scraping enabled.`
- If it fails: note `"apifyAvailable": false`. Log: `Apify not connected — using yt-dlp direct mode. Provide video URLs directly or yt-dlp channel scraping will be attempted for handles.`

Apify is never required. If unavailable, handle-based scraping uses yt-dlp channel/playlist extraction where possible, and the user can always provide direct URLs.

### Create Hook Library

If `~/.spy/hooks.md` does not exist, create it with header:

```markdown
# SPY Hook Library
> Auto-built by /spy. Each entry is a scored, templatized hook from a viral outlier.
> Search: /spy --search "keyword or type"

---
```

### Save Config

```json
{
  "toolPaths": {
    "ytDlp": "/path/to/yt-dlp",
    "whisper": "/path/to/whisper",
    "ffmpeg": "/path/to/ffmpeg"
  },
  "apifyAvailable": true,
  "setupComplete": true,
  "setupDate": "YYYY-MM-DD"
}
```

Also create `~/.spy/runs/` directory for delta mode state files.

---

## Step 1 — Parse Input & Route

**DIRECT URL MODE — route here immediately if input is a URL:**

If the input is a single video URL (contains instagram.com/reels/, tiktok.com/video/, youtu.be/, youtube.com/watch, or youtube.com/shorts/):
1. Skip Steps 2-3 entirely
2. Jump straight to Step 4 (download → transcribe → score → save)
3. No Apify needed. No handle needed. Works with zero setup beyond yt-dlp + whisper.

This is the fastest path — paste any video URL and get a scored hook card in under 2 minutes.

---

Determine mode based on input flags and format:

| Input pattern | Mode |
|---------------|------|
| `@handle` or bare handle | Scrape mode |
| Full URL (instagram/tiktok/youtube) | Direct URL mode — skip to Step 4 |
| `--delta @handle` | Delta mode |
| `--bench @me @comp1 @comp2` | Benchmark mode |
| `--search "keyword"` | Search mode |

### Platform Detection (for URLs and handles)

Auto-detect platform from URL or context:
- `instagram.com` → Instagram
- `tiktok.com` → TikTok
- `youtube.com` or `youtu.be` → YouTube
- Handle with no URL → ask user which platform, or attempt all three

---

## Step 2 — Scrape or Download

### Direct URL Mode (no Apify needed)

```bash
$YT_DLP "[url]" -o /tmp/spy_video.mp4 --merge-output-format mp4 -q \
  --write-info-json --write-auto-sub --sub-lang en
```

Extract from info JSON: `view_count`, `like_count`, `comment_count`, `title`, `description`, `upload_date`, `webpage_url`.

Skip Steps 3 (outlier detection) — single video, treat as outlier by definition. Jump straight to Step 4.

### Scrape Mode — If Apify Available

Use the appropriate Apify actor per platform:
- Instagram: `apify/instagram-scraper` with `resultsType: "posts"`, `resultsLimit: 50`
- TikTok: `apify/tiktok-scraper` with `resultsType: "posts"`, `resultsLimit: 50`
- YouTube: `apify/youtube-scraper` with `resultsLimit: 50`

Extract per post: `ownerUsername`, `url`, `videoViewCount` (IG) / `playCount` (TikTok) / `viewCount` (YT), `likesCount`, `commentsCount`, `timestamp`, `caption`/`description`, `type`.

Filter to video posts only. Ignore static images and carousels for this analysis.

### Scrape Mode — No Apify (yt-dlp channel extraction)

Attempt channel/profile scraping via yt-dlp:

```bash
# YouTube
$YT_DLP "https://www.youtube.com/@[handle]/videos" \
  --flat-playlist --dump-json --playlist-end 50 -q > /tmp/spy_channel.jsonl

# TikTok
$YT_DLP "https://www.tiktok.com/@[handle]" \
  --flat-playlist --dump-json --playlist-end 50 -q > /tmp/spy_channel.jsonl
```

For Instagram without Apify: tell the user "Instagram handle scraping requires Apify. Provide direct reel URLs or connect Apify for full account scraping." Show setup instructions. Still process any direct URLs they provided.

Parse JSONL output to extract: `id`, `url`, `view_count`, `title`, `description`, `upload_date`.

---

## Step 3 — Outlier Detection

For each handle:
1. Calculate **median view count** across all retrieved posts
2. Flag posts with **5x+ median views** as outliers
3. Also include **top 3 posts by views** even if not 5x (handles with consistently high performance)
4. Filter to **last 60 days** — beyond that, hooks may be stale
5. If delta mode is active, load `~/.spy/runs/[handle]-last.json` and exclude URLs already seen

Print scrape summary before processing:

```
Scrape complete:
  @handle1 [Instagram]: 47 posts, median 18K views, 4 outliers (5x+)
  @handle2 [TikTok]:    39 posts, median 42K plays, 6 outliers (5x+)
  @handle3 [YouTube]:   50 posts, median 9K views,  2 outliers (5x+)

Total outliers to process: 12 (max 25)
```

---

## Step 4 — Process Each Outlier

Process in order of view count (highest first). Maximum 25 outliers total.

### 4a. Download

```bash
$YT_DLP "[url]" -o /tmp/spy_video.mp4 --merge-output-format mp4 -q
```

If download fails (geo-block, age gate, private): skip and note `[DOWNLOAD FAILED]` on the card.

### 4b. Transcribe — Spoken Hook

```bash
$WHISPER /tmp/spy_video.mp4 --model base --output_format txt \
  --output_dir /tmp/ --fp16 False
```

Extract the **first 1–3 sentences** as the spoken hook. This is the most important signal — it's what the algorithm hears before deciding to distribute.

### 4c. Screenshot — On-Screen Text

```bash
$FFMPEG -i /tmp/spy_video.mp4 -vframes 1 -ss 00:00:01 /tmp/spy_thumb.png -y
```

Use vision to read `/tmp/spy_thumb.png` and extract the on-screen text hook (text overlaid on frame 1, which is shown in the feed before play).

### 4d. Caption Extraction

Extract the first 1–2 sentences of the post caption / video description as the caption hook.

### 4e. Analyze, Classify, Templatize, Score

For each outlier:

**Classify hook type** from the 25-type taxonomy (see below).

**Templatize all three surfaces:**
- Spoken hook → `[BRACKET]` template
- On-screen text → `[BRACKET]` template
- Caption → `[BRACKET]` template

**Write "Why it works"** — 2 sentences max. Name the psychological mechanism (curiosity gap, fear of missing out, identity threat, social proof, specificity bias, etc.).

**Score the hook 0–100** (see Scoring section below).

### 4f. Library Check

Before saving, search `~/.spy/hooks.md` for similar templates (fuzzy match on template structure). If found: note count and average score — "3 similar hooks in your library — avg score 61."

### 4g. Clean Up

```bash
rm -f /tmp/spy_video.mp4 /tmp/spy_video.txt /tmp/spy_thumb.png
```

---

## Hook Scoring (0–100)

Score each hook across four dimensions. Show as a filled bar.

### Specificity (0–25)
- 0–8: Vague ("productivity tips", "how to grow")
- 9–16: Moderate ("5 ways to save time in [TOOL]")
- 17–25: Razor-specific ("3 Claude prompts that saved me 4 hours yesterday")

### Emotional Trigger (0–25)
- 0–8: Neutral / informational
- 9–16: Single trigger (curiosity OR fear OR greed)
- 17–25: Stacked triggers (curiosity + identity threat, fear + hope, etc.)

Trigger types: curiosity gap, fear of loss, greed/gain, surprise/shock, identity affirmation, identity threat, social proof, FOMO, controversy, nostalgia.

### Template Rarity (0–25)
- 0–8: Saturated template (seen in >10 hooks in library)
- 9–16: Moderate use (3–10 matches in library)
- 17–25: Rare or novel (0–2 matches in library)

On first runs when library is empty, default to 20 (assume rare until library fills).

### Platform Fit (0–25)
- 0–8: Format fights the platform (e.g., long text hook on TikTok)
- 9–16: Neutral fit
- 17–25: Purpose-built for platform norms (IG Reels text overlay, TikTok raw energy open, YT thumbnail-bait title hook)

**Display format:**
```
Score: ████████████████░░░░ 82/100
```
Use filled blocks (█) for score ÷ 5, empty blocks (░) for remainder up to 20.

---

## Hook Type Taxonomy — 25 Types

Every outlier must be classified as exactly one primary type. Include in each card.

| # | Type | Signal phrase / pattern |
|---|------|------------------------|
| 1 | **Secret Codes** | "secret codes", "hidden features", "most people don't know" |
| 2 | **Replace + Kill Claim** | "[TOOL] just killed [THING]", "[X] is dead" |
| 3 | **Viewer Callout** | "If you're a [IDENTITY]..." direct address to specific person |
| 4 | **Speed Tutorial** | "In 60 seconds...", rapid-fire steps, time-capped promise |
| 5 | **Framework Reveal** | Named system, acronym, proprietary process |
| 6 | **Contrarian Take** | "Stop doing [COMMON ADVICE]", "Everyone is wrong about [X]" |
| 7 | **Comparison Teardown** | "[X] vs [Y]", side-by-side, "I tried both" |
| 8 | **Fear / Warning** | "This will destroy your [THING]", "The hidden danger of..." |
| 9 | **Controversy / News React** | Reacting to external event, trend, or controversy |
| 10 | **Listicle** | Numbered list as the hook itself ("7 tools that...") |
| 11 | **POV / Meme** | "POV: You just...", meme format, character roleplay |
| 12 | **Raw Energy** | No hook — energy, chaos, or emotion carries first 3 seconds |
| 13 | **Absurd Escalation** | Starts normal, escalates to extreme claim immediately |
| 14 | **Before / After** | Transformation as the hook, result shown first |
| 15 | **Don't Make This Mistake** | Error-based authority opener |
| 16 | **What I Wish I Knew** | Regret framing, hindsight authority |
| 17 | **Day-in-Life** | "Day in my life as a [IDENTITY]" presence/aspiration hook |
| 18 | **Proof Drop** | Screenshot, stat, or result shown at frame 1 |
| 19 | **Tool Discovery** | "I found [TOOL]", "This tool changes everything" |
| 20 | **Credential Opener** | Lead with authority: "I [BIG CLAIM] and here's..." |
| 21 | **Trend Hijack** | Attaches to a trending sound, format, or cultural moment |
| 22 | **Myth Bust** | "The truth about [X]", "What they don't tell you" |
| 23 | **Behind the Scenes** | "Here's exactly how I...", process transparency hook |
| 24 | **Challenge / Dare** | "Try this for 7 days", interactive viewer prompt |
| 25 | **Confession** | "I was wrong about [X]", vulnerability + authority blend |

---

## Step 5 — Save to Hook Library

After processing each outlier, append an entry to `~/.spy/hooks.md`:

```markdown
## [HOOK TYPE] | Score: [N]/100 | [PLATFORM] | [DATE]

- **Handle:** @[handle]
- **Views:** [N] ([Nx] multiplier)
- **URL:** [url]
- **Spoken template:** [BRACKET template]
- **On-screen template:** [BRACKET template]  
- **Caption template:** [BRACKET template]
- **Why it works:** [2-sentence analysis]
- **Score breakdown:** Specificity [N]/25 | Emotion [N]/25 | Rarity [N]/25 | Platform fit [N]/25

---
```

**Library limit:** Max 500 hooks per account handle. If a handle exceeds 500 saved hooks, rotate out the lowest-scored hooks first.

Save run state to `~/.spy/runs/[handle]-[YYYY-MM-DD].json` for delta mode. Overwrite `~/.spy/runs/[handle]-last.json` with same data.

---

## Step 6 — Display Results

### Header

```
╔══════════════════════════════════════════════════════╗
║  SPY REPORT — [N] outliers from [N] accounts        ║
║  Platforms: [list]  |  Niche: [auto-detected]       ║
╚══════════════════════════════════════════════════════╝

Posts scanned: [N]   Outliers found: [N]   Saved to library: [N]
Top hook type this run: [TYPE] ([N] occurrences)
```

### Per-Outlier Card

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#1 — @handle [TikTok] · 4.2M plays · 47x outlier
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SPOKEN HOOK:
"I tried every AI writing tool for 30 days. Three of them
 actually made me money."

ON-SCREEN TEXT:
"30 days. 47 tools. 3 winners."

CAPTION:
"Most AI tools are noise. Here's what actually converted."

TEMPLATES:
  Spoken:    I tried [N] [THINGS] for [TIMEFRAME]. [N] of them [RESULT].
  On-screen: [TIMEFRAME]. [N] [THINGS]. [N] winners.
  Caption:   Most [CATEGORY] are [NEGATIVE]. Here's what actually [POSITIVE RESULT].

TYPE: Proof Drop + Listicle hybrid
WHY:  Specificity (30 days, exact number) collapses skepticism. The word "money"
      activates greed trigger. "Three" implies curation — not a generic list.

SCORE: ████████████████████░░░░ 88/100
       Specificity 23/25 | Emotion 22/25 | Rarity 21/25 | Platform fit 22/25

LIBRARY: 2 similar hooks in your library — avg score 64 (+24 above avg)

🔗 https://www.tiktok.com/@handle/video/xxxxx
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Template Leaderboard (after all cards)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOP TEMPLATES — ranked by combined views
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. I tried [N] [THINGS] for [TIMEFRAME]. [N] of them [RESULT].
   Used by: @handle1, @handle2
   Combined: 6.8M views across 3 posts   Avg score: 85
   Platform: TikTok ✓  YouTube ✓  IG Reels ✓

2. [TOOL] just killed [PROFESSION / WORKFLOW]
   Used by: @handle3, @handle4, @handle5
   Combined: 4.1M views across 4 posts   Avg score: 79
   Platform: TikTok ✓  IG Reels ✓
```

Carousel-safe flag per template:
- CAROUSEL-SAFE: Replace + Kill Claim, Listicle, Framework Reveal, Tool Discovery, Viewer Callout, Comparison Teardown, Don't Make This Mistake, Myth Bust, Proof Drop
- REELS/VIDEO ONLY: POV/Meme, Raw Energy, Speed Tutorial, Trend Hijack, Day-in-Life, Absurd Escalation, Challenge/Dare

---

## Step 7 — Cross-Niche Pattern Detection

After all cards are shown, scan the current run's hooks against the full library. Group templates that appear across multiple handles or detected niches.

Display:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CROSS-NICHE PATTERNS DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TEMPLATE: I [did X] for [N] days. Here's what happened.
Seen in:  AI tools niche, fitness niche, finance niche
Handles:  @handle1, @handle7, @handle12
Verdict:  PLATFORM-AGNOSTIC — works across all 3 major platforms.
          High template rarity score still intact (3 niches, not 30).

TEMPLATE: [TOOL] just killed [THING]
Seen in:  AI tools niche, SaaS niche
Handles:  @handle2, @handle9
Verdict:  NICHE-PORTABLE — tech-adjacent audiences. Not yet saturated in
          service businesses or local niche creators.
```

Only show patterns with 3+ occurrences across distinct handles/niches.

---

## Step 8 — Next Steps

After displaying results, always present options:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEXT STEPS — what do you want to do?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Pick a hook number (1–[N]) → I'll write a full script in your voice right now
2. Save this report to a file (markdown)
3. /spy --delta @handle next week — shows only what's NEW since today
4. /spy --bench @yourhandle @comp1 — see exactly where your gaps are
5. /viral — use these hooks as seeds for your own content ideas
```

**If user picks option 1 (hook number):**

Ask: "Tell me your niche, your product/offer, and your tone of voice in one sentence."

Then write a full short-form video script using that hook template:
- Hook (first 3 seconds — the scraped template adapted to their niche)
- Body (problem → agitation → solution in their voice)
- CTA (specific, matches caption template from the same card)
- On-screen text callouts (timed to body sections)

Format the script with clear time markers: `[0:00]`, `[0:03]`, `[0:15]`, etc.

---

## Delta Mode

**Trigger:** `/spy --delta @handle`

1. Load `~/.spy/runs/[handle]-last.json` — list of previously seen video URLs
2. Run full scrape/outlier detection for the handle
3. Filter outliers to only those NOT in the previous run's URL list
4. Label each new outlier with `NEW` in the card header
5. If zero new outliers: "No new outliers since last run [DATE]. Their top content hasn't changed."
6. Save new run state, overwriting `[handle]-last.json`

Useful cadence: run delta weekly on 3–5 competitor accounts to track what's breaking out in real time.

---

## Benchmark Mode

**Trigger:** `/spy --bench @myhandle @comp1 @comp2`

1. Run full scrape on all handles (your account first)
2. Run outlier detection on all
3. For your account: use the SAME 5x median threshold — your outliers are your winners
4. Build comparison table:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BENCHMARK REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

                  @you      @comp1    @comp2
Median views:     8K        34K       22K
Outlier rate:     1/50      6/50      4/50
Top hook type:    Listicle  Proof Drop  Fear/Warning
Avg hook score:   61        84        78

YOUR GAPS (hook types they use that you don't):
  - Proof Drop: @comp1 has 4 Proof Drop outliers. You have 0 in library.
  - Viewer Callout: @comp2 uses this in 3 outliers. Avg 71K plays. You have 0.

YOUR EDGE (hook types you use that they don't):
  - Framework Reveal: You have 2 outliers. Neither competitor uses this.
    Opportunity: own this type before they find it.
```

---

## Search Mode

**Trigger:** `/spy --search "keyword or hook type"`

Search `~/.spy/hooks.md` for entries matching the query. Match against:
- Hook type name (exact or fuzzy)
- Template text (substring match)
- Platform name
- Date range (e.g., `--search "fear hook last:30d"`)

Display matching hooks as compact cards (spoken template + score + handle + views). No re-scraping or downloading.

---

## Important Rules

- All three platforms (Instagram, TikTok, YouTube) are first-class — no platform gets special treatment
- Apify is optional. Never block on missing Apify. yt-dlp is the core engine.
- Every processed outlier is saved to `~/.spy/hooks.md` automatically — no manual save step
- Direct URL mode requires zero setup beyond the three CLI tools — works immediately
- Always display score bars for every hook — never show a hook without its score
- Never save more than 500 hooks per account handle — rotate lowest-scored on overflow
- Process max 25 outliers per run — take highest view count when trimming
- Always show all three template surfaces: spoken, on-screen, caption
- Detect the content niche automatically from the video content and account patterns
- When library is empty (first run), rarity scores default to 20/25 — adjust as library fills

---

Built by [@mikeoptimax](https://instagram.com/mikeoptimax) — steal faster than your competitors can post.
