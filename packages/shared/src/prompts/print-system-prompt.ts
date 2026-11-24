#!/usr/bin/env bun
/**
 * Debug script to print the full Craft Agent system prompt with annotations.
 * Shows both the static system prompt and dynamic user message context components.
 *
 * Run with: bun run print:system-prompt
 * Coding mode (agent profile `coding`): bun run print:system-prompt --coding
 */

import { getSystemPrompt, getDateTimeContext, getWorkingDirectoryContext } from './system.ts';
import { formatSessionState } from '../agent/mode-manager.ts';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
};

function printHeader(title: string, bgColor: string = colors.bgBlue) {
  const padding = ' '.repeat(Math.max(0, 78 - title.length));
  console.log(`\n${bgColor}${colors.bold} ${title}${padding} ${colors.reset}`);
}

function printSection(title: string, content: string, color: string = colors.cyan) {
  console.log('\n' + '─'.repeat(80));
  console.log(`${color}${colors.bold}▶ ${title}${colors.reset}`);
  console.log('─'.repeat(80));
  console.log(content);
}

function printAnnotation(text: string) {
  console.log(`${colors.dim}${colors.yellow}// ${text}${colors.reset}`);
}

// ============================================================
// MAIN OUTPUT
// ============================================================

console.log(`
${colors.bgMagenta}${colors.bold}                                                                                ${colors.reset}
${colors.bgMagenta}${colors.bold}                    CRAFT AGENT SYSTEM PROMPT BREAKDOWN                         ${colors.reset}
${colors.bgMagenta}${colors.bold}                                                                                ${colors.reset}
`);

// ------------------------------------------------------------
// PART 1: STATIC SYSTEM PROMPT
// ------------------------------------------------------------

printHeader('PART 1: STATIC SYSTEM PROMPT (systemPrompt.append)');
printAnnotation('Built once per session, passed to SDK, enables prompt caching');
printAnnotation('The SDK also uses preset: "claude_code" which adds Claude Code\'s base system prompt');
printAnnotation('');
printAnnotation('Composed of:');
printAnnotation('  1. Craft Agent Environment Marker - version, platform, arch');
printAnnotation('  2. Core Instructions - capabilities, sources, guidelines');
printAnnotation('  3. Configuration Documentation Refs - permissions, skills, themes, statuses');
printAnnotation('  4. Permission Modes Documentation - inlined in system prompt');
printAnnotation('  5. Error Handling & Tool Metadata - guidelines for tool usage');
printAnnotation('  6. User Preferences (if set) - formatPreferencesForPrompt()');
printAnnotation('  7. Project context block (if session is bound to a project)');
printAnnotation('  8. Debug Mode Context (if enabled) - formatDebugModeContext()');
printAnnotation('  9. Project context file manifest - getProjectContextFilesPrompt()');

const agentProfile = process.argv.includes('--coding') ? 'coding' as const : 'default' as const;
if (agentProfile === 'coding') printAnnotation('Agent profile: coding (coding mode base prompt)');

const systemPrompt = getSystemPrompt(
  undefined, // No pinned preferences (use current from disk)
  { enabled: false }, // Debug mode disabled for cleaner output
  '/Users/example/.craft-agent/workspaces/abc123', // Example workspace path
  undefined, undefined, undefined, undefined, undefined,
  agentProfile,
);

printSection('FULL STATIC SYSTEM PROMPT', systemPrompt, colors.green);

console.log(`\n${colors.bold}Static System Prompt Length: ${systemPrompt.length.toLocaleString()} characters${colors.reset}`);

// Show with debug mode enabled
const systemPromptWithDebug = getSystemPrompt(
  undefined,
  { enabled: true, logFilePath: '~/Library/Logs/@craft-agent/electron/main.log' },
  '/Users/example/.craft-agent/workspaces/abc123',
  undefined, undefined, undefined, undefined, undefined,
  agentProfile,
);
console.log(`${colors.dim}With debug mode: ${systemPromptWithDebug.length.toLocaleString()} characters (+${(systemPromptWithDebug.length - systemPrompt.length).toLocaleString()})${colors.reset}`);

// ------------------------------------------------------------
// PART 2: DYNAMIC USER MESSAGE CONTEXT
// ------------------------------------------------------------

