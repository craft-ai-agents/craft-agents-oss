# SNATCH-EM — Tactical Frameworks

Reference document for the operational playbooks used by the `snatch-em` skill.

## 1. Medium-Specific Threshold Templates

### Twitter / X (3-second scroll decision)

**Autopilot Pattern:**
1. Thumb scrolls
2. First 5-7 words scanned in ~300ms
3. Brain predicts content type from pattern (listicle, opinion, thread, promo)
4. Decision: engage (like/retweet/reply) or scroll

**Threshold Architecture:**
- **Frame 1 (0-0.5s):** First 5 words must create prediction error
- **Frame 2 (0.5-1.5s):** Next phrase must open a loop that requires reading to the end
- **Frame 3 (1.5-3s):** A social frame violation or tonal dissonance that makes the brain say "this doesn't belong here"

**Template A: The Inversion Drop**
> "[Expected thing]. [Unexpected reversal]. [Open loop]."
> Example: "My company hit $1M ARR yesterday. I almost quit 6 months ago. The reason is illegal to discuss publicly."

**Template B: The Confession Drop**
> "[Socially unacceptable admission]. [Specific detail]. [Open loop about consequence]."
> Example: "I steal my competitors' best employees. Not by offering more money. By sending them a single email at 2am."

**Template C: The Temporal Drop**
> "[Countdown / deadline]. [Personal stake]. [Mystery]."
> Example: "48 hours from now, I'll be unemployed. By choice. The project I'm launching has no business model."

**Template D: The Pattern Break Drop**
> "[Expected format broken]. [Unexpected format]. [Content that justifies the break]."
> Example: "This tweet has no call to action. No thread. No link. Just a fact: 73% of what you believe about your industry is wrong. I have the data."

**Forbidden Twitter Openings (NES < 20):**
- "Here are 5 things..."
- "Thread 🧵"
- "Hot take:"
- "Unpopular opinion:"
- "Let me explain..."
- "I wrote about..."
- "ICYMI"
- "[Thread]"
- "Tip of the day:"
- "Did you know..."

---

### Landing Page Hero (1-3 seconds, viewport 1)

**Autopilot Pattern:**
1. Page loads → brain scans for "what is this?" 
2. Headline processed in ~1.5s
3. Subhead + visual processed in next 1.5s
4. Brain decides: "this is [category I know]" or "this is different"
5. If category match = autopilot = bounce

**Threshold Architecture:**
- **Frame 1 (0-1s):** Visual must contradict text OR text must contradict category
- **Frame 2 (1-2.5s):** Headline must create prediction error (not problem/solution)
- **Frame 3 (2.5-4s):** Subhead must open a loop that the visual deepens

**Template A: The Category Violation**
> Visual: Peaceful, domestic scene
> Headline: "Your retirement plan is a death sentence."
> Subhead: "The 4% rule was invented in 1994. The market has changed. Your advisor hasn't told you because they don't know."

**Template B: The Inversion Hero**
> Headline: "The best time to start was yesterday. The second best time is never."
> Subhead: "Most business advice is written by people who never started one. Here's what 14 failed founders wish they'd known."
> Visual: A crumpled business plan on a desk, shot from above. No people. No success imagery.

**Template C: The Question That Shouldn't Be Asked**
> Headline: "What if your product is the problem?"
> Subhead: "We helped 200 companies grow by teaching them to sell less. Not more. Here's the counterintuitive framework."
> Visual: A graph line going down, labeled "Sales." Next to it, a line going up, labeled "Profit."

**Template D: The Absence Drop**
> Headline: "[Single word, large]"
> Subhead: "Everything else on this page is an explanation. But you already know if this is for you."
> Visual: Solid color. No image. No texture.

**Forbidden Landing Page Openings (NES < 15):**
- "The all-in-one platform for..."
- "Streamline your..."
- "The easiest way to..."
- "[Product name] helps you..."
- "Trusted by [number] companies"
- Any headline that can be guessed from the URL alone

