/**
 * Session Storage
 *
 * Workspace-scoped session CRUD operations.
 * Sessions are stored at {workspaceRootPath}/sessions/{id}/session.json
 * Each session folder contains:
 * - session.json (main data)
 * - attachments/ (file attachments)
 * - plans/ (plan files for Safe Mode)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  rmSync,
  statSync,
} from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getWorkspaceSessionsPath } from '../workspaces/storage.ts';
import { toPortablePath, expandPath } from '../utils/paths.ts';
import type {
  SessionConfig,
  StoredSession,
  SessionMetadata,
  SessionTokenUsage,
  TodoState,
} from './types.ts';
import type { Plan } from '../agents/plan-types.ts';
import { validateSessionStatus } from '../statuses/validation.ts';
import { getStatusCategory } from '../statuses/storage.ts';

// Re-export types for convenience
export type { SessionConfig } from './types.ts';

// ============================================================
// Directory Utilities
// ============================================================

/**
 * Ensure sessions directory exists for a workspace
 */
export function ensureSessionsDir(workspaceRootPath: string): string {
  const dir = getWorkspaceSessionsPath(workspaceRootPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get path to a session's directory
 */
export function getSessionPath(workspaceRootPath: string, sessionId: string): string {
  return join(getWorkspaceSessionsPath(workspaceRootPath), sessionId);
}

/**
 * Get path to a session's JSON file (inside session folder)
 */
export function getSessionFilePath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'session.json');
}

/**
 * Ensure session directory exists with all subdirectories
 */
export function ensureSessionDir(workspaceRootPath: string, sessionId: string): string {
  const sessionDir = getSessionPath(workspaceRootPath, sessionId);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  // Also create plans and attachments directories
  const plansDir = join(sessionDir, 'plans');
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true });
  }
  const attachmentsDir = join(sessionDir, 'attachments');
  if (!existsSync(attachmentsDir)) {
    mkdirSync(attachmentsDir, { recursive: true });
  }
  return sessionDir;
}

/**
 * Get the attachments directory for a session
 */
export function getSessionAttachmentsPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'attachments');
}

/**
 * Get the plans directory for a session
 */
export function getSessionPlansPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'plans');
}

// ============================================================
// Session ID Generation
// ============================================================

/**
 * Generate a UUID for session IDs
 */
export function generateSessionId(): string {
  return randomUUID();
}

// ============================================================
// Session CRUD
// ============================================================

/**
 * Create a new session for a workspace
 */
export function createSession(
  workspaceRootPath: string,
  options?: {
    name?: string;
    agentSlug?: string;
    agentName?: string;
    workingDirectory?: string;
    permissionMode?: SessionConfig['permissionMode'];
    enabledSourceSlugs?: string[];
  }
): SessionConfig {
  ensureSessionsDir(workspaceRootPath);

  const now = Date.now();
  const sessionId = generateSessionId();

  // Create session directory with all subdirectories (plans, attachments)
  ensureSessionDir(workspaceRootPath, sessionId);

  const session: SessionConfig = {
    id: sessionId,
    workspaceRootPath,
    name: options?.name,
    createdAt: now,
    lastUsedAt: now,
    agentSlug: options?.agentSlug,
    agentName: options?.agentName,
    workingDirectory: options?.workingDirectory,
    permissionMode: options?.permissionMode,
    enabledSourceSlugs: options?.enabledSourceSlugs,
  };

  // Save empty session
  const storedSession: StoredSession = {
    ...session,
    messages: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
  };
  saveSession(storedSession);

  return session;
}

/**
 * Get or create a session with a specific ID
 * Used for --session <id> flag to allow user-defined session IDs
 */
export function getOrCreateSessionById(
  workspaceRootPath: string,
  sessionId: string
): SessionConfig {
  const existing = loadSession(workspaceRootPath, sessionId);
  if (existing) {
    return {
      id: existing.id,
      sdkSessionId: existing.sdkSessionId,
      workspaceRootPath: existing.workspaceRootPath,
      name: existing.name,
      createdAt: existing.createdAt,
      lastUsedAt: existing.lastUsedAt,
      agentSlug: existing.agentSlug,
      agentName: existing.agentName,
    };
  }

  // Create new session with the specified ID
  ensureSessionsDir(workspaceRootPath);

  // Create session directory with all subdirectories (plans, attachments)
  ensureSessionDir(workspaceRootPath, sessionId);

  const now = Date.now();
  const session: SessionConfig = {
    id: sessionId,
    workspaceRootPath,
    createdAt: now,
    lastUsedAt: now,
  };

  const storedSession: StoredSession = {
    ...session,
    messages: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
  };
  saveSession(storedSession);

  return session;
}

