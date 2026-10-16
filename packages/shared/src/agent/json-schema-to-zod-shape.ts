import type { z } from 'zod';

type JsonPropConverter = (prop: any, depth?: number) => z.ZodTypeAny;

export function jsonSchemaToZodShape(
  schema: Record<string, unknown>,
  convertProperty: JsonPropConverter,
  depth = 0,
): Record<string, z.ZodTypeAny> {
  const properties = (schema.properties as Record<string, any>) || {};
  const required = new Set((schema.required as string[]) || []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let zodType = convertProperty(prop, depth);
    const isInjectedMetadata = depth === 0 && (key === '_intent' || key === '_displayName');
    if (!required.has(key) || isInjectedMetadata) zodType = zodType.optional();
    shape[key] = zodType;
  }

  return shape;
}
