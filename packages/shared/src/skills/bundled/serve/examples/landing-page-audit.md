# Example: SERVIN' Output — Landing Page Audit

**Command run:** `gaygent serve https://mystartup.io`

---

```
GAYGENT SERVIN' REPORT CARD
Artifact: Landing page — mystartup.io
Audited: 2026-05-02T11:34:00Z
OVERALL SCORE: 84/100 B
(Vision Layer cap applied: No THE DARE present. Score capped at 85.)
```

## PILLAR SCORES

| Pillar | Score | Verdict |
|--------|-------|---------|
| **Silhouette** | 72/100 | Hero has shape, but CTA bar fights it. Two dominant forms compete — Law of Prägnanz violated. |
| **Hierarchy** | 55/100 | Three things shout "first." Hick's Law: 6 competing visual weights above fold. |
| **Contrast** | 81/100 | Dark/light split works. CTA text 3.2:1 — passes AA large text. |
| **Rhythm** | 60/100 | Margins: 16, 24, 20, 40, 28. 40% off-grid. 8pt grid not adhered. |
| **Restraint** | 45/100 | 14 logos in social proof. Miller's Law: 14 items exceed working memory 2×. |
| **It Factor** | 30/100 | No Von Restorff element. Industry blue + Inter + centered. Forgettable. Zeitgeist: ON (now). Polarization: ~5%. |

## THE RECEIPTS

**1. Above the fold: headline, subhead, video, CTA, nav, announcement bar — 6 visual weights competing.**
- Principle violated: Hick's Law + Figure/Ground ambiguity
- Fix: Collapse to one dominant element.

**2. Logo bar: 14 grayscale logos at 40px. Crops unevenly.**
- Principle violated: Miller's Law + Similarity (indistinguishable mass)
- Fix: 5 best logos at 64px with consistent padding.

**3. Footer: 7 columns of links. Text gray on gray: 2.8:1.**
- Principle violated: WCAG AA (fails 4.5:1) + Miller's Law (7 columns)
- Fix: Delete 2 columns. Increase footer text contrast to ≥4.5:1.

## DESIGN SYSTEM METRICS

**Spacing Audit:** 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64
- On-grid: 8, 16, 24, 32, 40, 48, 56, 64 (73%)
- Off-grid: 12, 20, 28 (27%)

**Type Scale Audit:** 12, 14, 16, 18, 22, 28, 36, 48px
- Modular ratio detected: none (arbitrary)
- Suggested scale (1.25 Major Third, 16px base): 16, 20, 25, 31, 39, 48

## THE FIX LIST

1. **[half-day]** Collapse hero to ONE dominant element. Headline goes huge OR video goes full-bleed. Not both.
2. **[1hr]** Reduce logo bar to 5 best logos at 64px with 24px padding.
3. **[5min]** Delete 2 footer columns. Move content to About.
4. **[1hr]** Standardize spacing to 8pt grid.
5. **[half-day]** Implement modular type scale.
6. **[half-day]** Add one Von Restorff element: non-industry accent color, oversized display type, or asymmetric split.

## THE DARE (Future Vision Layer)

**DARE:** Replace the hero image with a real-time generative visual that responds to scroll velocity and cursor position. In 2026 this is experimental. In 2030 it will be standard. Your competitors will copy it in 2028. You ship it now, you own the category. Use a lightweight WebGL shader that blooms on interaction — 15KB, no external dependency.

- **Polarization Score:** 65% (30% obsessed, 35% hate it, 35% indifferent — but the 30% will recruit)
- **Zeitgeist Gap:** +8 years (significantly ahead)
- **Effort:** `architectural` (2-3 days with Three.js/React-Three-Fiber)
- **Risk:** 40% of your target demographic (enterprise buyers) may find it distracting. Deploy behind a "Experimental Mode" toggle for A/B validation.
- **If implemented:** It Factor jumps from 30 → 85. Overall score potential: 94/100 A.

## PRINCIPLES REFERENCE

1. **Hick's Law:** Decision time increases with choices. Every extra competing element above fold increases cognitive load logarithmically.
2. **8pt Grid:** Multiples of 8 ensure pixel-perfect rendering and predictable rhythm.
3. **Von Restorff Effect:** The element that differs from peers is most remembered. One distinctive choice = memorable; three = noise.

## SHAREABLE CARD

"mystartup.io scored B from @gaygent. Competent, safe, forgettable. THE DARE: generative hero that responds to scroll velocity. Ship it now, own 2030."

---

**Audited by SERVIN'**
**Gaygent — Taste as a Service**

Want the full drag? Run `gaygent full-drag https://mystartup.io`
