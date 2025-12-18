import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
  };
}

/**
 * Read Claude OAuth token from macOS Keychain
 */
function readFromKeychain(): string | null {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    const result = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (result) {
      const credentials: ClaudeCredentials = JSON.parse(result);
      return credentials.claudeAiOauth?.accessToken || null;
    }
  } catch {
    // Keychain entry not found or parse error
  }
  return null;
}

/**
 * Read Claude OAuth token from credentials file (Linux/fallback)
 */
function readFromCredentialsFile(): string | null {
  const credentialsPath = join(homedir(), '.claude', '.credentials.json');

  try {
    if (existsSync(credentialsPath)) {
      const content = readFileSync(credentialsPath, 'utf-8');
      const credentials: ClaudeCredentials = JSON.parse(content);
      return credentials.claudeAiOauth?.accessToken || null;
    }
  } catch {
    // File not found or parse error
  }
  return null;
}

/**
 * Get existing Claude OAuth token from keychain or credentials file
 */
export function getExistingClaudeToken(): string | null {
  // Try keychain first (macOS)
  const keychainToken = readFromKeychain();
  if (keychainToken) {
    return keychainToken;
  }

  // Fall back to credentials file
  return readFromCredentialsFile();
}

/**
 * Check if Claude CLI is installed
 */
export function isClaudeCliInstalled(): boolean {
  try {
    execSync('which claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `claude setup-token` interactively
 * Returns a promise that resolves when the process completes
 */
export function runClaudeSetupToken(
  onStatus: (message: string) => void
): Promise<{ success: boolean; token?: string; error?: string }> {
  return new Promise((resolve) => {
    onStatus('Starting Claude setup-token...');

    const child = spawn('claude', ['setup-token'], {
      stdio: 'inherit', // Allow interactive terminal
      shell: true,
    });

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    child.on('close', (code) => {
      if (code === 0) {
        // Wait a moment for the token to be written
        setTimeout(() => {
          const token = getExistingClaudeToken();
          if (token) {
            resolve({ success: true, token });
          } else {
            resolve({ success: false, error: 'Token not found after setup' });
          }
        }, 500);
      } else {
        resolve({ success: false, error: `Process exited with code ${code}` });
      }
    });
  });
}
