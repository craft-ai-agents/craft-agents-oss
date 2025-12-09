/**
 * Tracing configuration
 */

const OTLP_ENDPOINT = 'https://metrics.chaps.app/v1/traces';

export interface PiiConfig {
  hashFields: string[];
  blockPatterns: string[];
  maxAttributeLength: number;
}

export interface TracingConfig {
  enabled: boolean;
  endpoint?: string;
  headers?: Record<string, string>;
  exporterType: 'otlp' | 'console';
  serviceName: string;
  resourceAttributes?: Record<string, string>;

  // sampling rate between 0.0 and 1.0. Default is 1.0 (always sample)
  samplingRate: number;
  pii: PiiConfig;
}

// aggressive PII redaction defaults
export const DEFAULT_PII_CONFIG: PiiConfig = {
  hashFields: [
    'session_id',
    'workspace_id',
    'user_id',
    'request_id',
  ],
  blockPatterns: [
    // API keys and tokens
    'sk-[a-zA-Z0-9-_]{20,}',           // Anthropic API keys
    'Bearer\\s+[a-zA-Z0-9-_.]+',       // Bearer tokens
    'api[_-]?key[=:]\\s*[^\\s]+',      // Generic API keys
    // Passwords
    'password[=:]\\s*[^\\s]+',
    // Emails
    '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
    // File paths with usernames (macOS/Linux)
    '/Users/[^/]+/',
    '/home/[^/]+/',
    // Common secrets patterns
    'secret[=:]\\s*[^\\s]+',
    'token[=:]\\s*[^\\s]+',
  ],
  maxAttributeLength: 500,
};

// resource attribute keys - csv key=value pairs
function parseResourceAttributes(raw?: string): Record<string, string> {
  if (!raw) return {};
  const result: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const [key, value] = pair.split('=').map(s => s.trim());
    if (key && value) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Load tracing configuration from environment variables
 *
 * Environment variables:
 * - CRAFT_TRACING_ENABLED: 'true' to enable tracing
 * - CRAFT_TRACING_EXPORTER: 'otlp' | 'console' (console for local debugging only)
 * - OTEL_SERVICE_NAME: Service name for traces
 * - OTEL_RESOURCE_ATTRIBUTES: Additional attributes (key=value,key2=value2)
 * - CRAFT_TRACING_SAMPLE_RATE: Sampling rate 0.0-1.0
 * - CRAFT_TRACING_MAX_ATTR_LENGTH: Max attribute string length
 */
export function loadTracingConfig(): TracingConfig {
  const enabled = process.env.CRAFT_TRACING_ENABLED === 'true';
  const exporterType = (process.env.CRAFT_TRACING_EXPORTER || 'otlp') as TracingConfig['exporterType'];

  return {
    enabled,
    endpoint: OTLP_ENDPOINT,
    headers: {}, // no custom headers
    exporterType,
    serviceName: process.env.OTEL_SERVICE_NAME || 'craft-terminal-agent',
    resourceAttributes: parseResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES),
    samplingRate: parseFloat(process.env.CRAFT_TRACING_SAMPLE_RATE || '1.0'),
    pii: {
      ...DEFAULT_PII_CONFIG,
      maxAttributeLength: parseInt(
        process.env.CRAFT_TRACING_MAX_ATTR_LENGTH || '500',
        10
      ),
    },
  };
}
