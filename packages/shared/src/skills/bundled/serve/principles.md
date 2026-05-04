# SERVIN' Principles — Extended Deep-Dives

Reference document for the scientific and psychological foundations used by the `serve` skill.

## 1. Gestalt Principles of Perception

The human visual system does not process individual elements in isolation. It perceives organized wholes. These principles explain why users "see" structure before they process content.

### Proximity
Elements near one another are perceived as related. Violated when unrelated elements cluster (creating false relationships) or related elements drift apart (breaking perceived groups).
- **Audit action:** Measure visual distance between related items. If the gap between unrelated items is smaller than the gap within a group, Proximity is violated.

### Similarity
Elements that share visual properties (size, color, shape, texture) are perceived as belonging together. Violated when headers and body text share the same weight/color/size — users cannot distinguish information categories.
- **Audit action:** List the visual properties of each element category. If headers, body, captions, and CTAs share >2 properties, Similarity is violated.

### Continuity
The eye follows smooth, continuous paths. Violated when alignment breaks, columns stagger, or visual flow is interrupted by arbitrary placement. The mind prefers unbroken lines.
- **Audit action:** Trace the dominant alignment lines (left edges, baselines, center axes). Any interruption without purpose breaks Continuity.

### Closure
The mind fills gaps to perceive whole forms. Leveraged in logo design, iconography, and layout silhouettes. Violated when forms feel incomplete or "hanging."
- **Audit action:** Does the outer shape feel resolved? Does the layout have a clear bounding form, or do elements feel like they were cut off?

### Common Region
Elements within the same boundary (border, background block, shadow, whitespace container) are grouped. Violated when cards, sections, or modal content lack clear containment.
- **Audit action:** Can you draw a box around each functional group without ambiguity? If groups bleed into each other, Common Region is weak.

### Figure/Ground
Foreground must separate from background. Violated when layering is ambiguous (flat design pushed to the extreme), when modals lack overlay/backdrop, or when interactive elements do not "lift" above the surface.
- **Audit action:** Identify the foreground elements. If the eye cannot instantly separate foreground from background, Figure/Ground has collapsed.

### Law of Prägnanz (Good Form)
The simplest organization is perceived. The mind will interpret ambiguous shapes as the simplest possible form. Violated when complexity is visible without purpose — decorative noise, arbitrary shapes, or competing structural strategies.
- **Audit action:** Can the layout be described in one sentence? ("Centered monument with supporting grid." "Asymmetric 70/30 split.") If it takes a paragraph, Prägnanz is violated.

## 2. Laws of UX (Cognitive & Motor)

These laws govern how users think, decide, and act. They are not design opinions — they are measurable constraints on human performance.

### Hick's Law
Decision time increases logarithmically with the number of choices. T = b · log₂(n + 1), where n = number of choices and b = empirically derived constant (~150ms per bit for simple decisions).
- **Design implication:** Each competing visual choice above the fold adds measurable cognitive load. A nav with 9 items vs 5 items adds ~150ms to decision time. In competitive attention markets, that is abandonment.
- **Audit action:** Count competing visual weights per viewport zone. Each zone should have one primary action. Two primaries = Hick's Law violation. Three = severe violation.

### Fitts's Law
Time to acquire a target is a function of target size and distance: T = a + b · log₂(D/W + 1), where D = distance to target, W = target width.
- **Design implication:** Small, distant CTAs fail. A 24×24px icon in a corner requires more time and precision than a 120px-wide button centered in the thumb zone.
- **Minimum targets:** 44×44pt for touch (Apple HIG), 48×48dp for Android (Material Design). WCAG 2.5.5 recommends 44×44 CSS px.
- **Audit action:** Measure CTA size and distance from natural cursor/thumb rest. Small distant targets = Fitts's Law failure.

### Jakob's Law
Users spend 99% of their time on *other* products. They prefer your product to work the same way as the others they already know.
- **Design implication:** Familiarity reduces cognitive load. Deviation must earn its disruption. A novel navigation pattern must deliver 10× the value to justify the learning cost.
- **Audit action:** Is the core interaction model (nav placement, form patterns, button behavior) familiar? If yes, foundation is solid. Is there ONE expressive layer that deliberately deviates? If no, the artifact is too safe. If yes, is the deviation purposeful or accidental?

### Tesler's Law (Conservation of Complexity)
Complexity cannot be eliminated, only moved. Every feature, option, or data point has a complexity "mass." If the user surface is complex, the system did not absorb its share.
- **Design implication:** A form with 20 fields is not "complete" — it is a system failure. Complexity should be absorbed via smart defaults, progressive disclosure, contextual help, automation, or elimination.
- **Audit action:** Count visible fields, options, and choices. Are they all necessary at this stage? If the answer is "just in case," the system has not done its job.

