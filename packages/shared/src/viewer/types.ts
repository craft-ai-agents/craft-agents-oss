/**
 * Viewer service types for session sharing and export
 *
 * This module defines the interfaces for sharing Vespr sessions publicly
 * through various viewer backends (hosted service or static export).
 */

import type { StoredSession } from '../sessions/types';

/**
 * Result returned from viewer service operations
 *
 * @property success - Whether the operation succeeded
 * @property id - The shared session ID (UUID) if successful
 * @property url - The public URL where the session can be viewed
 * @property error - Error message if the operation failed
 */
export interface ShareResult {
  success: boolean;
  id?: string;
  url?: string;
  error?: string;
}

/**
 * Service interface for sharing sessions publicly
 *
 * Implementations can use different backends (hosted service, static export, etc.)
 * to make sessions viewable without requiring authentication.
 */
export interface ViewerService {
  /**
   * Share a session publicly
   *
   * Creates a new public view of the session that can be accessed via URL.
   *
   * @param session - The session to share, including all messages
   * @returns ShareResult with the public URL and share ID
   */
  share(session: StoredSession): Promise<ShareResult>;

  /**
   * Update an existing shared session
   *
   * Replaces the content of an existing share with updated session data.
   * Useful for keeping a public link in sync with ongoing conversations.
   *
   * @param id - The share ID from a previous share() call
   * @param session - The updated session data
   * @returns ShareResult with the same URL, or error if share not found
   */
  update(id: string, session: StoredSession): Promise<ShareResult>;

  /**
   * Revoke access to a shared session
   *
   * Removes the public view and makes the URL inaccessible.
   *
   * @param id - The share ID to revoke
   * @returns ShareResult indicating success or failure
   */
  revoke(id: string): Promise<ShareResult>;

  /**
   * Check if the viewer service is available
   *
   * Tests connectivity and authentication with the backend service.
   * Returns false if the service is unavailable or misconfigured.
   *
   * @returns True if the service is healthy and ready to use
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Configuration for the viewer service backend
 *
 * @property type - The viewer backend type
 * @property craftUrl - Base URL for the Craft-hosted viewer service (required for craft-hosted)
 * @property exportPath - Local filesystem path for static exports (required for static-export)
 * @property uploadCommand - Optional shell command to run after static export (e.g., rsync to S3)
 */
export interface ViewerConfig {
  type: 'craft-hosted' | 'static-export';
  craftUrl?: string;
  exportPath?: string;
  uploadCommand?: string;
}
