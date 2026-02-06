/**
 * Storage Abstraction Layer
 *
 * Provides interchangeable storage backends for workspace data.
 */

// Types
export type {
  IStorageProvider,
  ISessionStorage,
  ISourceStorage,
  IStatusStorage,
  ILabelStorage,
  ISkillStorage,
  IAssetStorage,
  RemoteChangeEvent,
} from './types.ts';

// Local provider
export { LocalStorageProvider } from './local/index.ts';

// Cloud provider
export { CloudStorageProvider } from './cloud/index.ts';
export type { CloudStorageProviderConfig } from './cloud/index.ts';

// Factory
export { createStorageProvider } from './factory.ts';
