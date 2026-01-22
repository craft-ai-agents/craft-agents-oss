/**
 * Custom Endpoint Configuration Schema
 *
 * Defines the JSON structure for custom API endpoint configurations.
 * Users upload this config to connect to OpenRouter, Ollama, or other
 * compatible API providers.
 *
 * The config maps to existing storage fields:
 * - baseUrl → anthropicBaseUrl
 * - apiKey → credential store
 * - models → customModelNames
 */

import { z } from 'zod';

/**
 * Schema for the uploadable custom endpoint configuration JSON
 */
export const CustomEndpointConfigSchema = z.object({
  // Required: API endpoint URL
  baseUrl: z
    .string()
    .url('baseUrl must be a valid URL')
    .describe('API endpoint URL (e.g., https://openrouter.ai/api)'),

  // Optional: API key or bearer token
  apiKey: z
    .string()
    .optional()
    .describe('API key or bearer token for authentication'),

  // Optional: Model name mappings for each tier
  models: z
    .object({
      // Primary model - used for most tasks
      sonnet: z.string().optional().describe('Primary model (e.g., anthropic/claude-sonnet-4)'),
      // Most capable model - used for complex reasoning
      opus: z.string().optional().describe('Most capable model (e.g., anthropic/claude-opus-4)'),
      // Fast/efficient model - used for quick tasks
      haiku: z.string().optional().describe('Fast model (e.g., anthropic/claude-3-haiku)'),
    })
    .optional()
    .describe('Model name mappings for each tier'),
});

/**
 * Type for the custom endpoint configuration
 */
export type CustomEndpointConfig = z.infer<typeof CustomEndpointConfigSchema>;

/**
 * Validate a custom endpoint configuration object
 * Returns validation result with detailed error messages
 */
export function validateCustomEndpointConfig(config: unknown): {
  valid: boolean;
  data?: CustomEndpointConfig;
  errors: string[];
} {
  const result = CustomEndpointConfigSchema.safeParse(config);

  if (result.success) {
    return {
      valid: true,
      data: result.data,
      errors: [],
    };
  }

  // Format Zod errors into readable messages
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  return {
    valid: false,
    errors,
  };
}

/**
 * Parse and validate a JSON string as custom endpoint config
 */
export function parseCustomEndpointConfig(jsonString: string): {
  valid: boolean;
  data?: CustomEndpointConfig;
  errors: string[];
} {
  // Parse JSON first
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    return {
      valid: false,
      errors: [`Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`],
    };
  }

  // Validate against schema
  return validateCustomEndpointConfig(parsed);
}

/**
 * Mask API key for display (shows first 8 chars + masked suffix)
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 12) {
    return apiKey.slice(0, 4) + '****';
  }
  return apiKey.slice(0, 8) + '****' + apiKey.slice(-4);
}

/**
 * Generate example config JSON for documentation
 */
export function getExampleConfig(): CustomEndpointConfig {
  return {
    baseUrl: 'https://openrouter.ai/api',
    apiKey: 'sk-or-v1-your-api-key-here',
    models: {
      sonnet: 'anthropic/claude-sonnet-4',
      opus: 'anthropic/claude-opus-4',
      haiku: 'anthropic/claude-3-haiku',
    },
  };
}
