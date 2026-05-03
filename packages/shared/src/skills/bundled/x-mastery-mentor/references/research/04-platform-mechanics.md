# X/Twitter Platform Algorithm — Research

> Originally compiled 2026-04-06.
> Coverage: 2023 first open-sourcing → 2026.01 second (Grok) open-sourcing.
> Confidence tags: 🟢 official / open source · 🟡 reputable analysis · 🔴 community inference.

---

## 1. Recommendation architecture evolution

### 1.1 Three-stage pipeline

🟢 [GitHub - twitter/the-algorithm](https://github.com/twitter/the-algorithm) · [GitHub - xai-org/x-algorithm](https://github.com/xai-org/x-algorithm)

| Stage | Function | Implementation |
|-------|----------|----------------|
| **Candidate Sourcing** | Pick ~1,500 candidates from hundreds of millions of posts | in-network (followed) + out-of-network (ML retrieval) |
| **Ranking** | Predict engagement probability and score | Phoenix (Grok transformer model) |
| **Filtering & Blending** | Dedup, diversity, ad insertion | Home Mixer orchestration layer |

### 1.2 Grok takes over (2025.10 → 2026.01 open source)

🟢 [Elon Musk](https://x.com/elonmusk/status/1969081066578149547) · [@XEng](https://x.com/XEng/status/2013471689087086804) · [TechCrunch](https://techcrunch.com/2026/01/20/x-open-sources-its-algorithm-while-facing-a-transparency-fine-and-grok-controversies/) · [Social Media Today](https://www.socialmediatoday.com/news/x-formerly-twitter-switching-to-fully-ai-powered-grok-algorithm/803174/)

Timeline:
- **2025.09** — Musk: "The algorithm will be purely AI by November"; promises bi-weekly open source
- **2025.10** — Grok replaces traditional heuristics
- **2025.11** — Following feed also Grok-ranked
- **2026.01.20** — `xai-org/x-algorithm` released; Rust rewrite

Key changes:
- Scala → **Rust (62.9%) + Python (37.1%)**
- Transformer derived from Grok-1, adapted for recommendation
- Grok "reads every post, watches every video" (~100M items/day)
- Code update cadence promise: every 4 weeks + dev notes

### 1.3 Four core modules (2026 open-source version)

🟢 [README](https://github.com/xai-org/x-algorithm/blob/main/README.md) · [Phoenix README](https://github.com/xai-org/x-algorithm/blob/main/phoenix/README.md) · [DeepWiki](https://deepwiki.com/xai-org/x-algorithm)

| Module | Lang | Function |
|--------|------|----------|
| **Home Mixer** | Rust | Orchestration; gRPC entry; coordinates pipeline |
| **Thunder** | Rust | In-memory post store; consumes Kafka events; sub-ms in-network lookup |
| **Phoenix** | Python/JAX | Grok transformer ranking engine; predicts engagement probability |
| **Candidate Pipeline** | Rust | Reusable framework: Sources → Hydrators → Filters → Scorers → Selector → TopN |

### 1.4 Promptable Feeds

🟡 [WebProNews](https://www.webpronews.com/xs-promptable-algorithm-musks-bid-to-hand-users-the-feed-controls/) · [Social Media Today](https://www.socialmediatoday.com/news/x-formerly-twitter-moving-to-personalized-ai-powered-algorithm/760698/)

Users can adjust their feed via natural language ("Show me more tech innovations, less politics"). Direct consequence of Grok being embedded in the recommender. Announced 2025.09; included in 2026.01 open source.

---

## 2. Engagement weight formula

### 2.1 Exact weights (open source)

🟢 [Open source code](https://github.com/xai-org/x-algorithm) · [Social Media Today](https://www.socialmediatoday.com/news/x-formerly-twitter-open-source-algorithm-ranking-factors/759702/)

X is the only major platform that has open-sourced its recommender algorithm — twice.

| Engagement | Weight | × vs Like | Note |
|------------|--------|-----------|------|
| **Conversation reply** (Reply + author engagement) | +75 | **150×** | Author replies/likes your reply |
| **Reply** | +13.5 | **27×** | Standard reply |
| **Profile click + engagement** | +12.0 | **24×** | User clicks profile → likes/replies |
| **Conversation deep-click** | +11.0 | **22×** | Click into thread → reply or like |
| **Dwell > 2 min** | +10.0 | **20×** | Time spent in conversation/thread |
| **Retweet** | +1.0 | **2×** | RT |
| **Like** | +0.5 | **1×** (baseline) | — |
| **Bookmark** | ~+10 | **~20×** | Community-estimated, not exact |

**Insight:** conversation depth crushes everything. One reply chain that engages the author is worth >150 likes.

⚠️ **Version notes:** 2023 weights differ from 2026. Earlier "Reply 27× / Retweet 40×" came from simplified 2023 calculations. In 2026, **Retweet weight dropped sharply** (~20× → ~2×) and conversation weight grew. This doc reflects 2026.

### 2.2 Negative signals (penalties)

🟢 Open source

| Signal | Penalty |
|--------|---------|
| Report | **−369×** — near-immediate removal |
| Block / Mute / Show Less | **−74×** |

🟡 Media analysis: [posteverywhere.ai](https://posteverywhere.ai/blog/how-the-x-twitter-algorithm-works) · [Tweet Archivist](https://www.tweetarchivist.com/how-twitter-algorithm-works-2025)

| Signal | Effect |
|--------|--------|
| External link | Reach −30 to −50%; non-Premium link posts → median engagement = 0 since 2025.03 |
| >2 hashtags | Reach −~40%; spam flag |
| Repeated content / links | Gradual deboost; severe → shadowban |

---

## 3. Premium subscription boost

### 3.1 Algorithm boost multipliers

🟢 Open source

| Surface | Premium boost |
|---------|---------------|
| In-network (followers' feed) | **4×** |
| Out-of-network (non-followers' feed) | **2×** |

### 3.2 Real-world effect

🟡 [Buffer (18.8M-post analysis)](https://buffer.com/resources/data-best-content-format-social-media/) · [Circleboom](https://blog-content.circleboom.com/does-x-premium-boost-algorithm/)

- Premium accounts reach ~10× per post vs non-Premium
- Premium+ widened the gap further post-2025
- Premium replies rank ~30–40% higher in popular thread visibility (Q1 2026)
- Non-Premium link posts → median engagement 0 (since March 2026)

### 3.3 TweepCred & Premium

Premium subscribers get instant **+100 TweepCred**. New non-Premium account starts at −128; Premium new account effectively starts at −28 — drastically shorter cold-start period.

---

## 4. TweepCred — account credibility score

🟢 TweepCred module in open-source code.

### 4.1 Mechanics
- Range: **−128 to +100**
- New account: **−128**
- Normal-distribution threshold: **+17** (below = throttled)
- Premium: **+100 instant**

### 4.2 Influencing factors

🟡 Community reverse engineering ([Circleboom](https://circleboom.com/blog/tweepcred-what-it-is-why-it-matters-and-how-to-increase-your-score-on-x-twitter/) · [Radaar](https://www.radaar.io/resources-121/blog-388/are-you-ready-to-discover-the-hidden-x-algorithm-secrets-behind-tweepcred-shadow-hierarchy-and-dwell-time-in-2025-15361/))

PageRank-like composite:

| Factor | Direction |
|--------|-----------|
| Follow-to-follower ratio | Following ≫ followers → negative |
| Engagement quality | High-quality conversation → positive |
| Account history | Old account + consistent behavior → positive |
| Tweet language + bio | Complete profile → positive |
| Post-style consistency | Sudden change → negative |
| **Grok tone score (2025 new)** | Constructive content → positive |

⚠️ **2025 change:** Grok now scores each post's **sentiment**; positive/constructive content gets more distribution.

---

## 5. Content-type treatment

### 5.1 Text vs video — does X really favor text?

🟡 [Buffer (45M+ post analysis)](https://buffer.com/resources/data-best-content-format-social-media/)

Reality is mixed:

| Source | Conclusion |
|--------|------------|
| Buffer 2025–26 data | Text median engagement (0.48%) slightly above video |
| Many SEO/marketing analyses | Native video gets ~10× more engagement + algorithmic preference |
| 2026 social-media report | User preference: short video 37% / text 36% — near-tied |

Most accurate: X is the major platform where **text comes closest to (or beats) video** — but not "text crushes video." Algorithmically, native video gets distribution boost; in actual engagement rate, top text posts compete head-to-head.

### 5.2 Per-type algorithm preference

| Type | Treatment |
|------|-----------|
| Pure text | Most reliably high engagement, especially for conversation |
| Native video (<2:20) | Distribution boost; completion rate is the key signal |
| Image post | Increases dwell time → positive |
| External link | ⚠️ 30–50% reach penalty; near-invisible non-Premium |
| Quote tweet | Higher weight than plain RT |
| Thread | Engagement compounds across tweets — strong overall |

---

## 6. Critical time windows

### 6.1 Golden 30 minutes (Engagement Velocity)

🟡 Multi-source consensus.

- First **30 minutes** decide whether the algorithm pushes you into a larger pool
- Broader **first 2 hours** also matters
- **Velocity > volume** — 100 likes in 10 min beats 500 likes over 3 days
- Algorithm logic: early engagement = quality stamp

### 6.2 Dwell time

🟢 Open-source weight definition.

- Dwell >2 min = +10 (~20× Like)
- Short dwell = low quality → suppressed
- Implication: long, **finishable** posts beat thumb-stopping skims

### 6.3 Best posting times

🟡 Buffer (1M-post analysis) · Sprout Social · SocialPilot (50K accounts)

| Dimension | Recommendation |
|-----------|----------------|
| Best window | Weekdays 9 AM – 2 PM local; secondary 12 PM – 6 PM |
| Best days | Tue / Wed / Thu (Tue best) |
| Worst day | Saturday |
| Frequency | **3–5 posts/day**, 2–3h spacing |
| Above 5/day | Growth slows |
| Below 1/day | Growth materially insufficient |

⚠️ Above is global English-audience data. Adjust by your audience timezone.

---

## 7. Shadowban

### 7.1 Four types

🟡 [Pixelscan](https://pixelscan.net/blog/twitter-shadowban-2025-guide/) · [Tweet Archivist](https://www.tweetarchivist.com/twitter-shadowban-complete-guide-2025) · [Multilogin](https://multilogin.com/blog/twitter-shadow-bans/)

| Type | Symptom |
|------|---------|
| Search Suggestion Ban | Username doesn't autocomplete in search |
| Search Ban | Posts don't appear in search results |
| Ghost Ban | Replies invisible to others |
| Reply Deboosting | Replies hidden behind "Show more replies" |

### 7.2 Triggers

| Behavior | Risk |
|----------|------|
| Mass follow/unfollow in short windows | 🔴 high (mass-unfollow can trigger 3-month shadowban) |
| 200+ likes in 1 hour | 🔴 high (auto-detect) |
| Mass-replying to people you don't follow | 🟡 medium |
| Repeating same link/hashtag | 🟡 medium |
| Suspicious 3rd-party tools | 🔴 high |
| Content getting mass-reported | 🔴 high (−369× penalty) |

### 7.3 Detection

- Online: [shadowban.yuzurisa.com](https://shadowban.yuzurisa.com/) — checks all 4 restriction types
- Manual: ask non-followers to search you / find your reply

### 7.4 Recovery

1. **Stop immediately** (full stop, not gradual)
2. Delete repetitive, low-quality, link-/hashtag-heavy posts
3. Revoke suspicious 3rd-party app authorizations
4. **Wait 48–72h** — auto-shadowbans typically lift in this window
5. Full recovery: **2–14 days**
6. During recovery: post normally, low-frequency, high-quality

---

## 8. Ads vs organic

### 8.1 Performance

🟡 [WebFX](https://www.webfx.com/blog/social-media/x-twitter-marketing-benchmarks/) · [Avenue Z](https://avenuez.com/blog/2025-2026-x-twitter-organic-social-media-guide-for-brands/)

| Metric | Paid | Organic |
|--------|------|---------|
| Avg CTR | 1–3% | 0.5–1.5% |
| Premium reach vs non-Premium | — | ~10× |
| Non-Premium link-post engagement | — | 0 (since 2026.03) |

### 8.2 Findings

- Paid and organic algorithms run **independently** — no "spend money → organic gets penalized" trap
- Structural trend: organic reach declining (cross-platform, not just X)
- Followers gained via ads **do influence** subsequent organic post performance (more in-network distribution)
- Premium subscription is essentially the **lowest-cost ad buy**: 4×/2× visibility boost beats equivalent-priced ads

---

## 9. Community Notes impact

### 9.1 Effect on post performance

🟢 [University of Washington study (2025.09)](https://www.washington.edu/news/2025/09/18/community-notes-x-false-information-viral/)

| Metric | Change after Community Note |
|--------|------------------------------|
| Retweets | **−46%** |
| Likes | **−44%** |
| Views | Small effect (feed algo doesn't actively deboost noted posts) |

### 9.2 Detail

- X does **not** actively reduce distribution of noted posts at the algorithm level
- Drop comes from **user-behavior change** — readers see Note → fewer RT/likes
- **Timing matters** — Notes added after 48h have nearly zero effect (content already traveled)
- Notes most effective on **manipulated media** (fake photo/video)

### 9.3 Implications for creators

🔴 Strategy:
- For factual claims that may attract debate, cite sources
- Notes don't directly cut algorithmic weight, but they cut engagement in half
- Noted posts hold view counts but virality is gutted
- Constructive, sourced content rarely gets noted

---

## 10. Core implications for creators

### 10.1 Optimization priorities (by ROI)

| Priority | Strategy | Basis |
|----------|----------|-------|
| **P0** | Provoke conversation; reply to every comment | 150× weight |
| **P0** | Subscribe to Premium | 4×/2× visibility + TweepCred boost + link-post visibility |
| **P1** | First-30-min engagement burst | Velocity decides distribution |
| **P1** | Write content people stop and read | Dwell 20× |
| **P2** | Post weekdays 9 AM – 2 PM | Validated best window |
| **P2** | Avoid external links (or put in reply) | 30–50% reach penalty |
| **P3** | Constructive, positive tone | Grok tone score |
| **P3** | Hashtags ≤2 | >2 = spam signal |

### 10.2 Hard "don'ts"

| Behavior | Consequence |
|----------|-------------|
| Mass follow/unfollow | 3-month shadowban |
| Automated engagement tools | Permanent reputation damage |
| Frequent external links (non-Premium) | Posts near-invisible |
| Posts that get reported | −369× — content disappears |
| Sudden change in posting pattern | TweepCred falls |

### 10.3 X's unique advantages

- Only major platform to open-source its algorithm twice → optimization is precise
- Text-friendly — doesn't force you to do video
- Conversation-driven — depth is genuinely rewarded
- Promptable Feeds — high-quality vertical content has long-tail value

---

## Source index

**Official / primary:**
- github.com/xai-org/x-algorithm (2026.01 Grok-era source)
- github.com/twitter/the-algorithm (2023 first open source)
- x.com/elonmusk/status/1969081066578149547 (algorithm-goes-AI announcement)
- x.com/XEng/status/2013471689087086804 (open-source announcement)

**Reputable media:**
- techcrunch.com/2026/01/20/x-open-sources-its-algorithm-while-facing-a-transparency-fine-and-grok-controversies/
- socialmediatoday.com/news/x-formerly-twitter-open-source-algorithm-ranking-factors/759702/
- socialmediatoday.com/news/x-formerly-twitter-switching-to-fully-ai-powered-grok-algorithm/803174/

**Data analysis:**
- buffer.com/resources/data-best-content-format-social-media/ (45M+ posts)
- buffer.com/resources/best-time-to-post-on-twitter-x/ (1M posts)
- sproutsocial.com/insights/twitter-algorithm/
- washington.edu/news/2025/09/18/community-notes-x-false-information-viral/

**Community deep dives:**
- posteverywhere.ai/blog/how-the-x-twitter-algorithm-works
- typefully.com/blog/x-algorithm-open-source
- circleboom.com/blog/tweepcred-what-it-is-why-it-matters-and-how-to-increase-your-score-on-x-twitter/
- nibzard.github.io/twitter-algorithm-tufte/
- blog.bytebytego.com/p/the-algorithm-that-powers-your-x
- pixelscan.net/blog/twitter-shadowban-2025-guide/
- deepwiki.com/xai-org/x-algorithm

---

*Translated from the original Chinese reference at https://github.com/alchaincyf/x-mentor-skill/tree/master/references*