### Miller's Law (7 ± 2)
Humans hold 5–9 chunks in working memory. The practical limit for immediate comprehension is ~4 chunks (recent refinements of the original 1956 paper).
- **Design implication:** Navigation with >7 items exceeds working memory. Forms with >7 fields per view exceed capacity. Dashboards with >7 visual groups require active chunking by the user.
- **Modern refinement:** 4±1 is the optimal chunk size for effortless comprehension. 7±2 is the absolute ceiling before breakdown.
- **Audit action:** Count items in nav, form fields per view, visual groups per section. >7 = violation. >5 = caution. Group into 5–7 chunks if the total must be larger.

### Aesthetic-Usability Effect
Users perceive attractive designs as more usable. Beauty is not vanity — it is a usability signal. A low aesthetic score biases users against functional success before they interact.
- **Design implication:** A beautiful but slightly flawed interface will be rated more usable than an ugly but functional one. First impression is a functional filter.
- **Audit action:** Does the artifact signal quality through visual polish? If the visual layer feels cheap, users will assume the functionality is cheap — regardless of actual performance.

### Von Restorff Effect (Isolation Effect)
The item that differs from its peers is most remembered. ONE distinctive element per view is powerful. Three distinctive elements become noise — the effect inverts because nothing stands out from the noise.
- **Design implication:** One accent color. One display typeface. One asymmetric moment. One bold illustration. Commit to one risk, fully.
- **Audit action:** Count distinctive elements per major view. 1 = powerful. 2 = acceptable if hierarchically separated. 3+ = noise. 0 = forgettable.

### Peak-End Rule
Users judge experiences by the peak emotional moment and the ending. Duration neglect means the length of the experience matters less than the most intense moment and the final impression.
- **Design implication:** Visual design must have a memorable peak (the hero moment, the surprising interaction, the bold visual choice) and a resolved finish (a confident footer, a satisfying completion state, a clean final slide).
- **Audit action:** Identify the peak moment. Is it above the fold or at the natural journey conclusion? Identify the ending. Does it feel intentional and resolved, or like an afterthought?

## 3. Eye-Tracking & Scanning Patterns

Users do not read. They scan. The dominant pattern depends on content type and task goal.

### F-Pattern
Two horizontal stripes followed by a vertical scan. Dominant on text-heavy pages (articles, documentation, search results).
- **Path:** Top horizontal (headline + top nav), second horizontal (subhead or first content line), vertical stem (left-aligned content scan).
- **Audit action:** Are key actions and critical information within the F's stem? If CTAs sit outside the vertical stem (e.g., right sidebar, far corners), they are functionally invisible to F-pattern scanners.
- **Fix:** Place primary actions along the left vertical stem or at the end of the second horizontal stripe.

### Z-Pattern
Eye scans top-left → top-right → diagonal → bottom-left → bottom-right. Dominant on visual/promotional pages with low text density (landing pages, hero sections, ads).
- **Path:** Logo (top-left) → nav/utility (top-right) → hero image/headline (diagonal sweep) → CTA (bottom-right).
- **Audit action:** Does the visual weight follow the Z? If the diagonal is broken by a competing element, energy dissipates.
- **Fix:** Place the primary CTA at the bottom-right anchor point of the Z. Use the diagonal for the emotional/visual hook.

### Layer-Cake Pattern
Users scan headings and list items horizontally, ignoring body text between. Dominant on structured content pages (documentation, FAQs, dashboards, tables of contents).
- **Path:** Horizontal scan of heading → skip body → horizontal scan of next heading → skip body → repeat.
- **Audit action:** Can a user understand the page structure by reading headings alone? If headings are vague or missing, Layer-Cake scanners are lost. Is critical information in body text that headings skip? If yes, it will not be read.
- **Fix:** Headings must be descriptive enough to convey meaning alone. Use summary sentences or bolded intros to capture Layer-Cake attention between headings.

## 4. Typography Systems

Typography is not font choice. It is an information hierarchy system encoded in size, weight, spacing, and proportion.