printHeader('PART 2: DYNAMIC USER MESSAGE CONTEXT (per message)');
printAnnotation('These components are prepended to every user message');
printAnnotation('Placed in user messages (not system prompt) to enable prompt caching');
printAnnotation('');
printAnnotation('Volatile vs stable (issue #862): date/time, session_state, sources, and');
printAnnotation('volatile git status change per turn. Workspace capabilities, working directory,');
printAnnotation('and stable git repo metadata are STABLE for the session.');
printAnnotation('  - Claude path: all blocks ride the user-message tail (system prompt stays cacheable).');
printAnnotation('  - Pi path: STABLE blocks fold into the system prefix, VOLATILE blocks ride the');
printAnnotation('    user tail — so the cached prefix is not re-stamped every turn.');

// 1. Date/Time
printSection('1. DATE/TIME CONTEXT - getDateTimeContext()', getDateTimeContext(), colors.magenta);
printAnnotation('Added first to user message for prompt caching optimization');

// 2. Session State
const sessionState = formatSessionState('260121-example-session', {
  plansFolderPath:
    '/Users/example/.craft-agent/workspaces/abc123/sessions/260121-example-session/plans',
});
printSection('2. SESSION STATE - formatSessionState()', sessionState, colors.magenta);
printAnnotation('Contains: sessionId, permissionMode, modeTransition/modeChangedBy/modeChangedAt/modeVersion (when available), plansFolderPath');

// 3. Source State (example - can't call formatSourceState without agent instance)
const exampleSourceState = `<sources>
Active: linear, github
Inactive: slack (inactive), notion (needs auth)

New:
- linear: Project and issue tracking for software teams

<source_issue source="notion">
Authentication required. Use the source_oauth_trigger tool to authenticate.
</source_issue>
</sources>`;
printSection('3. SOURCE STATE - formatSourceState() [example]', exampleSourceState, colors.magenta);
printAnnotation('Generated by CraftAgent.formatSourceState() - requires agent instance');
printAnnotation('Tracks: active sources, inactive sources, new sources (first time seen), auth issues');

// 4. Workspace Capabilities
const exampleCapabilities = `<workspace_capabilities>
local-mcp: enabled (stdio subprocess servers supported)
</workspace_capabilities>`;
printSection(
  '4. WORKSPACE CAPABILITIES - formatWorkspaceCapabilities()',
  exampleCapabilities,
  colors.magenta
);
printAnnotation('Shows whether local MCP stdio servers are enabled for the workspace');

// 5. Working Directory Context
const workingDirContext = getWorkingDirectoryContext(
  '/Users/example/projects/my-app',
  false, // Not session root
  undefined // No bash cwd mismatch
);
printSection(
  '5. WORKING DIRECTORY - getWorkingDirectoryContext()',
  workingDirContext || '(empty - no working directory)',
  colors.magenta
);
printAnnotation('Contains: working_directory path and explanation. Context-file manifests are');
printAnnotation('listed separately in <project_context_files>, relative to context_root when present.');

// 6. Recovery Context (example)
const exampleRecoveryContext = `<recovery_context>
This session was interrupted and is being recovered. Here's a summary of the previous conversation:
[Summary of previous messages would appear here]
</recovery_context>`;
printSection(
  '6. RECOVERY CONTEXT - buildRecoveryContext() [only on resume]',
  exampleRecoveryContext,
  colors.magenta
);
printAnnotation('Only added when resuming a session after SDK resume fails');
printAnnotation('Contains summary of previous conversation for context continuity');

// ------------------------------------------------------------
// PART 3: COMPLETE USER MESSAGE STRUCTURE
// ------------------------------------------------------------

printHeader('PART 3: COMPLETE USER MESSAGE STRUCTURE');
printAnnotation('How a user message looks after all context is injected');

