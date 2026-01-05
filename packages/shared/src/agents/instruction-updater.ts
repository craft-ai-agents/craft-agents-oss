/**
 * Agentic instruction updater
 *
 * Uses Claude Agent SDK to intelligently update agent instructions
 * in Craft documents. The embedded query reads the current document,
 * compares with the requested change, and writes back the update.
 */

import { debug } from '../utils/debug.ts';

export interface UpdateInstructionsContext {
  /** The Craft document ID containing the agent definition (for Craft-based agents) */
  documentId: string;
  /** Block ID of the Instructions section (for targeting updates) */
  instructionsBlockId?: string;
  /** Current agent instructions (may be out of date vs document) */
  currentInstructions: string;
  /** Agent name for context */
  agentName: string;
  /** Workspace ID */
  workspaceId: string;
  /** Model to use for the embedded query */
  model: string;
}

export interface UpdateInstructionsResult {
  success: boolean;
  message: string;
  /** What was actually updated (for confirmation) */
  updatedContent?: string;
}

/** Progress events emitted during agentic instruction update */
export interface UpdateInstructionsProgressEvent {
  type: 'tool_start' | 'tool_complete' | 'status';
  toolName?: string;
  message: string;
}

/**
 * Agentically update agent instructions in a Craft document
 *
 * This function:
 * 1. Uses an embedded Claude query with Craft MCP access
 * 2. Reads the current document content (source of truth)
 * 3. Compares with the requested update
 * 4. Intelligently writes back the update to the appropriate location
 */
export async function updateAgentInstructions(
  requestedUpdate: string,
  context: UpdateInstructionsContext,
  onProgress?: (event: UpdateInstructionsProgressEvent) => void,
): Promise<UpdateInstructionsResult> {
  debug('[instruction-updater] Starting agentic update for agent:', context.agentName);
  debug('[instruction-updater] Document ID:', context.documentId);
  debug('[instruction-updater] Instructions block ID:', context.instructionsBlockId || 'none');
  debug('[instruction-updater] Requested update:', requestedUpdate.substring(0, 100) + '...');

  try {
    // For folder-based agents, instructions are stored locally
    // This feature needs to be updated to write to local files
    // For now, return an error indicating the feature is not available
    if (!context.documentId) {
      onProgress?.({ type: 'status', message: 'Folder-based agents cannot be updated via this method' });
      return {
        success: false,
        message: 'Folder-based agents should be updated by editing the instructions.md file directly at ~/.craft-agent/agents/{slug}/instructions.md',
      };
    }

    // For Craft-based agents, we would need an MCP source configured
    // This is not yet implemented in the sources system
    onProgress?.({ type: 'status', message: 'Craft-based instruction updates require MCP source configuration' });
    return {
      success: false,
      message: 'Instruction updates via MCP are not yet supported. Please edit the agent instructions directly.',
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debug('[instruction-updater] Error:', errorMessage);
    return {
      success: false,
      message: `Failed to update instructions: ${errorMessage}`,
    };
  }
}
