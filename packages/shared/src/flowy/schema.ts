/**
 * Flowy JSON Schema Validation using Zod
 */

import { z } from 'zod';

// Security Constraints
export const FLOWY_CONSTRAINTS = {
  MAX_NODES: 100,
  MAX_EDGES: 150,
  MAX_NODE_LABEL_LENGTH: 500,
  MAX_NODE_DESCRIPTION_LENGTH: 2000,
  MAX_EDGE_LABEL_LENGTH: 200,
} as const;

// Base Schemas
export const PositionSchema = z.object({ x: z.number(), y: z.number() });
export const SizeSchema = z.object({ width: z.number().positive(), height: z.number().positive() });

// Styling
export const NodeStyleSchema = z.object({
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().positive().optional(),
  cornerRadius: z.number().min(0).optional(),
  shadow: z.boolean().optional(),
  opacity: z.number().min(0).max(1).optional(),
  font: z.object({ family: z.string().optional(), size: z.number().positive().optional(), weight: z.enum(['normal', 'bold', 'light']).optional(), color: z.string().optional() }).optional(),
});

export const EdgeStyleSchema = z.object({
  stroke: z.string().optional(),
  strokeWidth: z.number().positive().optional(),
  strokeDasharray: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  markerStart: z.enum(['arrow', 'circle', 'diamond', 'none']).optional(),
  markerEnd: z.enum(['arrow', 'circle', 'diamond', 'none']).optional(),
});

export const IconConfigSchema = z.object({
  name: z.string(),
  size: z.number().positive().optional(),
  color: z.string().optional(),
  position: z.enum(['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right']).optional(),
});

// Flowchart
export const FlowyNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['rect', 'circle', 'diamond']),
  label: z.string().max(FLOWY_CONSTRAINTS.MAX_NODE_LABEL_LENGTH),
  position: PositionSchema,
  size: SizeSchema,
  style: NodeStyleSchema.optional(),
  icon: IconConfigSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const FlowyEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(['arrow', 'dashed', 'line', 'orthogonal', 'curved']),
  label: z.string().max(FLOWY_CONSTRAINTS.MAX_EDGE_LABEL_LENGTH).optional(),
  style: EdgeStyleSchema.optional(),
  controlPoints: z.array(PositionSchema).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

// Mockup Component Props
const ButtonPropsSchema = z.object({ type: z.literal('button'), label: z.string(), variant: z.enum(['primary', 'secondary', 'destructive', 'ghost']).optional(), disabled: z.boolean().optional(), icon: z.string().optional() });
const CardPropsSchema = z.object({ type: z.literal('card'), title: z.string().optional(), subtitle: z.string().optional(), content: z.string().optional(), icon: z.string().optional(), variant: z.enum(['default', 'highlighted', 'error', 'success']).optional() });
const ProgressPropsSchema = z.object({ type: z.literal('progress'), value: z.number().min(0), max: z.number().positive().optional(), showLabel: z.boolean().optional(), variant: z.enum(['bar', 'circle']).optional() });
const TextPropsSchema = z.object({ type: z.literal('text'), content: z.string(), variant: z.enum(['title', 'headline', 'body', 'caption', 'label']).optional(), align: z.enum(['left', 'center', 'right']).optional(), color: z.string().optional() });
const TextFieldPropsSchema = z.object({ type: z.literal('textfield'), placeholder: z.string().optional(), value: z.string().optional(), label: z.string().optional(), variant: z.enum(['default', 'error', 'success']).optional() });
const NavBarPropsSchema = z.object({ type: z.literal('navbar'), title: z.string(), showBack: z.boolean().optional(), rightAction: z.string().optional() });
const TabBarPropsSchema = z.object({ type: z.literal('tabbar'), tabs: z.array(z.object({ id: z.string(), label: z.string(), icon: z.string().optional(), active: z.boolean().optional() })).min(1) });
const ListPropsSchema = z.object({ type: z.literal('list'), items: z.array(z.object({ id: z.string(), title: z.string(), subtitle: z.string().optional(), icon: z.string().optional(), accessory: z.enum(['chevron', 'switch', 'checkmark', 'none']).optional(), selected: z.boolean().optional() })), variant: z.enum(['plain', 'inset', 'grouped']).optional() });
const ImagePropsSchema = z.object({ type: z.literal('image'), placeholder: z.enum(['landscape', 'portrait', 'square', 'avatar']).optional(), aspectRatio: z.number().positive().optional() });
const IconPropsSchema = z.object({ type: z.literal('icon'), name: z.string(), size: z.enum(['small', 'medium', 'large']).optional(), color: z.string().optional() });
const DividerPropsSchema = z.object({ type: z.literal('divider'), variant: z.enum(['full', 'inset']).optional() });
const BadgePropsSchema = z.object({ type: z.literal('badge'), label: z.string(), variant: z.enum(['default', 'success', 'warning', 'error', 'info']).optional() });
const TogglePropsSchema = z.object({ type: z.literal('toggle'), checked: z.boolean().optional(), label: z.string().optional() });
const SliderPropsSchema = z.object({ type: z.literal('slider'), value: z.number().optional(), min: z.number().optional(), max: z.number().optional(), label: z.string().optional() });