---

### TikTok / Short-Form Video (first frame + first 1 second)

**Autopilot Pattern:**
1. Thumb scrolls
2. First frame processed in ~200ms
3. Audio processed in parallel
4. Brain predicts: "trending sound?" / "familiar face?" / "expected format?"
5. If prediction matches = scroll

**Threshold Architecture:**
- **Frame 1 (0-0.3s):** Visual must be unprocessable without context (extreme close-up, abstract texture, negative space)
- **Frame 2 (0.3-1s):** Audio must violate platform grammar (no beat, no voice, wrong genre, sustained tone)
- **Frame 3 (1-3s):** First cut or first word must open a loop that the visual/audio deepens

**Template A: The Silence Drop**
> Frame 1: Black screen. 1.5 seconds.
> Frame 2: A hand enters frame, turns on a light. Voice: "I need to tell you something. But first, I need you to understand why I couldn't tell anyone else."
> Audio: Room tone. No music. No beat.

**Template B: The Scale Violation**
> Frame 1: Macro shot of a drop of liquid falling. Slow motion.
> Audio: A voice counting backwards from 10. But the voice is a child's voice, and it's crying.
> Frame 2 at 1.5s: Cut to wide shot. It's a raindrop. The child is standing in a field. Alone.

**Template C: The Genre Collision**
> Frame 1: Horror movie color grade. Dark. Red highlights.
> Audio: Upbeat 1950s doo-wop music.
> Text overlay at 0.8s: "This is a video about compound interest."

**Template D: The Processing Delay**
> Frame 1: A face looking directly at camera. No expression. 3 seconds.
> Frame 2: The face smiles. But the smile doesn't reach the eyes.
> Voice at 3.5s: "I'm going to show you how I made $40,000 last month. But first, I'm going to tell you why it almost killed me."

**Forbidden TikTok Openings (NES < 25):**
- Pointing at text overlay
- "POV:"
- "3 things I wish I knew..."
- Trending sound with expected visual
- "Wait for it..."
- "This changed my life..."
- Any format the viewer has seen 50+ times

---

### Speech / Presentation (first 10 seconds, first sentence)

**Autopilot Pattern:**
1. Audience settles, checks phone, evaluates room
2. Speaker introduced. Brain assigns expected role.
3. First sentence processed. Brain matches to genre (informative / motivational / sales / academic)
4. If genre match = phone check / tune out

**Threshold Architecture:**
- **Frame 1 (0-3s):** Speaker does not begin speaking. Or begins with action that contradicts role.
- **Frame 2 (3-7s):** First sentence must violate the genre contract.
- **Frame 3 (7-12s):** Second sentence must open a loop that the audience cannot close without staying.

**Template A: The Apology Drop**
> [Walk to podium. Stand in silence for 4 seconds. Look at audience.]
> "I was asked to talk about leadership. Instead, I'm going to tell you about the worst decision I ever made. And how it killed someone."
> [Pause 3 seconds.]
> "Not metaphorically."

**Template B: The Refusal Drop**
> [Walk to center stage. No slides. No notes.]
> "I don't have a presentation. I have a question. And I need you to answer it before I say another word."
> [Pause. Look at one person.]
> "When was the last time you did something at work that you were genuinely afraid would get you fired?"

**Template C: The Detail Drop**
> [Begin speaking immediately as mic is handed over. No introduction acknowledgment.]
> "Tuesday. 4:47pm. Conference room B. I was the only one who said no. And I was the only one who was right. But being right cost me $200,000 and three friendships."

**Template D: The Paradox Drop**
> [Walk to edge of stage. Sit down on the edge. Not on the stool.]
> "I am going to teach you how to be successful. The first lesson is: everything I'm about to tell you is wrong. The second lesson is: you're going to try it anyway. The third lesson is: that's why you'll fail."

