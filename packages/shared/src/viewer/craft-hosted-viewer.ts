/**
 * Craft-hosted viewer service implementation
 *
 * This class wraps the existing fetch calls to craft.do in the new ViewerService interface.
 * It maintains 100% backward compatibility with existing craft.do behavior while implementing
 * the standardized viewer service interface.
 */

import type { ViewerService, ShareResult } from './types';
import type { StoredSession } from '../sessions/types';

/**
 * Implementation of ViewerService that uses Craft's hosted viewer service
 *
 * This service POSTs session data to the Craft API and receives back a public
 * shareable URL where the session can be viewed in a read-only format.
 */
export default class CraftHostedViewer implements ViewerService {
  private readonly baseUrl: string;

  /**
   * Create a new CraftHostedViewer instance
   *
   * @param baseUrl - Base URL for the Craft viewer service (default: 'https://agents.craft.do')
   */
  constructor(baseUrl: string = 'https://agents.craft.do') {
    // Remove trailing slashes from baseUrl
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Share a session publicly via Craft's hosted service
   *
   * Creates a new public view of the session that can be accessed via URL.
   *
   * @param session - The session to share, including all messages
   * @returns ShareResult with the public URL and share ID
   */
  async share(session: StoredSession): Promise<ShareResult> {
    try {
      const response = await fetch(`${this.baseUrl}/s/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(session),
      });

      // Handle payload too large error
      if (response.status === 413) {
        return {
          success: false,
          error: 'Session file is too large to share',
        };
      }

      // Handle other HTTP errors
      if (!response.ok) {
        return {
          success: false,
          error: `Failed to share session: HTTP ${response.status}`,
        };
      }

      // Parse successful response
      const data = await response.json() as { id: string; url: string };

      return {
        success: true,
        id: data.id,
        url: data.url,
      };
    } catch (error) {
      // Handle network errors
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error while sharing session',
      };
    }
  }

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
  async update(id: string, session: StoredSession): Promise<ShareResult> {
    try {
      const response = await fetch(`${this.baseUrl}/s/api/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(session),
      });

      // Handle payload too large error
      if (response.status === 413) {
        return {
          success: false,
          error: 'Session file is too large to share',
        };
      }

      // Handle other HTTP errors
      if (!response.ok) {
        return {
          success: false,
          error: `Failed to update session: HTTP ${response.status}`,
        };
      }

      // Parse successful response
      const data = await response.json() as { id: string; url: string };

      return {
        success: true,
        id: data.id,
        url: data.url,
      };
    } catch (error) {
      // Handle network errors
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error while updating session',
      };
    }
  }

  /**
   * Revoke access to a shared session
   *
   * Removes the public view and makes the URL inaccessible.
   *
   * @param id - The share ID to revoke
   * @returns ShareResult indicating success or failure
   */
  async revoke(id: string): Promise<ShareResult> {
    try {
      const response = await fetch(`${this.baseUrl}/s/api/${id}`, {
        method: 'DELETE',
      });

      // Handle HTTP errors
      if (!response.ok) {
        return {
          success: false,
          error: `Failed to revoke session: HTTP ${response.status}`,
        };
      }

      return {
        success: true,
      };
    } catch (error) {
      // Handle network errors
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error while revoking session',
      };
    }
  }

  /**
   * Check if the viewer service is available
   *
   * Tests connectivity with the Craft hosted service backend.
   * Returns false if the service is unavailable or unreachable.
   *
   * @returns True if the service is healthy and ready to use
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}