const MockupComponentPropsSchema = z.discriminatedUnion('type', [
  ButtonPropsSchema, CardPropsSchema, ProgressPropsSchema, TextPropsSchema,
  TextFieldPropsSchema, NavBarPropsSchema, TabBarPropsSchema, ListPropsSchema,
  ImagePropsSchema, IconPropsSchema, DividerPropsSchema, BadgePropsSchema,
  TogglePropsSchema, SliderPropsSchema,
]);

export const MockupComponentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['button', 'card', 'progress', 'text', 'textfield', 'navbar', 'tabbar', 'list', 'image', 'icon', 'divider', 'badge', 'toggle', 'slider']),
  position: PositionSchema,
  size: SizeSchema,
  props: MockupComponentPropsSchema,
});

export const MockupScreenSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  device: z.enum(['iphone', 'ipad']),
  position: PositionSchema,
  components: z.array(MockupComponentSchema),
  backgroundColor: z.string().optional(),
  statusBarStyle: z.enum(['light', 'dark']).optional(),
});

export const MockupConnectionSchema = z.object({
  id: z.string().min(1),
  from: z.object({ screenId: z.string().min(1), componentId: z.string().optional() }),
  to: z.object({ screenId: z.string().min(1), componentId: z.string().optional() }),
  label: z.string().optional(),
  type: z.enum(['arrow', 'dashed', 'line', 'orthogonal', 'curved']).optional(),
  style: EdgeStyleSchema.optional(),
});

// Content
export const FlowyFlowchartSchema = z.object({
  type: z.literal('flowchart'),
  nodes: z.array(FlowyNodeSchema).max(FLOWY_CONSTRAINTS.MAX_NODES),
  edges: z.array(FlowyEdgeSchema).max(FLOWY_CONSTRAINTS.MAX_EDGES)
});
export const FlowyMockupSchema = z.object({ type: z.literal('mockup'), screens: z.array(MockupScreenSchema), connections: z.array(MockupConnectionSchema) });
const FlowyContentSchema = z.discriminatedUnion('type', [FlowyFlowchartSchema, FlowyMockupSchema]);

// Document
export const FlowyDocumentSchema = z.object({
  version: z.literal('1.0'),
  name: z.string().min(1),
  description: z.string().max(FLOWY_CONSTRAINTS.MAX_NODE_DESCRIPTION_LENGTH).optional(),
  type: z.enum(['flowchart', 'mockup']),
  content: FlowyContentSchema,
  viewport: z.object({ zoom: z.number().positive(), pan: PositionSchema }).optional(),
  updatedAt: z.string().optional(),
  createdAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Validation Functions
export function validateFlowyDocument(data: unknown): { success: boolean; data?: z.infer<typeof FlowyDocumentSchema>; error?: z.ZodError } {
  const result = FlowyDocumentSchema.safeParse(data);
  return result.success ? { success: true, data: result.data } : { success: false, error: result.error };
}

export type ValidatedFlowyDocument = z.infer<typeof FlowyDocumentSchema>;
