# Canvas Agent Smoke Prompts

Status: active
Last updated: 2026-05-23

Use these prompts inside Runner after Canvas-agent-awareness changes. Each smoke should create a durable Output and set `showInCanvas: true` when the artifact should appear immediately. The tool also accepts the alias `show_in_canvas: true`.

## HTML Output Smoke

```text
Create a tiny HTML output named canvas-html-smoke-test.html with a black background, a large heading "Canvas HTML Smoke Test", one blue button, and a script that changes the heading text when clicked. Publish it as an Output and show it in Canvas.
```

Expected:

- Canvas opens automatically.
- The HTML renders inline, not as a dead "open link" card.
- The button can run inside the preview iframe.
- Browser Pane remains optional for inspection/debugging.

## Image Output Smoke

```text
Create a simple SVG or PNG image output named canvas-image-smoke-test showing a dark card with the words "Canvas Image Smoke". Publish it as an image Output and show it in Canvas.
```

Expected:

- Canvas opens automatically.
- The image output is selected.
- The board tab contains the pinned image card.

## Markdown Output Smoke

```text
Create a short markdown output named canvas-markdown-smoke-test.md with a heading, three checklist items, and a JSON code block. Publish it as a document Output and show it in Canvas.
```

Expected:

- Canvas opens automatically.
- The markdown renders directly in the output preview.
- The board tab contains a pinned document card.

## Local Web Smoke

```text
Create or identify a local localhost web preview Output for this session and show it in Canvas. If no local server is running, create a generated HTML output instead and tell me Browser Pane is only needed for debugging or console inspection.
```

Expected:

- Local loopback URLs render in Canvas.
- Remote URLs are not iframe embedded.
- Generated HTML assets render through `runner-output://`.

## Chart Output Smoke

```text
Create a small chart output named canvas-chart-smoke-test.chart.json showing monthly revenue for Jan, Feb, and Mar. Use a bar chart with three data points. Publish it as an Output and show it in Canvas.
```

Expected:

- Canvas opens automatically.
- The chart JSON renders as a chart, not raw JSON.
- The chart output is selectable from the Canvas output tabs.

## Workflow Graph Smoke

```text
Create a workflow graph output named canvas-workflow-smoke-test.workflow.json with three nodes: Brief succeeded, Draft running, Review queued. Publish it as an Output and show it in Canvas.
```

Expected:

- Canvas opens automatically.
- The workflow JSON renders as a step graph, not raw JSON.
- Step states are visible.

## Agent Awareness Smoke

```text
Tell me what is currently visible in Canvas for this session, which Outputs are pinnable, and whether any local web previews are available. Do not inspect iframe DOM or console logs from Canvas.
```

Expected:

- Agent uses `visual_surface_state`.
- Agent reports board/card/output state accurately.
- Agent does not claim Canvas exposes DOM, console, network logs, or live browser state.