**Forbidden Speech Openings (NES < 10):**
- "Thank you for having me..."
- "It's great to be here..."
- "Today I'm going to talk about..."
- "Let me start with a story..."
- Any opening that could be delivered by any speaker at any conference

---

### Email Subject + Preview (inbox scan, ~1 second)

**Autopilot Pattern:**
1. Scan sender name
2. Scan subject line
3. Scan preview text
4. Brain decides: known/safe, unknown/interesting, or spam/ignore
5. If subject matches expected pattern for sender = archive or delete

**Threshold Architecture:**
- **Frame 1 (0-0.3s):** Sender name must be either hyper-familiar or unexpected
- **Frame 2 (0.3-0.7s):** Subject must create prediction error in 3-7 words
- **Frame 3 (0.7-1s):** Preview text must violate the promise of the subject line (open a deeper loop)

**Template A: The Accusation Drop**
> Subject: "You were right"
> Preview: "About the thing you said in the meeting. I checked the data. You were right. And that's the problem."

**Template B: The Refusal Drop**
> Subject: "I'm not sending the report"
> Preview: "Not because it's not ready. Because I think you should read something else first. This changes the entire project."

**Template C: The Countdown Drop**
> Subject: "72 hours"
> Preview: "That's how long until the contract expires. But that's not why I'm emailing. I'm emailing because in 71 hours, your competitor will know something you don't."

**Template D: The Personal Drop**
> Subject: "I need to tell you something"
> Preview: "Not about work. About you. Specifically, the thing you do in meetings that nobody has the courage to name."

**Forbidden Email Openings (NES < 15):**
- "Weekly Newsletter"
- "[Number] tips for..."
- "Introducing..."
- "Don't miss..."
- "Last chance..."
- "Update on..."
- Any subject line that summarizes the email's content

---

### Song / Lyric (first line, first chord, first 3 seconds)

**Autopilot Pattern:**
1. Identify genre from production/instrumentation in first 1-2 seconds
2. Match to mental playlist ("this sounds like X")
3. Predict chord progression / lyrical theme
4. If prediction confirmed = comfortable = potentially forgettable

**Threshold Architecture:**
- **Frame 1 (0-1s):** First chord or first production choice must violate genre expectation
- **Frame 2 (1-3s):** First lyric must introduce a conceptual or emotional dissonance
- **Frame 3 (3-8s):** The contradiction must deepen, not resolve

**Template A: The Sacred/Profane Drop**
> First chord: Major 7th (unexpected warmth)
> First line: "I met God in a Walmart parking lot. He was buying cigarettes."
> Second line: "I didn't ask what kind. I asked if He was happy. He said no."

**Template B: The Temporal Drop**
> First chord: Dissonant cluster, held for 4 seconds, no resolution
> First line: "This song is about the summer of 1987. I wasn't born until 1994."
> Second line: "But my mother was there. And she never came back the same."

**Template C: The Instruction Drop**
> Production: Silence for 2 seconds. Then a single voice, no reverb, no music.
> First line: "Stop listening to this song."
> [2 seconds silence]
> Second line: "You didn't stop. That's the first sign."

**Template D: The Inventory Drop**
> First chord: Standard I-IV-V. Comforting. Expected.
> First line: "I have a list of everyone I've ever loved. It's shorter than the list of everyone I've ever hurt."
> Second line: "The overlap is the problem."

**Forbidden Song Openings (NES < 20):**
- "I remember when..."
- "You and I..."
- "In the dark / In the night / In my heart"
- "Baby, I..."
- Any first line that could be guessed from the genre

---

### Physical Presence / Room Entry (first 3 seconds of encounter)

**Autopilot Pattern:**
1. Scan for social role (authority, peer, subordinate, outsider)
2. Match behavior to role expectation
3. Assign status
4. Decide engagement level

