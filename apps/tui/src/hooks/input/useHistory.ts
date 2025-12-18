import { useState, useCallback } from 'react';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { ensureConfigDir } from '@craft-agent/shared/config';

const MAX_HISTORY_SIZE = 100;
const TEST_INPUT_HISTORY_FILE = join(homedir(), '.craft-agent', 'input_history.json');

function loadTextInputHistory(): string[] {
  try {
    if (!existsSync(TEST_INPUT_HISTORY_FILE)) {
      return [];
    }
    const content = readFileSync(TEST_INPUT_HISTORY_FILE, 'utf-8');
    const data = JSON.parse(content);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveTextInputHistory(history: string[]): void {
  ensureConfigDir();
  writeFileSync(TEST_INPUT_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

export interface UseHistoryResult {
  history: string[];
  addToHistory: (input: string) => void;
  clearHistory: () => void;
}

export function useHistory(): UseHistoryResult {
  const [history, setHistory] = useState<string[]>(() => loadTextInputHistory());

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
        saveTextInputHistory(trimmed);
        return trimmed;
      }

      saveTextInputHistory(newHistory);
      return newHistory;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveTextInputHistory([]);
  }, []);

  return { history, addToHistory, clearHistory };
}
