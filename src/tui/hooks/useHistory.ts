import { useState, useCallback } from 'react';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { ensureConfigDir } from '../../config/storage.ts';

const MAX_HISTORY_SIZE = 100;
const HISTORY_FILE = join(homedir(), '.craft-agent', 'history.json');

function loadHistory(): string[] {
  try {
    if (!existsSync(HISTORY_FILE)) {
      return [];
    }
    const content = readFileSync(HISTORY_FILE, 'utf-8');
    const data = JSON.parse(content);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveHistory(history: string[]): void {
  ensureConfigDir();
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

export interface UseHistoryResult {
  history: string[];
  addToHistory: (input: string) => void;
  clearHistory: () => void;
}

export function useHistory(): UseHistoryResult {
  const [history, setHistory] = useState<string[]>(() => loadHistory());

  const addToHistory = useCallback((input: string) => {
    setHistory((prev) => {
      // Don't add duplicates of the last entry
      if (prev.length > 0 && prev[prev.length - 1] === input) {
        return prev;
      }

      const newHistory = [...prev, input];

      // Keep history within bounds
      if (newHistory.length > MAX_HISTORY_SIZE) {
        const trimmed = newHistory.slice(-MAX_HISTORY_SIZE);
        saveHistory(trimmed);
        return trimmed;
      }

      saveHistory(newHistory);
      return newHistory;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  return { history, addToHistory, clearHistory };
}
