# Chart Canvas Spec

## Decision

Canvas should support simple static chart Outputs directly before adding provider-specific adapters like TradingView.

The preferred agent output is:

1. `.chart.json` for simple bar, line, or pie charts.
2. SVG/PNG fallback for complex visualizations.
3. Live browser/chart-provider surfaces only when the user needs inspection or interactivity.

## Chart JSON Shape

```json
{
  "type": "bar",
  "title": "Monthly revenue",
  "xLabel": "Month",
  "yLabel": "Revenue",
  "data": [
    { "label": "Jan", "value": 120 },
    { "label": "Feb", "value": 180 }
  ]
}
```

Supported `type` values:

- `bar`
- `line`
- `pie`

Canvas also accepts simple Vega-Lite-like specs with `mark`, `encoding.x.field`, `encoding.y.field`, and `data.values`.

## Renderer Behavior

- `.chart.json`, `.vega.json`, and `.vegalite.json` infer preview mode `chart`.
- Chart JSON renders as an SVG in `OutputInlinePreview`.
- Invalid chart JSON shows a clear unavailable state and marks preview review as errored.
- Agents should attach image exports when the chart is too custom for the native renderer.

## Out Of Scope

- No live TradingView control.
- No remote chart embeds.
- No full Vega/Vega-Lite runtime dependency yet.
- No editable chart builder.