**Threshold Architecture:**
- **Frame 1 (0-1s):** Entrance must violate the expected kinetic pattern of the space
- **Frame 2 (1-3s):** First action must contradict assigned role or social script
- **Frame 3 (3-7s):** A sustained behavior that the room cannot categorize

**Template A: The Stillness Drop**
> Enter room. Walk to center. Stop. Stand completely still for 5 seconds. Look at one person. Then speak.
> This breaks the kinetic flow of every social space. The brain cannot process stillness in motion contexts.

**Template B: The Intimacy Drop**
> Enter room. Walk directly to the most powerful person. Stand 18 inches away (violating personal space). Say: "I need to tell you something before anyone else hears it."
> This violates social distancing norms and creates conspiracy/intimacy in seconds.

**Template C: The Silence Drop**
> Enter room. Do not greet anyone. Do not scan the room. Walk to a wall. Face it. Stand there for 10 seconds. Then turn around and begin speaking.
> The room cannot categorize this behavior. Is the person upset? Praying? Insane? The uncertainty demands attention.

**Template D: The Service Drop**
> Enter room. Before anyone greets you, begin doing something for the room (adjusting a chair, pouring water, closing a window). Do this for 30 seconds without speaking. Then introduce yourself.
> This violates the "guest is served" script and creates confusion about status.

**Forbidden Physical Entries (NES < 15):**
- Standard handshake + name + title
- Scanning room while smiling
- Heading to bar / familiar face immediately
- Any entrance that follows the expected script for the context

---

## 2. Prediction Error Engineering

### The Prediction Error Formula
Prediction Error = |Expected - Actual| × Personal Relevance × Time Pressure

**Expected:** What the brain predicts in the first 500ms based on medium, genre, platform, sender, context
**Actual:** What is delivered
**Personal Relevance:** Does the error matter to the viewer's identity/survival/status?
**Time Pressure:** Is there a countdown, deadline, or irreversible moment?

### Prediction Error Calibration by Medium

| Medium | Safe +RPE | Dangerous +RPE | Safe -RPE | Dangerous -RPE |
|--------|-----------|----------------|-----------|----------------|
| Twitter | Unexpected wit, generosity, beauty | Shocking content without context | Mild threat to ego, status | Explicit harm, trauma without warning |
| Landing Page | Unexpected visual, inverted value prop | Bait-and-switch on product | "You're losing without knowing" | Shaming the visitor |
| TikTok | Genre collision, production quality | Fake vulnerability, manufactured crisis | Real stakes, real failure | Gore, trauma, unconsented exposure |
| Speech | Unexpected humility, confession | Stunt without substance | Challenging audience's self-image | Attacking individuals |
| Song | Unusual chord, unexpected lyric | Gimmick without follow-through | Emotional rawness | Shock lyrics without artistry |
| Email | Unexpected sender, inverted subject | Clickbait | Urgency with real stakes | False urgency, manufactured panic |
| Physical | Unexpected stillness, service | Costume without behavior | Direct intimacy | Violation of physical boundaries |

### The Prediction Error Test
Ask: "If I described this opening to someone who hasn't seen it, would they guess the next 3 seconds?"
- If yes → 0 RPE. Brain's prediction was correct. Death.
- If no, but they don't care → Low relevance. Weak RPE.
- If no, and they need to know → Strong RPE. Hijack.

---

## 3. Open Loop Construction Manual

### The Loop Taxonomy

**Narrative Loop:** "I made a decision that cost me everything." (What decision? What did it cost?)
**Temporal Loop:** "In 48 hours, this will be irrelevant." (What will be irrelevant? Why 48 hours?)
**Conceptual Loop:** "The opposite of what you believe is closer to the truth." (What do I believe? What is the opposite?)
**Emotional Loop:** "I am terrified, and I don't know why." (Why are you terrified? What triggered it?)
**Identity Loop:** "You're not who you think you are at work." (Who do I think I am? Who am I actually?)
**Social Loop:** "Everyone in this room knows something you don't." (What do they know?)

