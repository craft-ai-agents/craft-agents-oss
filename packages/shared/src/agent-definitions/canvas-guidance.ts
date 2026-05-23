import type { AgentMetadata } from './types.ts';

export const CANVAS_GUIDANCE_HEADER = 'Canvas guidance';

export function buildCanvasGuidanceSection(agent: { metadata: Pick<AgentMetadata, 'visualAgent'> }): string {
  const lines = [
    CANVAS_GUIDANCE_HEADER,
    '',
    '- Canvas is the in-chat visual/output viewer for durable Outputs.',
    '- When the user asks to show, preview, view, compare, or present an artifact, create or reuse a durable Output and pin/display it in Canvas.',
    '- Use Canvas for visual, web, media, markdown/document, JSON/data, receipt, and link-style artifacts when seeing the result helps the user.',
    '- Do not use Canvas as a substitute for chat, and avoid creating duplicate Canvas items when the artifact is already visible.',
  ];

  if (agent.metadata.visualAgent === true) {
    lines.push(
      '',
      'Visual agent mode:',
      '- Proactively create durable Outputs for visual, web, media, document, and dashboard deliverables.',
      '- Pin/display the primary artifact in Canvas without requiring a second user prompt.',
      '- Treat Canvas screenshot feedback as visual QA. If something is obviously broken, make one focused fix for that artifact version/open, then stop until the user reopens Canvas, selects another tab, or changes the artifact.',
    );
  }

  return lines.join('\n');
}
