/**
 * Local Label Storage
 *
 * Delegates to existing label storage functions from labels/storage.ts
 */

import type { ILabelStorage } from '../types.ts';
import type { WorkspaceLabelConfig, LabelConfig } from '../../labels/types.ts';

import {
  loadLabelConfig as fsLoadLabelConfig,
  saveLabelConfig as fsSaveLabelConfig,
  listLabels as fsListLabels,
  listLabelsFlat as fsListLabelsFlat,
  getLabel as fsGetLabel,
} from '../../labels/storage.ts';

export class LocalLabelStorage implements ILabelStorage {
  constructor(private rootPath: string) {}

  async loadLabelConfig(): Promise<WorkspaceLabelConfig> {
    return fsLoadLabelConfig(this.rootPath);
  }

  async saveLabelConfig(config: WorkspaceLabelConfig): Promise<void> {
    fsSaveLabelConfig(this.rootPath, config);
  }

  async listLabels(): Promise<LabelConfig[]> {
    return fsListLabels(this.rootPath);
  }

  async listLabelsFlat(): Promise<LabelConfig[]> {
    return fsListLabelsFlat(this.rootPath);
  }

  async getLabel(labelId: string): Promise<LabelConfig | null> {
    return fsGetLabel(this.rootPath, labelId);
  }
}