### Loop Sustenance Rules
- A loop closed in <10 seconds is not a loop. It is a setup/punchline.
- A loop sustained for 30-60 seconds becomes compelling.
- A loop sustained for the entire piece becomes an obsession.
- Multiple parallel loops that interact create a "loop web" — the audience cannot escape because resolving one deepens another.

### Loop Web Example (Landing Page)
> Loop 1 (Identity): "You're not who you think you are at work."
> Loop 2 (Temporal): "This truth has a deadline."
> Loop 3 (Narrative): "I discovered it by accident. In a bathroom. At 2am."
> Loop 4 (Conceptual): "The opposite of productivity is not laziness."

Resolving Loop 1 requires engaging with Loop 4. Resolving Loop 4 reveals Loop 2's urgency. Resolving Loop 2 triggers Loop 3's narrative curiosity. The loops are not sequential. They are **interdependent**.

---

## 4. Pattern Interrupt Protocols

### The Ericksonian Precision Test
A pattern interrupt is not random chaos. It is **precise violation of a specific expected pattern**. Ask:
1. What exact pattern did the brain expect?
2. What exact element was violated?
3. At what exact moment?
4. What is the 3-second window created?
5. What fills that window?

**Weak interrupt:** Random shocking statement
**Strong interrupt:** A statement that precisely violates the grammar of the specific medium at the exact moment the brain expects to confirm its prediction

### Platform Grammar Violations

| Platform | Grammar Rule | Violation |
|----------|-------------|-----------|
| Twitter | Start with claim or observation | Start with action or question that implies a story already in progress |
| LinkedIn | Professional context, career framing | Raw personal confession without career wrapper |
| Instagram | Visual-first, aesthetic perfection | Deliberate imperfection, raw texture, absence of filter |
| TikTok | Fast cuts, high energy, trending audio | Sustained stillness, silence, anti-trend audio |
| Landing Page | Problem → Solution → CTA | Threat → Mystery → No CTA in hero |
| Email | Subject summarizes content | Subject contradicts preview text |
| Speech | Introduction → Agenda → Content | Refusal → Silence → Disruption |
| Song | Verse → Chorus | Dissonance → Silence → Return to dissonance |

---

## 5. Dissonance Sustenance Techniques

### The Unresolved Chord Principle
In music, a dissonant chord that resolves immediately is forgettable. A dissonant chord that is **sustained** creates obsessive attention. The same applies to every medium.

**Sustenance Techniques:**
1. **The Delayed Resolution:** Promise resolution at 10 seconds. Delay to 30 seconds. Delay to 60 seconds. Deliver at 90 seconds. The delay creates tension that compounds.
2. **The Escalating Dissonance:** Introduce a small contradiction. Then reveal a larger contradiction that contains the first. Then reveal a third that reframes both. The dissonance deepens, not resolves.
3. **The Parallel Dissonance:** Two dissonant tracks running simultaneously (visual/text, audio/visual, tone/content). Each demands resolution. Neither resolves because resolving one deepens the other.
4. **The False Resolution:** Provide a resolution that the audience accepts. Then reveal it was incomplete or wrong. The resolution becomes a new, deeper dissonance.

---

## 6. Social Frame Violation Matrix

### Safe Social Violations (High NES, Low Backlash)
- **Confession:** Admitting a professional failure in a context of expected success
- **Directness:** Naming something everyone knows but no one says
- **Refusal:** Refusing to perform the expected social role (speaker who won't speak, seller who won't sell)
- **Vulnerability:** Expressing genuine uncertainty in a context of expected confidence
- **Intimacy:** Creating artificial closeness in a formal context (using first names immediately, sharing a personal detail)