### Modular Type Scale
Type sizes should follow a mathematical ratio from a base size. Common ratios:
- **1.200 (Minor Third):** Safe, conventional. 16, 19.2, 23, 27.6, 33.1, 39.7, 47.7px.
- **1.250 (Major Third):** Balanced, modern. 16, 20, 25, 31.25, 39.06, 48.83, 61.04px.
- **1.414 (Augmented Fourth / Perfect Fifth):** Dramatic, editorial. 16, 22.6, 32, 45.3, 64px.
- **1.618 (Golden Ratio):** Maximum contrast, high drama. 16, 25.9, 41.9, 67.8, 109.7px.
- **Audit action:** List all font sizes. Check if they follow a consistent ratio from a base. Arbitrary sizes (16, 18, 22, 28, 36, 48 with no mathematical relationship) indicate system absence.

### Vertical Rhythm (Baseline Grid)
Line height should create a consistent baseline grid that aligns across columns and components.
- **Body text:** 1.4–1.6× font size. (1.5× is the safe default.)
- **Display/heading text:** 1.2–1.3× font size. (Tighter leading for large type.)
- **Rhythm unit:** Typically 4px, 8px, or half the body line-height. All vertical spacing (margins, padding, component heights) should be multiples of this unit.
- **Audit action:** Do baselines align across adjacent text blocks? If not, the rhythm is broken and the page feels "wobbly."

### Optimal Line Length
45–75 characters per line for body text. Maximum 90. Too short = choppy, fragmented reading. Too long = lost place, reduced comprehension.
- **Measurement:** `max-width: 65ch` in CSS approximates the ideal. Adjust for typeface width (narrow fonts like Inter can tolerate slightly longer; wide fonts like Georgia need shorter).
- **Audit action:** Count characters in representative body text lines. >90 = failure. <45 = failure.

## 5. Spacing & Grid Systems

Spacing is not the absence of content. It is a structural rhythm that creates predictability and reduces cognitive load.

### 8pt Grid
All dimensions, padding, and margins are multiples of 8 (8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 96, 128).
- **Rationale:** Ensures half-pixel-free rendering on all device densities (1×, 1.5×, 2×, 3×, 4×). 8px is the LCD of common device scales.
- **Audit action:** List every visible margin and padding value. Count on-grid vs off-grid. >20% off-grid = rhythm broken.

### 4pt Grid (Fine)
Used for icon spacing, tight internal padding, and mobile micro-layouts where 8pt is too coarse.
- **Rationale:** Provides precision at small scales without breaking the 8pt macro rhythm (4 is a factor of 8).
- **Audit action:** Are icon gutters, button internal padding, and tight component spacing multiples of 4? If 5, 7, 9, 11px values appear, the fine grid is violated.

### Grid Adherence Test
1. Extract all margin and padding values from the artifact (visually or via code).
2. Mark each as on-grid (multiples of 8, or 4 for fine) or off-grid.
3. Calculate percentage adherence.
4. **≥90%** = excellent. **70–89%** = good, some cleanup needed. **50–69%** = problematic, system not established. **<50%** = broken, no grid logic detectable.

## 6. Contrast & Accessibility (WCAG 2.1)

Contrast is not a preference. It is a measurable accessibility requirement.

### Minimum Ratios
| Element | WCAG AA | WCAG AAA |
|---------|---------|----------|
| Normal text (<18pt, non-bold) | 4.5:1 | 7:1 |
| Large text (≥18pt, or ≥14pt bold) | 3:1 | 4.5:1 |
| UI components (borders, icons, focus indicators) | 3:1 | — |
| Decorative/non-essential | No requirement | — |

### The Grayscale Audit
Convert the design to grayscale. If the hierarchy collapses — if headings merge with body text, if CTAs disappear, if sections lose definition — the design relies on color (hue) contrast alone. True hierarchy is built on value (lightness) contrast. A grayscale-passing design is robust across colorblindness, screen calibration variance, and bright ambient light.

### Contrast Mechanism Discipline
Pick ONE primary contrast mechanism (value/lightness difference) and ONE accent mechanism (color saturation or shadow). All other separation should be handled by spacing. Using >3 contrast mechanisms without a clear system creates visual chaos — the user cannot learn the visual language because every element invents its own.

## 7. Visual Weight & Balance

Visual weight is the perceived "heaviness" of an element. It is determined by:
- **Size:** Larger = heavier.
- **Color saturation:** More saturated = heavier.
- **Contrast (value):** Higher contrast against background = heavier.
- **Density/complexity:** More detail = heavier.
- **Texture:** Patterned = heavier than flat.
- **Position:** Center = heavier (draws attention); top = heavier (reading gravity).
- **Directional force:** Arrows, gaze direction, motion lines pull weight in a direction.

