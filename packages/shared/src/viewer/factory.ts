import type { ViewerService, ViewerConfig } from './types';
import CraftHostedViewer from './craft-hosted-viewer';
import StaticExportViewer from './static-export-viewer';

/**
 * Create a viewer service based on configuration
 *
 * @param config - Optional viewer configuration. If not provided or type is 'craft-hosted',
 *                 defaults to CraftHostedViewer with agents.craft.do
 * @returns A ViewerService implementation
 * @throws Error if required config fields are missing for the specified type
 *
 * @example
 * // Default craft-hosted viewer
 * const viewer = createViewerService();
 *
 * @example
 * // Static export viewer
 * const viewer = createViewerService({
 *   type: 'static-export',
 *   exportPath: '~/exports',
 *   uploadCommand: 'aws s3 sync ~/exports s3://bucket'
 * });
 */
export function createViewerService(config?: ViewerConfig): ViewerService {
  // Default to craft-hosted if no config
  if (!config || config.type === 'craft-hosted') {
    const url = config?.craftUrl || 'https://agents.craft.do';
    return new CraftHostedViewer(url);
  }

  switch (config.type) {
    case 'static-export':
      if (!config.exportPath) {
        throw new Error('Static export viewer requires exportPath configuration');
      }
      return new StaticExportViewer(config.exportPath, config.uploadCommand);

    default:
      // Fallback to default craft-hosted for unknown types
      return new CraftHostedViewer();
  }
}