### Dangerous Social Violations (High NES, High Backlash Risk)
- **Accusation:** Directly calling out an individual or group's behavior
- **Inversion:** Praising what the group condemns or condemning what the group praises
- **Exclusion:** Creating an in-group that deliberately excludes the audience
- **Contempt:** Displaying visible disdain for the audience's values or context
- **Boundary Violation:** Physical, emotional, or informational boundary crossing without consent

### Calibration Rule
The more powerful the social frame violation, the more precise the **subsequent bonding move** must be. A strong violation without warmth creates backlash. A strong violation followed by unexpected intimacy creates loyalty.

---

## 7. The 3-Second Autopsy Template

Use this template for every audit. Frame-by-frame. Word-by-word. Note-by-note.

```
3-SECOND AUTOPSY

Medium: [platform / context]
Artifact: [description]

Frame 1 (0-0.5s / 0-3 words / first note):
  Element: [what is delivered]
  Brain Prediction: [what the brain expected]
  Actual: [what was delivered]
  Prediction Error: [0-100]
  Loop Opened: [Y/N — describe]
  Pattern Interrupted: [Y/N — describe]
  Dissonance: [Y/N — describe]

Frame 2 (0.5-1.5s / 4-12 words / first phrase):
  Element:
  Brain Prediction:
  Actual:
  Prediction Error:
  Loop Opened:
  Pattern Interrupted:
  Dissonance:

Frame 3 (1.5-3s / 13-25 words / first line):
  Element:
  Brain Prediction:
  Actual:
  Prediction Error:
  Loop Opened:
  Pattern Interrupted:
  Dissonance:

3-SECOND VERDICT:
  Threshold Crossed: [YES / NO / MAYBE]
  Neurochemical Trigger: [Dopamine +RPE / Dopamine -RPE / Cortisol / Oxytocin / None]
  Open Loops Active: [N]
  NES Projection: [X/100]
```

---

## 8. The Exposure Calibration

Authenticity is not an aesthetic; it is an attention weapon. The brain allocates cognitive resources based on stakes. If the creator is not at risk, the audience has no biological reason to pay attention. Use this matrix to calibrate the cost of an entry.

### Level 0: The Safe Zone (0 RPE, Invisible)
- **The Performance:** Competence, gratitude, credentials, optimism.
- **The Cost:** Nothing. The creator's ego, status, and privacy are protected.
- **Audience Reaction:** "I've seen this before." (Autopilot engaged)
- **Example:** "Thrilled to announce we raised $2M to build the future of work."

### Level 1: The Curated Flaw (Low RPE, Polite)
- **The Performance:** Humble-brag, safely resolved past failure, relatable quirk.
- **The Cost:** Minimal. The flaw actually enhances the hero narrative.
- **Audience Reaction:** "That's nice." (Conscious processing, low retention)
- **Example:** "I got rejected 40 times before raising $2M."

### Level 2: The Live Wire (High RPE, Compulsive)
- **The Performance:** Admitting current, unresolved fear, ignorance, or failure. Stripping the title.
- **The Cost:** Ego, status. The creator looks worse than they need to.
- **Audience Reaction:** "Wait, they're admitting that out loud?" (Amygdala firing)
- **Example:** "We just raised $2M and I have no idea if our core premise is actually true."

### Level 3: The Nuclear Drop (Absolute Hijack)
- **The Performance:** Saying the exact thing the industry/audience/social script explicitly forbids saying. Weaponized honesty.
- **The Cost:** Relationships, reputation, the transaction itself.
- **Audience Reaction:** [Silence. Deep engagement. Inability to look away.] (Total neural override)
- **Example:** "I told our investors we were building a productivity tool. I lied."

**Rule of Thumb:** When evaluating an entry, ask: *What does this cost the creator?* If the answer is "nothing," throw it out. Increase the cost until the audience is forced to care.

---

These frameworks are not suggestions. They are constraints. Work within them, violate them deliberately when the violation itself is the pattern interrupt, and cite them when diagnosing. The `snatch-em` skill applies them as first-class tools, not decoration.
