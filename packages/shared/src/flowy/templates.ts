/**
 * Flowy Document Templates
 */

import type { FlowyDocument, FlowyNode, FlowyEdge, Position, DocumentType } from './types.ts';

// ID Generation
let nodeIdCounter = 0;
let edgeIdCounter = 0;

function generateNodeId(): string { return `node-${++nodeIdCounter}`; }
function generateEdgeId(): string { return `edge-${++edgeIdCounter}`; }
function resetIdCounters(): void { nodeIdCounter = edgeIdCounter = 0; }

// Node Factory
function createNode(label: string, position: Position, options: Partial<Omit<FlowyNode, 'id' | 'label' | 'position'>> = {}): FlowyNode {
  return {
    id: generateNodeId(),
    type: options.type ?? 'rect',
    label,
    position,
    size: options.size ?? { width: 120, height: 60 },
    style: options.style ?? { fill: '#f0f9ff', stroke: '#0ea5e9', cornerRadius: 8 },
    icon: options.icon,
    data: options.data,
  };
}

// Edge Factory
function createEdge(from: string, to: string, options: Partial<Omit<FlowyEdge, 'id' | 'from' | 'to'>> = {}): FlowyEdge {
  return { id: generateEdgeId(), from, to, type: options.type ?? 'arrow', label: options.label, style: options.style };
}

// Blank Templates
export function createBlankFlowchart(name: string): FlowyDocument {
  resetIdCounters();
  const now = new Date().toISOString();
  return { version: '1.0', name, type: 'flowchart', content: { type: 'flowchart', nodes: [], edges: [] }, viewport: { zoom: 1, pan: { x: 0, y: 0 } }, createdAt: now, updatedAt: now };
}

export function createBlankMockup(name: string): FlowyDocument {
  resetIdCounters();
  const now = new Date().toISOString();
  return { version: '1.0', name, type: 'mockup', content: { type: 'mockup', screens: [], connections: [] }, viewport: { zoom: 1, pan: { x: 0, y: 0 } }, createdAt: now, updatedAt: now };
}

// Sample Templates
export function createNavigationFlowTemplate(): FlowyDocument {
  resetIdCounters();
  const now = new Date().toISOString();
  const homeNode = createNode('Home', { x: 100, y: 200 }, { icon: { name: 'home', size: 18, color: '#0ea5e9' } });
  const listNode = createNode('List', { x: 300, y: 200 }, { icon: { name: 'list', size: 18, color: '#0ea5e9' } });
  const detailNode = createNode('Detail', { x: 500, y: 200 }, { icon: { name: 'file-text', size: 18, color: '#0ea5e9' } });
  return {
    version: '1.0', name: 'Navigation Flow', description: 'App navigation structure', type: 'flowchart',
    content: { type: 'flowchart', nodes: [homeNode, listNode, detailNode], edges: [
      createEdge(homeNode.id, listNode.id, { label: 'tap' }),
      createEdge(listNode.id, detailNode.id, { label: 'select' }),
      createEdge(detailNode.id, listNode.id, { type: 'dashed', label: 'back' }),
    ]},
    viewport: { zoom: 1, pan: { x: 0, y: 0 } }, createdAt: now, updatedAt: now,
  };
}

export function createStateMachineTemplate(): FlowyDocument {
  resetIdCounters();
  const now = new Date().toISOString();
  const idleNode = createNode('Idle', { x: 100, y: 200 }, { type: 'circle', size: { width: 80, height: 80 }, style: { fill: '#dcfce7', stroke: '#22c55e' } });
  const loadingNode = createNode('Loading', { x: 300, y: 200 }, { icon: { name: 'loader', size: 18, color: '#f59e0b' }, style: { fill: '#fef3c7', stroke: '#f59e0b' } });
  const successNode = createNode('Success', { x: 500, y: 100 }, { style: { fill: '#dcfce7', stroke: '#22c55e' } });
  const errorNode = createNode('Error', { x: 500, y: 300 }, { style: { fill: '#fee2e2', stroke: '#ef4444' } });
  return {
    version: '1.0', name: 'State Machine', description: 'Async operation states', type: 'flowchart',
    content: { type: 'flowchart', nodes: [idleNode, loadingNode, successNode, errorNode], edges: [
      createEdge(idleNode.id, loadingNode.id, { label: 'start' }),
      createEdge(loadingNode.id, successNode.id, { label: 'success' }),
      createEdge(loadingNode.id, errorNode.id, { label: 'error' }),
      createEdge(successNode.id, idleNode.id, { type: 'dashed', label: 'reset' }),
      createEdge(errorNode.id, idleNode.id, { type: 'dashed', label: 'retry' }),
    ]},
    viewport: { zoom: 1, pan: { x: 0, y: 0 } }, createdAt: now, updatedAt: now,
  };
}

export function createUIMockupTemplate(): FlowyDocument {
  resetIdCounters();
  const now = new Date().toISOString();
  return {
    version: '1.0', name: 'UI Mockup', description: 'iPhone UI mockup', type: 'mockup',
    content: { type: 'mockup', screens: [
      {
        id: 'screen-1',
        title: 'Home Screen',
        device: 'iphone',
        position: { x: 50, y: 50 },
        backgroundColor: '#ffffff',
        statusBarStyle: 'dark',
        components: [
          { id: 'navbar', type: 'navbar', position: { x: 0, y: 0 }, size: { width: 393, height: 44 }, props: { type: 'navbar', title: 'Home' } },
          { id: 'title', type: 'text', position: { x: 24, y: 100 }, size: { width: 345, height: 40 }, props: { type: 'text', content: 'Welcome', variant: 'title' } },
          { id: 'btn', type: 'button', position: { x: 24, y: 200 }, size: { width: 345, height: 50 }, props: { type: 'button', label: 'Get Started', variant: 'primary' } },
        ]
      }
    ], connections: [] },
    viewport: { zoom: 1, pan: { x: 0, y: 0 } }, createdAt: now, updatedAt: now,
  };
}

// Template Registry
export type TemplateName = 'blank' | 'navigation-flow' | 'state-machine' | 'ui-mockup';

export function createFromTemplate(templateName: TemplateName, name: string, type: DocumentType): FlowyDocument {
  switch (templateName) {
    case 'navigation-flow': return { ...createNavigationFlowTemplate(), name };
    case 'state-machine': return { ...createStateMachineTemplate(), name };
    case 'ui-mockup': return { ...createUIMockupTemplate(), name };
    case 'blank':
    default: return type === 'mockup' ? createBlankMockup(name) : createBlankFlowchart(name);
  }
}
