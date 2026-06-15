// Shared types for the Shadow unified gateway.

export type PrivacyTier =
  | "never_trains"
  | "opt_out"
  | "trains_no_opt_out"
  | "local_only";

export type ContentCategory =
  | "general"
  | "proprietary"
  | "health"
  | "financial"
  | "identity";

export interface ProviderConfig {
  // "openai" = OpenAI-compatible HTTP endpoint; "command" = shell out to an adapter
  // (e.g. a headless web session driving chatgpt.com) that speaks OpenAI JSON over stdin/stdout.
  type: "openai" | "command";
  baseUrl?: string;
  command?: string[]; // for type:"command" — argv; request JSON on stdin, OpenAI JSON on stdout
  models?: string[]; // static catalog for command lanes (e.g. web-only / sub-exclusive models)
  defaultModel?: string; // model id to use when a lane is chosen by privacy/task fallback rather than an explicit pick (e.g. the local model for a forced local_only route)
  apiKeyEnv: string | null;
  apiKeyDefault?: string;
  enabledIfKey?: boolean;
  enabled?: boolean; // explicit on/off (command lanes default off until validated)
  privacyTier: PrivacyTier;
  jurisdiction: string; // "us" | "sg" | "cn" | "local" | ...
  piiSafe: boolean;
  costModel: string;
  note?: string;
}

export interface VirtualModel {
  strategy: "route" | "fusion";
  description?: string;
  forcePrivacyTier?: PrivacyTier;
  members?: Array<{ provider: string; model: string }>;
  synthesizer?: { provider: string; model: string };
}

export interface AuthConfig {
  required: boolean;
  keyEnv: string;
  allowedHosts: string[];
}

export interface RouterConfig {
  listen: { host: string; port: number };
  auth?: AuthConfig;
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
  hiddenModels?: string[];
  virtualModels: Record<string, VirtualModel>;
  routing: {
    byTask: Record<string, { provider: string; model: string }>;
    // When a provider returns a quota/limit error, retry the request on these providers in order.
    // This is how subscription overflow works: Codex weekly-limited → chatgpt-web → openrouter.
    fallbacks?: Record<string, string[]>;
  };
}

export interface ChatMessage {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  [k: string]: unknown;
}

export interface RouteDecision {
  provider: string;
  model: string;
  reason: string;
  category: ContentCategory;
  excluded?: string[];
}
