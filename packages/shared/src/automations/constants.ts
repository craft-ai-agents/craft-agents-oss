/** Canonical config filename */
export const AUTOMATIONS_CONFIG_FILE = 'automations.json';

/** Legacy config filenames (still accepted for migration) */
export const LEGACY_CONFIG_FILES = ['tasks.json', 'hooks.json'] as const;

/** All recognized config filenames (canonical + legacy) */
export const ALL_CONFIG_FILES = [AUTOMATIONS_CONFIG_FILE, ...LEGACY_CONFIG_FILES] as const;

/** History log filename */
export const AUTOMATIONS_HISTORY_FILE = 'automations-history.jsonl';
