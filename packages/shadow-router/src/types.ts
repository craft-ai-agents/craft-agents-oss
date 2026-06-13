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
  type: "openai";
  baseUrl: string;
  apiKeyEnv: string | null;
  apiKeyDefault?: string;
  enabledIfKey?: boolean;
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
  routing: { byTask: Record<string, { provider: string; model: string }> };
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
