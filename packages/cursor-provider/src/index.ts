/**
 * Cursor Provider
 *
 * Provides access to Cursor's LLM models (Claude, GPT, Gemini, Composer, etc.)
 * via Cursor's OAuth + gRPC protocol. The provider runs a local OpenAI-compatible
 * HTTP proxy that Craft treats as a custom endpoint.
 *
 * Architecture (adapted from the pi-cursor-provider reference):
 *
 *   Craft (openai-completions client)
 *     → http://127.0.0.1:<port>/v1/chat/completions   (proxy.ts)
 *         → h2-bridge.mjs  (Node http/2 subprocess)
 *             → https://api2.cursor.sh  (Cursor gRPC via Connect protocol)
 *
 *  OAuth: PKCE via cursor.com/loginDeepControl + api2.cursor.sh/auth/poll
 *         with api2.cursor.sh/auth/exchange_user_api_key for refresh.
 */

export {
  generateCursorAuthParams,
  pollCursorAuth,
  refreshCursorToken,
  getTokenExpiry,
  type CursorAuthParams,
  type CursorCredentials,
} from './auth.ts';

export {
  startProxy,
  stopProxy,
  getProxyPort,
  getCursorModels,
  cleanupAllSessionState,
  cleanupSessionState,
  type CursorModel,
} from './proxy.ts';

export {
  parseModelId,
  processModels,
  buildEffortMap,
  supportsReasoningModelId,
  buildModelDefinitions,
  type ProcessedCursorModel,
} from './models.ts';

export { FALLBACK_MODELS } from './fallback-models.ts';
