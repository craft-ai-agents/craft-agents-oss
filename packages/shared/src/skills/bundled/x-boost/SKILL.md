---
name: x-boost
description: "When the user wants to write, optimize, or diagnose posts for X/Twitter using algorithm mechanics. Also use when they say 'tweet,' 'X post,' 'Twitter,' 'why didn't my post do well,' 'how to get reach on X,' 'optimize this tweet,' 'thread engagement,' 'X algorithm,' 'why am I shadowbanned,' 'dwell time,' 'in-network reach,' or anything about boosting individual post performance on X. Covers the 19 engagement signals, negative signals that kill reach, author decay penalty, and posting cadence."
tags: [marketing, social-media, twitter, x, algorithm, engagement]
metadata:
  source: https://github.com/guzus/go-viral
---

# X Post Optimizer

Helps craft posts optimized for the X recommendation algorithm based on open-source algorithm analysis.

## How the Algorithm Scores Posts

The algorithm predicts **19 engagement actions** and combines them:

**Positive signals (boost reach):**
- Likes, Replies, Retweets, Quotes
- Dwell time (time spent reading)
- Profile clicks, Follows from post
- Shares (DM, copy link)
- Video quality views, Photo expands

**Negative signals (kill reach):**
- "Not interested" clicks
- Blocks, Mutes, Reports

## Instructions

When asked to optimize a post or write for X:

### 1. Hook First
- Lead with the most compelling point
- Stop the scroll in first 5 words
- Use pattern interrupts

### 2. Maximize Dwell Time
- Add depth that rewards reading
- Use line breaks for scanability
- Include images/videos that make people pause

### 3. Encourage Replies
- End with questions
- Make takes that invite discussion
- Leave threads open-ended

### 4. Avoid Author Penalty
The algorithm applies exponential decay to rapid posts from same author:
```
score = base_score × decay^(post_count)
```
**Recommendation:** Space posts 2-4 hours apart for maximum individual reach.

### 5. Leverage In-Network Advantage
Posts to followers rank higher than discovery posts. Build genuine following over chasing virality.

## Quick Checklist

When reviewing a draft post, check:

- [ ] Hook in first line?
- [ ] Rewards reading (dwell time)?
- [ ] Invites replies?
- [ ] No spam/repetitive content?
- [ ] Authentic voice (not engagement bait)?
- [ ] Appropriate timing from last post?

## What Doesn't Work

- Engagement pods (artificial patterns detected)
- Keyword stuffing (algorithm learns behavior, not keywords)
- Rapid-fire posting (author diversity penalty)
- Controversial content that triggers blocks/mutes

## Example Optimization

**Before:**
```
Just launched my new product! Check it out at example.com
```

**After:**
```
I spent 6 months building something I wish existed 3 years ago.

The problem: [specific pain point]
The solution: [what you built]

Here's what surprised me most about the process:

[insight that invites discussion]

What's been your experience with [related topic]?
```

**Why it's better:**
- Hook creates curiosity (dwell time)
- Structure rewards reading
- Ends with question (replies)
- Authentic story (avoids mute/block signals)
