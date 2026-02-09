/**
 * Centralized path configuration for G4 OS.
 *
 * Supports multi-instance development via G4OS_CONFIG_DIR environment variable.
 * When running from a numbered folder (e.g., g4os-1) the detect-instance.sh
 * script sets G4OS_CONFIG_DIR to ~/.g4os-1, allowing multiple instances to run
 * simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.g4os/
 * Instance 1 (-1 suffix): ~/.g4os-1/
 * Instance 2 (-2 suffix): ~/.g4os-2/
 */

import { homedir } from 'os';
import { join } from 'path';

// Allow override via environment variable for multi-instance dev
// Falls back to default ~/.g4os/ for production and non-numbered dev folders
export const CONFIG_DIR = process.env.G4OS_CONFIG_DIR || join(homedir(), '.g4os');