/**
 * Save session (conversation data + metadata)
 */
export function saveSession(session: StoredSession): void {
  ensureSessionsDir(session.workspaceRootPath);
  // Ensure session directory exists (creates plans/attachments subdirs too)
  ensureSessionDir(session.workspaceRootPath, session.id);
  const filePath = getSessionFilePath(session.workspaceRootPath, session.id);

  // Store with portable paths for cross-machine compatibility
  const storageSession: StoredSession = {
    ...session,
    workspaceRootPath: toPortablePath(session.workspaceRootPath),
    // Also make workingDirectory portable if set
    workingDirectory: session.workingDirectory ? toPortablePath(session.workingDirectory) : undefined,
    lastUsedAt: Date.now(),
  };

  writeFileSync(filePath, JSON.stringify(storageSession, null, 2), 'utf-8');
}

/**
 * Load session by ID
 * Loads session from folder structure
 */
export function loadSession(workspaceRootPath: string, sessionId: string): StoredSession | null {
  // Load from folder structure: {id}/session.json
  const filePath = getSessionFilePath(workspaceRootPath, sessionId);
  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      const session = JSON.parse(content) as StoredSession;
      // Expand portable paths (e.g., ~/.craft-agent/...) to absolute paths
      // This ensures all code using the loaded session gets absolute paths
      session.workspaceRootPath = expandPath(session.workspaceRootPath);
      if (session.workingDirectory) {
        session.workingDirectory = expandPath(session.workingDirectory);
      }
      return session;
    }
  } catch {
    // Session not found
  }

  return null;
}

/**
 * List sessions for a workspace
 * Lists sessions from folder structure
 */
export function listSessions(workspaceRootPath: string): SessionMetadata[] {
  const sessionsDir = getWorkspaceSessionsPath(workspaceRootPath);
  if (!existsSync(sessionsDir)) {
    return [];
  }

  const entries = readdirSync(sessionsDir, { withFileTypes: true });
  const sessions: SessionMetadata[] = [];

  // Process session folders: {id}/session.json
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const sessionId = entry.name;
      const sessionFile = join(sessionsDir, sessionId, 'session.json');
      if (existsSync(sessionFile)) {
        try {
          const content = readFileSync(sessionFile, 'utf-8');
          const session = JSON.parse(content) as StoredSession;
          const metadata = extractSessionMetadata(session, workspaceRootPath);
          if (metadata) sessions.push(metadata);
        } catch {
          // Skip invalid files
        }
      }
    }
  }

  // Sort by lastUsedAt descending (most recent first)
  return sessions.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/**
 * Extract metadata from a stored session
 * @param session - Raw session loaded from JSON (may have portable workspaceRootPath)
 * @param workspaceRootPath - Actual expanded workspace root path (used for filesystem ops)
 */