const completeUserMessage = `${getDateTimeContext()}

${sessionState}

<sources>
Active: linear
Inactive: slack (inactive)
</sources>

<workspace_capabilities>
local-mcp: enabled (stdio subprocess servers supported)
</workspace_capabilities>

<working_directory>/Users/example/projects/my-app</working_directory>

<working_directory_context>The user explicitly selected this as the working directory for this session.</working_directory_context>

<developer_context kind="git_repository" scope="stable">
repoRoot: /Users/example/projects/my-app
repoParent: /Users/example/projects
selectedWorkingDirectory: /Users/example/projects/my-app
selectedPathWithinRepo: .
Guidance:
- When creating a git worktree, create it as a sibling of repoRoot inside repoParent unless the user explicitly asks for another location.
</developer_context>

<developer_context kind="git_repository" scope="volatile">
branch: main
worktreeState: clean
stagedFiles: 0
unstagedFiles: 0
untrackedFiles: 0
</developer_context>

What files are in the src directory?`;

printSection('COMPLETE USER MESSAGE (example)', completeUserMessage, colors.green);

// ------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------

console.log(`
${colors.bgMagenta}${colors.bold}                                                                                ${colors.reset}
${colors.bgMagenta}${colors.bold}                              SUMMARY                                           ${colors.reset}
${colors.bgMagenta}${colors.bold}                                                                                ${colors.reset}

${colors.bold}SDK Configuration:${colors.reset}
  systemPrompt.preset: 'claude_code'     ${colors.dim}// Claude Code's base system prompt${colors.reset}
  systemPrompt.append: getSystemPrompt() ${colors.dim}// Craft Agent additions (static, cacheable)${colors.reset}

${colors.bold}Static System Prompt Components:${colors.reset}
  1. Craft Agent Environment Marker      ${colors.dim}// Version, platform, arch${colors.reset}
  2. Core Instructions                   ${colors.dim}// Capabilities, sources, guidelines${colors.reset}
  3. Configuration Documentation Refs    ${colors.dim}// Permissions, skills, themes, statuses${colors.reset}
  4. Permission Modes Documentation      ${colors.dim}// Inlined in system prompt${colors.reset}
  5. Error Handling & Tool Metadata      ${colors.dim}// Guidelines for tool usage${colors.reset}
  6. User Preferences (if set)           ${colors.dim}// formatPreferencesForPrompt()${colors.reset}
  7. Project Context (if bound)          ${colors.dim}// formatProjectContextForPrompt()${colors.reset}
  8. Debug Mode Context (if enabled)     ${colors.dim}// formatDebugModeContext()${colors.reset}
  9. Context File Manifest               ${colors.dim}// getProjectContextFilesPrompt()${colors.reset}

${colors.bold}Dynamic User Message Components (per message):${colors.reset}
  1. Date/Time Context                   ${colors.dim}// getDateTimeContext()             [VOLATILE]${colors.reset}
  2. Session State                       ${colors.dim}// formatSessionState()             [VOLATILE]${colors.reset}
  3. Source State                        ${colors.dim}// formatSourceState()              [VOLATILE]${colors.reset}
  4. Volatile Git Developer Context      ${colors.dim}// branch/status/dirty files        [VOLATILE]${colors.reset}
  5. Workspace Capabilities              ${colors.dim}// formatWorkspaceCapabilities()    [STABLE]${colors.reset}
  6. Working Directory                   ${colors.dim}// getWorkingDirectoryContext()     [STABLE]${colors.reset}
  7. Stable Git Developer Context        ${colors.dim}// repo root/parent/guidance        [STABLE]${colors.reset}
  8. Recovery Context (on resume only)   ${colors.dim}// buildRecoveryContext()${colors.reset}
  9. File Attachments                    ${colors.dim}// Inline paths or base64${colors.reset}
 10. User Message Text                   ${colors.dim}// The actual user input${colors.reset}

  ${colors.dim}Claude: 1-7 ride the user tail. Pi (#862): STABLE 5-7 -> system prefix, VOLATILE 1-4 -> user tail.${colors.reset}
  ${colors.dim}Builders: PromptBuilder.buildVolatileContextParts() / buildStableContextParts() (composed by buildContextParts())${colors.reset}

${colors.bold}Key Files:${colors.reset}
  packages/shared/src/prompts/system.ts          ${colors.dim}// Main prompt assembly${colors.reset}
  packages/shared/src/agent/core/prompt-builder.ts ${colors.dim}// Dynamic context split/building${colors.reset}
  packages/shared/src/agent/mode-manager.ts      ${colors.dim}// Permission modes${colors.reset}
  packages/shared/src/config/preferences.ts      ${colors.dim}// User preferences${colors.reset}
`);
