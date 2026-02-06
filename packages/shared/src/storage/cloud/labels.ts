/**
 * Cloud Label Storage
 *
 * Implements ILabelStorage via WebSocket mutations and REST reads.
 */

import type { ILabelStorage } from '../types.ts';
import type { WorkspaceLabelConfig, LabelConfig } from '../../labels/types.ts';
import type { CloudConnection } from './connection.ts';
import { getDefaultLabelConfig } from '../../labels/storage.ts';

/** Flatten label tree (depth-first) */
function flattenLabels(labels: LabelConfig[]): LabelConfig[] {
  const result: LabelConfig[] = [];
  for (const label of labels) {
    result.push(label);
    if (label.children) {
      result.push(...flattenLabels(label.children));
    }
  }
  return result;
}

/** Find label by ID in tree */
function findLabelById(labels: LabelConfig[], id: string): LabelConfig | null {
  for (const label of labels) {
    if (label.id === id) return label;
    if (label.children) {
      const found = findLabelById(label.children, id);
      if (found) return found;
    }
  }
  return null;
}

export class CloudLabelStorage implements ILabelStorage {
  constructor(private connection: CloudConnection) {}

  async loadLabelConfig(): Promise<WorkspaceLabelConfig> {
    try {
      const config = await this.connection.fetch<WorkspaceLabelConfig>('/labels');
      if (!config.labels || config.labels.length === 0) {
        return getDefaultLabelConfig();
      }
      return config;
    } catch {
      return getDefaultLabelConfig();
    }
  }

  async saveLabelConfig(config: WorkspaceLabelConfig): Promise<void> {
    await this.connection.send({
      type: 'labels:save',
      data: config as unknown as Record<string, unknown>,
    });
  }

  async listLabels(): Promise<LabelConfig[]> {
    const config = await this.loadLabelConfig();
    return config.labels;
  }

  async listLabelsFlat(): Promise<LabelConfig[]> {
    const config = await this.loadLabelConfig();
    return flattenLabels(config.labels);
  }

  async getLabel(labelId: string): Promise<LabelConfig | null> {
    const config = await this.loadLabelConfig();
    return findLabelById(config.labels, labelId);
  }
}
