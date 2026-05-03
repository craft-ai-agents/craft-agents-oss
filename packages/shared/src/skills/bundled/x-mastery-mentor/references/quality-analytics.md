# Quality Checklist + Anti-Patterns + Data Retro + Report Template

> Load on demand: Scenario C (content review), Scenario E (account diagnostic), data retro.

---

## Quality checklist

When reviewing already-written tweets / threads, run each item:

### Tweet check
- [ ] Does the hook grab attention within 2 lines?
- [ ] Does it answer "who is it for / what's it about / why should I read"?
- [ ] Is it specific? (numbers, time, names)
- [ ] Will it provoke replies? (not just likes)
- [ ] No external links? (if you must include one, put it in the first reply)
- [ ] Is the post time within target audience's active window?

### Thread check
- [ ] Does the first tweet stand alone and pull the reader in?
- [ ] Does it follow the 1/3/1 rhythm?
- [ ] Does each tweet advance the content? (Rate of Revelation)
- [ ] Is there a TL;DR summary?
- [ ] Is there an explicit CTA?
- [ ] Length within 8-12 tweets?
- [ ] Bullet points instead of long paragraphs?

### Content strategy check
- [ ] At least 1 thread this week?
- [ ] Quality replies in large-account comment sections?
- [ ] CTA driving newsletter sign-ups?
- [ ] Responded to this week's AI hot topic?
- [ ] Reasonable mix of short tweets and threads?

---

## Anti-patterns and pitfalls

### Growth traps (don't fall into these)

1. **Buying followers / engagement-pod groups** — short-term metrics look good; long-term TweepCred crashes. The algorithm detects unnatural engagement patterns and deboosts. Net negative.
2. **Pure "AI tool roundup" posts** — the AI niche is already saturated. "10 AI tools you need" is everywhere. Zero differentiation. If you must do it, add your real testing data and a unique opinion.
3. **Just translating foreign AI news** — zero differentiation. If you do this, add YOUR take — "why this matters for Chinese developers" or "I tested it; the actual result was..."
4. **Hot-take-chasing at the cost of positioning** — if you chase every hot take, your audience can't tell what you're about. Filter hot takes: only respond to ones aligned with your positioning.
5. **All hook, no substance** — clickbait works short-term, kills retention long-term. Hormozi: "over-deliver." Promise one thing, give three.
6. **Posting and ghosting** — conversation weight is 150×. Not replying = giving up the biggest algorithmic lever you have.
7. **Threads too long** — past 15 tweets, drop-off accelerates. Sweet spot is 8-12.

### Platform-level risks (stay alert)

- **Engagement-rate decline overall:** X-wide engagement dropped 48% across 2024-2025. Not your problem — platform trend.
- **Pay-to-play intensifying:** non-Premium organic reach is shrinking; external-link posts are near-dead. Premium is no longer optional — it's required.
- **User migration:** some creators are diversifying to Bluesky / Threads. But X is still the main battlefield for AI/tech content.

---

## Data retrospective

### Key metrics (priority order)

| Metric | What it shows | Healthy range |
|--------|---------------|---------------|
| Engagement Rate | Engagements / impressions | >2% good, >5% excellent |
| Reply rate | Replies / impressions | Higher = better (algorithm weights this most) |
| Profile Visit rate | Profile views / impressions | >1% means people want to know more about you |
| Follower growth | Net new followers per week | Cold start: ~5-10/day; growth: 20-50/day |
| Bookmark rate | Bookmarks / impressions | High bookmarks = high-value content |
| Newsletter funnel | New subscribers per week | Any is good. Track conversion rate over time. |

### Retro cadence

- **Daily:** scan yesterday's content; flag any post >500 engagements as "high performer"
- **Weekly:** analyze top 3 tweets of the week; extract commonalities → update template library
- **Monthly:** review follower growth curve, content type distribution, newsletter growth. Adjust next month's content strategy.

### Diagnostic framework (when tweet data is poor)

Investigate in this order:
1. **Algorithm layer:** Premium on? Right posting time? External link present?
2. **Hook layer:** Curiosity gap in first 2 lines? Credibility anchor? Specificity?
3. **Content layer:** Does each tweet advance? 1/3/1 rhythm?
4. **Audience layer:** Enough followers to trigger Engagement Velocity? If not, borrow traffic via comment sections first.

---

## HTML report template requirements

Diagnostic reports use an Economist / newspaper layout. Must include:

- **Visual style:** serif font (Georgia), warm paper background (#f5f0e8), red accent (#C7000A), grid layout
- **Data visualization:** ECharts.js (CDN). At minimum: topic distribution chart, time distribution chart, engagement funnel
- **Required sections:**
  1. Banner + Masthead (one-line core finding as the headline)
  2. KPI Grid (4 core metrics as large numbers)
  3. Lead (summary paragraph, italics, left red border)
  4. Content ROI analysis (engagement comparison by topic)
  5. Reach funnel (like rate / bookmark rate / retweet rate / reply rate)
  6. Time analysis (best posting windows, posting cadence evolution)
  7. Brand narrative (narrative-role distribution and engagement performance)
  8. Top 5 action recommendations (numbered red circles + headline + body + supporting data)
  9. Footer (data range, sample size, analysis date)
- **Reference implementation:** `user-data/AlchainHust/report_20260406.html`

---

*Translated from the original Chinese reference in https://github.com/alchaincyf/x-mentor-skill/tree/master/references*
