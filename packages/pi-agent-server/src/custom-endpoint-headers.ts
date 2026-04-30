import { APP_VERSION } from '../../shared/src/version/index.ts';

export function buildCustomEndpointRequestHeaders(): Record<string, string> {
  return {
    'User-Agent': `CraftAgents/${APP_VERSION}`,
  };
}