### Balance Types
- **Symmetrical:** Equal weight on both sides of a central axis. Stable, formal, sometimes static. Good for trust, authority, simplicity.
- **Asymmetrical:** Unequal elements balanced by strategic weight distribution. Dynamic, modern, risky. Good for energy, innovation, editorial voice.
- **Radial:** Elements radiate from a center point. Used for focus moments, loading states, hero concentrations. Creates convergence and centripetal energy.
- **Audit action:** Mentally place a fulcrum at the visual center. Does one side feel heavier? If yes, imbalance is present. Determine if the imbalance is purposeful (asymmetrical dynamism) or accidental (unresolved tension).

## 8. Color Theory for UI

Color is a hierarchy tool, an emotional signal, and a brand identifier. It is not decoration.

### The Three Dimensions
- **Hue:** The color family. Limited palette = sophistication. >5 hues without a unifying neutral = chaos.
- **Saturation:** Intensity. High saturation draws attention; overuse = visual screaming. Rest areas need desaturation.
- **Brightness/Value:** Lightness. True hierarchy is built on value contrast, not hue contrast. A grayscale hierarchy test exposes value failures.

### The 60-30-10 Rule
- **60% dominant neutral:** Anchors the palette, creates calm, provides the "room."
- **30% secondary:** Supports the dominant, adds depth and variation.
- **10% accent:** The Von Restorff element. The single point of maximum contrast and energy.
- **Violation:** When no dominant color anchors the palette (e.g., 33/33/33 split), the eye has no resting place and the design feels restless.

### Color Psychology (Context-Aware)
Associations are not universal — industry, culture, and brand context modulate them. But baseline associations provide starting points:
- **Red:** Urgency, passion, danger, action.
- **Blue:** Trust, calm, depth, professionalism. (The default choice — using it without justification is the opposite of distinctive.)
- **Green:** Growth, success, nature, finance.
- **Yellow:** Optimism, attention, warning, energy.
- **Purple:** Luxury, creativity, spirituality, mystery.
- **Orange:** Energy, friendliness, confidence, affordability.
- **Black:** Power, sophistication, exclusivity, minimalism.
- **White:** Simplicity, cleanliness, space, modernity.
- **Audit action:** Is the dominant color an active choice for the context, or a default? Default color = default thinking.

## 9. White Space (Negative Space) Psychology

White space is not "empty." It is an active design element that creates balance, clarity, and sophistication.

### Macro White Space
The space between major sections, blocks, and components. Creates structure, pacing, and visual "breathing room." Generous macro space signals confidence and quality. Crowded macro space signals desperation and low value.
- **Audit action:** Measure the space between sections. Is it consistent? Does it increase with section importance? (More important sections deserve more surrounding space.)

### Micro White Space
The space between lines, letters, and small elements. Controls readability, density, and perceived refinement.
- **Line spacing (leading):** Too tight = suffocating. Too loose = disconnected.
- **Letter spacing (tracking):** Body text rarely needs adjustment. Display text and small caps often benefit from slight loosening. All-caps almost always needs +10–20% tracking.
- **Audit action:** If text feels "cramped," micro white space is the culprit. If elements feel like they are "falling apart," micro white space is excessive.

### The Breathing Room Test
Remove one element at a time from the layout. If removing an element causes the layout to feel calmer without losing meaning, that element was visual noise. White space is the antidote to noise.

## 10. Memorability & Distinctiveness

Distinctiveness is not decoration. It is a competitive advantage encoded in cognitive psychology.

### Brand Distinctiveness as Von Restorff
Distinctive visual assets (logo shape, color, typeface, motion signature) become cognitively "sticky." They resist re-association and are retrieved faster from memory. The competitive landscape is the "peer group." The brand that deviates meaningfully is the one remembered.
- **Audit action:** Can you describe the artifact's visual signature in one sentence? If the description could apply to 20 competitors, distinctiveness is absent.

### The Peak-End Rule in Visual Design
The most memorable visual moment (the peak) and the final impression (the end) dominate user memory. A strong hero and a resolved footer are more important than consistent mediocrity across every section.
- **Audit action:** Identify the peak. Is it genuinely striking, or merely competent? Identify the end. Does it feel like a conclusion, or did the design run out of energy?

### The Screenshot Test (Behavioral Evidence)
Would a user screenshot this and share it unprompted? This is behavioral evidence of distinctiveness. Screenshots are the modern "word of mouth" for visual culture.
- **Audit action:** Does the artifact contain a "screenshot moment" — a view, a detail, or a composition that is visually worth capturing? If not, the It Factor is absent.

---

These principles are not suggestions. They are constraints. Work within them, leverage them deliberately, and cite them when auditing. The `serve` skill applies them as first-class tools, not decoration.
