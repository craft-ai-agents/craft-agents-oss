/**
 * Flowy - Visual Feedback Loop for Claude Code
 */

// Core Types
export type NodeType = 'rect' | 'circle' | 'diamond';
export type EdgeType = 'arrow' | 'dashed' | 'line' | 'orthogonal' | 'curved';
export type DeviceType = 'iphone' | 'ipad';
export type DocumentType = 'flowchart' | 'mockup';

export interface Position { x: number; y: number; }
export interface Size { width: number; height: number; }

// Styling
export interface NodeStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  shadow?: boolean;
  opacity?: number;
  font?: { family?: string; size?: number; weight?: 'normal' | 'bold' | 'light'; color?: string; };
}

export interface EdgeStyle {
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  opacity?: number;
  markerStart?: 'arrow' | 'circle' | 'diamond' | 'none';
  markerEnd?: 'arrow' | 'circle' | 'diamond' | 'none';
}

export interface IconConfig {
  name: string;
  size?: number;
  color?: string;
  position?: 'top-left' | 'top-right' | 'center' | 'bottom-left' | 'bottom-right';
}

// Flowchart
export interface FlowyNode {
  id: string;
  type: NodeType;
  label: string;
  position: Position;
  size: Size;
  style?: NodeStyle;
  icon?: IconConfig;
  data?: Record<string, unknown>;
}

export interface FlowyEdge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  label?: string;
  style?: EdgeStyle;
  controlPoints?: Position[];
  data?: Record<string, unknown>;
}

// Mockup Components
export type MockupComponentType = 'button' | 'card' | 'progress' | 'text' | 'textfield' | 'navbar' | 'tabbar' | 'list' | 'image' | 'icon' | 'divider' | 'badge' | 'toggle' | 'slider';

export interface ButtonProps { type: 'button'; label: string; variant?: 'primary' | 'secondary' | 'destructive' | 'ghost'; disabled?: boolean; icon?: string; }
export interface CardProps { type: 'card'; title?: string; subtitle?: string; content?: string; icon?: string; variant?: 'default' | 'highlighted' | 'error' | 'success'; }
export interface ProgressProps { type: 'progress'; value: number; max?: number; showLabel?: boolean; variant?: 'bar' | 'circle'; }
export interface TextProps { type: 'text'; content: string; variant?: 'title' | 'headline' | 'body' | 'caption' | 'label'; align?: 'left' | 'center' | 'right'; color?: string; }
export interface TextFieldProps { type: 'textfield'; placeholder?: string; value?: string; label?: string; variant?: 'default' | 'error' | 'success'; }
export interface NavBarProps { type: 'navbar'; title: string; showBack?: boolean; rightAction?: string; }
export interface TabBarProps { type: 'tabbar'; tabs: Array<{ id: string; label: string; icon?: string; active?: boolean; }>; }
export interface ListProps { type: 'list'; items: Array<{ id: string; title: string; subtitle?: string; icon?: string; accessory?: 'chevron' | 'switch' | 'checkmark' | 'none'; selected?: boolean; }>; variant?: 'plain' | 'inset' | 'grouped'; }
export interface ImageProps { type: 'image'; placeholder?: 'landscape' | 'portrait' | 'square' | 'avatar'; aspectRatio?: number; }
export interface IconProps { type: 'icon'; name: string; size?: 'small' | 'medium' | 'large'; color?: string; }
export interface DividerProps { type: 'divider'; variant?: 'full' | 'inset'; }
export interface BadgeProps { type: 'badge'; label: string; variant?: 'default' | 'success' | 'warning' | 'error' | 'info'; }
export interface ToggleProps { type: 'toggle'; checked?: boolean; label?: string; }
export interface SliderProps { type: 'slider'; value?: number; min?: number; max?: number; label?: string; }

export type MockupComponentProps = ButtonProps | CardProps | ProgressProps | TextProps | TextFieldProps | NavBarProps | TabBarProps | ListProps | ImageProps | IconProps | DividerProps | BadgeProps | ToggleProps | SliderProps;

export interface MockupComponent {
  id: string;
  type: MockupComponentType;
  position: Position;
  size: Size;
  props: MockupComponentProps;
}

export interface MockupScreen {
  id: string;
  title: string;
  device: DeviceType;
  position: Position;
  components: MockupComponent[];
  backgroundColor?: string;
  statusBarStyle?: 'light' | 'dark';
}

export interface MockupConnection {
  id: string;
  from: { screenId: string; componentId?: string; };
  to: { screenId: string; componentId?: string; };
  label?: string;
  type?: EdgeType;
  style?: EdgeStyle;
}

// Document Types
export interface FlowyFlowchart { type: 'flowchart'; nodes: FlowyNode[]; edges: FlowyEdge[]; }
export interface FlowyMockup { type: 'mockup'; screens: MockupScreen[]; connections: MockupConnection[]; }
export type FlowyContent = FlowyFlowchart | FlowyMockup;

export interface FlowyDocument {
  version: '1.0';
  name: string;
  description?: string;
  type: DocumentType;
  content: FlowyContent;
  viewport?: { zoom: number; pan: Position; };
  updatedAt?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

// File Types
export interface FlowyFile {
  filename: string;
  name: string;
  type: DocumentType;
  updatedAt: string;
  createdAt: string;
}

export interface FlowyFileListResult {
  files: FlowyFile[];
  directory: string;
}

// Editor State
export interface FlowySelection {
  type: 'node' | 'edge' | 'screen' | 'component' | 'connection';
  ids: string[];
}

export interface FlowyEditorState {
  selection: FlowySelection | null;
  zoom: number;
  pan: Position;
  isEditing: boolean;
  undoStack: FlowyDocument[];
  redoStack: FlowyDocument[];
}

// IPC Types
export interface FlowyCreateParams {
  name: string;
  type: DocumentType;
  template?: 'blank' | 'navigation-flow' | 'state-machine' | 'ui-mockup';
}

export interface FlowyWriteParams {
  filename: string;
  document: FlowyDocument;
}
