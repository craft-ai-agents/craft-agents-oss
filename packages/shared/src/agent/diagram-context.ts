import type { FlowyInlineEmbed } from '@vesper/core';

/**
 * Build diagram context from inline Flowy embeds
 * Converts diagram data into structured XML format that Claude can understand
 */
export function buildDiagramContext(embeds: FlowyInlineEmbed[]): string {
  if (!embeds || embeds.length === 0) return '';

  const diagramContexts = embeds.map(embed => {
    const doc = embed.document;

    if (doc.type === 'flowchart') {
      const content = doc.content;
      // Type guard to ensure we have flowchart content
      if (content.type !== 'flowchart') return '';

      return `
<diagram id="${embed.id}" name="${doc.name}" type="flowchart">
  <nodes>
${content.nodes.map(n => `    <node id="${n.id}" label="${n.label}" type="${n.type}" />`).join('\n')}
  </nodes>
  <edges>
${content.edges.map(e => `    <edge from="${e.from}" to="${e.to}" label="${e.label || ''}" />`).join('\n')}
  </edges>
</diagram>`;
    } else if (doc.type === 'mockup') {
      const content = doc.content;
      // Type guard to ensure we have mockup content
      if (content.type !== 'mockup') return '';

      return `
<diagram id="${embed.id}" name="${doc.name}" type="mockup">
  <screens>
${content.screens.map(s => `    <screen id="${s.id}" title="${s.title}" device="${s.device}" />`).join('\n')}
  </screens>
  <connections>
${content.connections.map(c => `    <connection from="${c.from.screenId}" to="${c.to.screenId}" label="${c.label || ''}" />`).join('\n')}
  </connections>
</diagram>`;
    }

    return '';
  }).filter(Boolean); // Remove empty strings

  if (diagramContexts.length === 0) return '';

  return `<diagram_context>
The following diagrams are embedded inline in this message. You can reference them by ID when responding.
${diagramContexts.join('\n')}
</diagram_context>`;
}
