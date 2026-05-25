# Presentation Canvas Spec

## Decision

Canvas should treat beautiful slide shows as web-native visual artifacts first.

The preferred agent output is:

1. HTML deck preview as the primary Canvas surface.
2. PPTX export as a supporting file when the user needs PowerPoint.
3. PDF or image export as fallback preview when HTML is not available.

PPTX-only is not enough for Canvas because it is an editable Office export, not a reliable embedded visual runtime.

## Recommended Authoring Stack

- Primary: local `html-ppt` skill for polished static HTML decks with themes, templates, keyboard navigation, animations, presenter mode, and PNG export.
- Developer-heavy alternative: Slidev for Markdown plus Vue-powered interactive/code-heavy decks.
- Broad HTML framework: reveal.js for flexible interactive HTML presentations.
- Simple Markdown-to-slides: Marp for fast CommonMark-style decks.
- Editable PPTX export: PptxGenJS when native PowerPoint output is required.

## Canvas Behavior

- `.ppt`, `.pptx`, and `.odp` infer preview mode `presentation`.
- Presentation outputs may resolve a generated HTML asset through the safe `runner-output://` protocol.
- If no HTML preview exists, Canvas looks for a supporting PDF or image asset and renders it inline.
- If no rendered preview exists, Canvas shows a concise missing-preview state instead of pretending the PPTX can be inspected visually.

## Agent Guidance

When creating a deck for Canvas:

- Build the visual deck as HTML.
- Attach `.pptx` only when the user asks for PowerPoint or editable office output.
- Attach `.pdf` when a stable portable read-only export matters.
- Set `showInCanvas: true` for visual review.

## Later Slice

Automatic PPTX-to-PDF preview generation can be added with LibreOffice headless conversion, but it should be optional because LibreOffice is not currently bundled with RunnerOS.