function extractSessionMetadata(session: StoredSession, workspaceRootPath: string): SessionMetadata | null {
  try {
    // Find first user message for preview
    const firstUserMessage = session.messages?.find(m => m.type === 'user');
    const preview = firstUserMessage?.content?.replace(/\n/g, ' ').substring(0, 150);

    // Extract distinct agent names from "Now chatting with @<name>" messages
    const agentPattern = /Now chatting with @(\S+)/g;
    const agents = new Set<string>();
    for (const msg of session.messages ?? []) {
      if (msg.content) {
        let match;
        while ((match = agentPattern.exec(msg.content)) !== null) {
          if (match[1]) {
            agents.add(match[1]);
          }
        }
      }
    }

    // Count plan files for this session (use actual path for filesystem ops)
    const planCount = listPlanFiles(workspaceRootPath, session.id).length;

    // Validate todoState against workspace status config (use actual path)
    const validatedTodoState = validateSessionStatus(workspaceRootPath, session.todoState);

    // If validation changed the status, auto-save corrected value
    if (validatedTodoState !== session.todoState) {
      console.warn(
        `[extractSessionMetadata] Session ${session.id} had invalid status '${session.todoState}', ` +
        `reset to '${validatedTodoState}'`
      );
      session.todoState = validatedTodoState;
      // Use actual path for saving (saveSession will convert back to portable)
      saveSession({ ...session, workspaceRootPath });
    }

    return {
      id: session.id,
      // Return expanded path so callers get usable paths
      workspaceRootPath,
      name: session.name,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      messageCount: session.messages?.length ?? 0,
      preview,
      sdkSessionId: session.sdkSessionId,
      agentSlug: session.agentSlug,
      agentName: session.agentName,
      isFlagged: session.isFlagged,
      todoState: validatedTodoState,
      agents: agents.size > 0 ? Array.from(agents) : undefined,
      planCount: planCount > 0 ? planCount : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Delete a session and its associated files
 * Deletes session folder and all associated files
 */
export function deleteSession(workspaceRootPath: string, sessionId: string): boolean {
  try {
    // Delete session directory (includes session.json, attachments, plans)
    const sessionDir = getSessionPath(workspaceRootPath, sessionId);
    if (existsSync(sessionDir)) {
      rmSync(sessionDir, { recursive: true });
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Get or create the latest session for a workspace
 */
export function getOrCreateLatestSession(workspaceRootPath: string): SessionConfig {
  const sessions = listSessions(workspaceRootPath);
  if (sessions.length > 0 && sessions[0]) {
    const latest = sessions[0];
    return {
      id: latest.id,
      sdkSessionId: latest.sdkSessionId,
      workspaceRootPath: latest.workspaceRootPath,
      name: latest.name,
      createdAt: latest.createdAt,
      lastUsedAt: latest.lastUsedAt,
      agentSlug: latest.agentSlug,
      agentName: latest.agentName,
    };
  }
  return createSession(workspaceRootPath);
}

// ============================================================
// Session Metadata Updates
// ============================================================

/**
 * Update SDK session ID for a session
 */
export function updateSessionSdkId(
  workspaceRootPath: string,
  sessionId: string,
  sdkSessionId: string
): void {
  const session = loadSession(workspaceRootPath, sessionId);
  if (session) {
    session.sdkSessionId = sdkSessionId;
    saveSession(session);
  }
}

/**
 * Update session metadata
 */
export function updateSessionMetadata(
  workspaceRootPath: string,
  sessionId: string,
  updates: Partial<Pick<SessionConfig,
    | 'agentSlug'
    | 'agentName'
    | 'isFlagged'
    | 'name'
    | 'todoState'
    | 'lastReadMessageId'
    | 'enabledSourceSlugs'
    | 'workingDirectory'
    | 'permissionMode'
  >>
): void {
  const session = loadSession(workspaceRootPath, sessionId);
  if (!session) return;

  if (updates.agentSlug !== undefined) session.agentSlug = updates.agentSlug;
  if (updates.agentName !== undefined) session.agentName = updates.agentName;
  if (updates.isFlagged !== undefined) session.isFlagged = updates.isFlagged;
  if (updates.name !== undefined) session.name = updates.name;
  if (updates.todoState !== undefined) session.todoState = updates.todoState;
  if (updates.enabledSourceSlugs !== undefined) session.enabledSourceSlugs = updates.enabledSourceSlugs;
  if (updates.workingDirectory !== undefined) session.workingDirectory = updates.workingDirectory;
  if (updates.permissionMode !== undefined) session.permissionMode = updates.permissionMode;
  if ('lastReadMessageId' in updates) session.lastReadMessageId = updates.lastReadMessageId;

  saveSession(session);
}

/**
 * Flag a session
 */
export function flagSession(workspaceRootPath: string, sessionId: string): void {
  updateSessionMetadata(workspaceRootPath, sessionId, { isFlagged: true });
}

/**
 * Unflag a session
 */
export function unflagSession(workspaceRootPath: string, sessionId: string): void {
  updateSessionMetadata(workspaceRootPath, sessionId, { isFlagged: false });
}

/**
 * Set todo state for a session
 */
export function setSessionTodoState(
  workspaceRootPath: string,
  sessionId: string,
  todoState: TodoState
): void {
  updateSessionMetadata(workspaceRootPath, sessionId, { todoState });
}

/**
 * Assign agent to a session
 */
export function assignAgentToSession(
  workspaceRootPath: string,
  sessionId: string,
  agentSlug: string,
  agentName?: string
): void {
  updateSessionMetadata(workspaceRootPath, sessionId, { agentSlug, agentName });
}

// ============================================================
// Session Filtering
// ============================================================

/**
 * List flagged sessions
 */
export function listFlaggedSessions(workspaceRootPath: string): SessionMetadata[] {
  return listSessions(workspaceRootPath).filter(s => s.isFlagged === true);
}

/**
 * List completed sessions (category: closed)
 * Includes done, cancelled, and any custom "closed" statuses
 */
export function listCompletedSessions(workspaceRootPath: string): SessionMetadata[] {
  return listSessions(workspaceRootPath).filter(s => {
    const category = getStatusCategory(workspaceRootPath, s.todoState || 'todo');
    return category === 'closed';
  });
}

/**
 * List inbox sessions (category: open)
 * Includes todo, in-progress, needs-review, and any custom "open" statuses
 */
export function listInboxSessions(workspaceRootPath: string): SessionMetadata[] {
  return listSessions(workspaceRootPath).filter(s => {
    const category = getStatusCategory(workspaceRootPath, s.todoState || 'todo');
    return category === 'open';
  });
}

/**
 * List sessions by agent
 */
export function listSessionsByAgent(
  workspaceRootPath: string,
  agentSlug: string
): SessionMetadata[] {
  return listSessions(workspaceRootPath).filter(s => s.agentSlug === agentSlug);
}

// ============================================================
// Plan Storage (Session-Scoped)
// ============================================================

/**
 * Slugify a string for file names
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
}

/**
 * Generate a unique, readable file name for a plan
 */
function generatePlanFileName(plan: Plan, plansDir: string): string {
  let name = plan.title || plan.context?.substring(0, 50) || 'untitled';
  let slug = slugify(name);

  if (slug.length > 40) {
    slug = slug.substring(0, 40).replace(/-$/, '');
  }

  const date = new Date().toISOString().split('T')[0];
  const baseName = `${date}-${slug}`;

  let fileName = baseName;
  let counter = 2;

  while (existsSync(join(plansDir, `${fileName}.md`))) {
    fileName = `${baseName}-${counter}`;
    counter++;
  }

  return fileName;
}

/**
 * Ensure the plans directory exists
 */
function ensurePlansDir(workspaceRootPath: string, sessionId: string): string {
  const plansDir = getSessionPlansPath(workspaceRootPath, sessionId);
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true });
  }
  return plansDir;
}

/**
 * Format a plan as markdown
 */
export function formatPlanAsMarkdown(plan: Plan): string {
  const lines: string[] = [];

  lines.push(`# ${plan.title}`);
  lines.push('');
  lines.push(`**Status:** ${plan.state}`);
  lines.push(`**Created:** ${new Date(plan.createdAt).toISOString()}`);
  if (plan.updatedAt !== plan.createdAt) {
    lines.push(`**Updated:** ${new Date(plan.updatedAt).toISOString()}`);
  }
  lines.push('');

  if (plan.context) {
    lines.push('## Summary');
    lines.push('');
    lines.push(plan.context);
    lines.push('');
  }

  lines.push('## Steps');
  lines.push('');
  for (const step of plan.steps) {
    const checkbox = step.status === 'completed' ? '[x]' : '[ ]';
    const status = step.status === 'in_progress' ? ' *(in progress)*' : '';
    lines.push(`- ${checkbox} ${step.description}${status}`);
    if (step.details) {
      lines.push(`  - Tools: ${step.details}`);
    }
  }
  lines.push('');

  if (plan.refinementHistory && plan.refinementHistory.length > 0) {
    lines.push('## Refinement History');
    lines.push('');
    for (const entry of plan.refinementHistory) {
      lines.push(`### Round ${entry.round}`);
      lines.push(`**Feedback:** ${entry.feedback}`);
      if (entry.questions && entry.questions.length > 0) {
        lines.push(`**Questions:** ${entry.questions.join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Parse a markdown plan file back to a Plan object
 */
export function parsePlanFromMarkdown(content: string, planId: string): Plan | null {
  try {
    const lines = content.split('\n');

    const titleLine = lines.find(l => l.startsWith('# '));
    const title = titleLine ? titleLine.substring(2).trim() : 'Untitled Plan';

    const statusLine = lines.find(l => l.startsWith('**Status:**'));
    const stateStr = statusLine ? statusLine.replace('**Status:**', '').trim() : 'ready';
    const state = (['creating', 'refining', 'ready', 'executing', 'completed', 'cancelled'].includes(stateStr)
      ? stateStr
      : 'ready') as Plan['state'];

    const summaryIdx = lines.findIndex(l => l === '## Summary');
    const stepsIdx = lines.findIndex(l => l === '## Steps');
    let context = '';
    if (summaryIdx !== -1 && stepsIdx !== -1) {
      context = lines.slice(summaryIdx + 2, stepsIdx).join('\n').trim();
    }

    const steps: Plan['steps'] = [];
    if (stepsIdx !== -1) {
      for (let i = stepsIdx + 2; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.startsWith('##')) break;
        if (line.startsWith('- [')) {
          const isCompleted = line.startsWith('- [x]');
          const isInProgress = line.includes('*(in progress)*');
          const description = line
            .replace(/^- \[[ x]\] /, '')
            .replace(' *(in progress)*', '')
            .trim();
          steps.push({
            id: `step-${steps.length + 1}`,
            description,
            status: isCompleted ? 'completed' : isInProgress ? 'in_progress' : 'pending',
          });
        }
      }
    }

    return {
      id: planId,
      title,
      state,
      context,
      steps,
      refinementRound: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Save a plan to a markdown file
 */
export function savePlanToFile(
  workspaceRootPath: string,
  sessionId: string,
  plan: Plan,
  fileName?: string
): string {
  const plansDir = ensurePlansDir(workspaceRootPath, sessionId);
  const name = fileName || generatePlanFileName(plan, plansDir);
  const filePath = join(plansDir, `${name}.md`);
  const content = formatPlanAsMarkdown(plan);

  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Load a plan from a markdown file by name
 */
export function loadPlanFromFile(
  workspaceRootPath: string,
  sessionId: string,
  fileName: string
): Plan | null {
  const plansDir = getSessionPlansPath(workspaceRootPath, sessionId);
  const filePath = join(plansDir, `${fileName}.md`);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return parsePlanFromMarkdown(content, fileName);
  } catch {
    return null;
  }
}

/**
 * Load a plan from a full file path
 */
export function loadPlanFromPath(filePath: string): Plan | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const fileName = filePath.split('/').pop()?.replace('.md', '') || 'unknown';
    return parsePlanFromMarkdown(content, fileName);
  } catch {
    return null;
  }
}

/**
 * List all plan files in a session
 */
export function listPlanFiles(
  workspaceRootPath: string,
  sessionId: string
): Array<{ name: string; path: string; modifiedAt: number }> {
  const plansDir = getSessionPlansPath(workspaceRootPath, sessionId);
  if (!existsSync(plansDir)) {
    return [];
  }

  try {
    const files = readdirSync(plansDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const filePath = join(plansDir, f);
        const stats = existsSync(filePath) ? statSync(filePath) : null;
        return {
          name: f.replace('.md', ''),
          path: filePath,
          modifiedAt: stats?.mtimeMs || 0,
        };
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt);

    return files;
  } catch {
    return [];
  }
}

/**
 * Delete a plan file
 */
export function deletePlanFile(
  workspaceRootPath: string,
  sessionId: string,
  fileName: string
): boolean {
  const plansDir = getSessionPlansPath(workspaceRootPath, sessionId);
  const filePath = join(plansDir, `${fileName}.md`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Get the most recent plan file for a session
 */
export function getMostRecentPlanFile(
  workspaceRootPath: string,
  sessionId: string
): { name: string; path: string } | null {
  const files = listPlanFiles(workspaceRootPath, sessionId);
  return files.length > 0 ? files[0]! : null;
}

// ============================================================
// Attachments Directory
// ============================================================

/**
 * Ensure attachments directory exists
 */
export function ensureAttachmentsDir(workspaceRootPath: string, sessionId: string): string {
  const dir = getSessionAttachmentsPath(workspaceRootPath, sessionId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
