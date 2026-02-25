/**
 * Global memory config service (MemOS / OpenMem).
 * Reads and writes ~/.craft-agent/memory.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '@craft-agent/shared/config';
import type { MemoryConfig } from '../../shared/types';

const MEMORY_CONFIG_FILE = join(CONFIG_DIR, 'memory.json');

const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: false,
  apiKey: '',
  userId: '',
};

export function getMemoryConfig(): MemoryConfig {
  if (!existsSync(MEMORY_CONFIG_FILE)) {
    return { ...DEFAULT_MEMORY_CONFIG };
  }
  try {
    const raw = readFileSync(MEMORY_CONFIG_FILE, 'utf-8');
    const data = JSON.parse(raw) as Partial<MemoryConfig>;
    return {
      enabled: data.enabled ?? false,
      apiKey: data.apiKey ?? '',
      userId: data.userId ?? '',
      baseUrl: data.baseUrl,
    };
  } catch (err) {
    console.error('[memory-service] Failed to read config:', err);
    return { ...DEFAULT_MEMORY_CONFIG };
  }
}

export function setMemoryConfig(config: MemoryConfig): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(MEMORY_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[memory-service] Failed to write config:', err);
    throw new Error('Failed to save memory config');
  }
}
