/**
 * Static export viewer service implementation
 *
 * This class exports sessions as standalone HTML files to a local directory.
 * Optionally, an upload command can be configured to sync files to remote storage
 * (e.g., S3, SFTP, or any custom deployment target).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { ViewerService, ShareResult } from './types';
import type { StoredSession } from '../sessions/types';
import { generateSessionHTML } from './templates/session-html';

/**
 * Implementation of ViewerService that exports sessions as static HTML files
 *
 * This service generates self-contained HTML files that can be viewed in any browser
 * without requiring a server. Optionally, an upload command can be configured to
 * automatically sync exported files to remote storage.
 */
export default class StaticExportViewer implements ViewerService {
  private readonly exportPath: string;
  private readonly uploadCommand?: string;

  /**
   * Create a new StaticExportViewer instance
   *
   * @param exportPath - Directory path where HTML files will be exported (required)
   * @param uploadCommand - Optional shell command to run after each export (e.g., rsync to S3)
   * @throws Error if exportPath is not a valid absolute path
   */
  constructor(exportPath: string, uploadCommand?: string) {
    // Validate exportPath is provided and is an absolute path
    if (!exportPath || typeof exportPath !== 'string') {
      throw new Error('Export path is required');
    }

    // Normalize the path and ensure it's absolute
    const normalizedPath = path.resolve(exportPath);
    this.exportPath = normalizedPath;
    this.uploadCommand = uploadCommand;

    // Ensure export directory exists (create with mkdir -p if needed)
    this.ensureExportDirectory();
  }

  /**
   * Ensure the export directory exists, creating it if necessary
   */
  private ensureExportDirectory(): void {
    try {
      if (!fs.existsSync(this.exportPath)) {
        fs.mkdirSync(this.exportPath, { recursive: true });
      }
    } catch (error) {
      throw new Error(`Failed to create export directory: ${this.exportPath}`);
    }
  }

  /**
   * Execute the upload command if configured
   * Logs execution but does not expose command details in errors
   */
  private executeUploadCommand(): void {
    if (!this.uploadCommand) {
      return;
    }

    try {
      execSync(this.uploadCommand, {
        cwd: this.exportPath,
        stdio: 'pipe', // Capture output instead of printing to console
        timeout: 60000, // 60 second timeout
      });
    } catch (error) {
      // Log the error but don't expose command details
      // The upload failure is non-fatal - the local export still succeeded
      console.error('Upload command failed');
    }
  }

  /**
   * Get the file path for a session export
   */
  private getFilePath(sessionId: string): string {
    return path.join(this.exportPath, `${sessionId}.html`);
  }

  /**
   * Share a session by exporting it as a static HTML file
   *
   * Creates a new HTML file containing the session data that can be viewed
   * in any browser. If an upload command is configured, it will be executed
   * after the file is written.
   *
   * @param session - The session to share, including all messages
   * @returns ShareResult with the local file URL and session ID
   */
  async share(session: StoredSession): Promise<ShareResult> {
    try {
      // Generate HTML content
      const htmlContent = generateSessionHTML(session);
      const filePath = this.getFilePath(session.id);

      // Write the HTML file
      fs.writeFileSync(filePath, htmlContent, 'utf-8');

      // Execute upload command if configured
      this.executeUploadCommand();

      return {
        success: true,
        id: session.id,
        url: `file://${filePath}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export session',
      };
    }
  }

  /**
   * Update an existing shared session by re-exporting the HTML file
   *
   * Overwrites the existing HTML file with updated session data.
   * If an upload command is configured, it will be executed after the update.
   *
   * @param id - The session ID (used as filename)
   * @param session - The updated session data
   * @returns ShareResult with the same URL
   */
  async update(id: string, session: StoredSession): Promise<ShareResult> {
    try {
      // Generate HTML content
      const htmlContent = generateSessionHTML(session);
      const filePath = this.getFilePath(id);

      // Overwrite the HTML file
      fs.writeFileSync(filePath, htmlContent, 'utf-8');

      // Execute upload command if configured
      this.executeUploadCommand();

      return {
        success: true,
        id,
        url: `file://${filePath}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update session export',
      };
    }
  }

  /**
   * Revoke access to a shared session by deleting the HTML file
   *
   * Removes the exported HTML file from the export directory.
   * Does not fail if the file doesn't exist.
   *
   * @param id - The session ID to revoke
   * @returns ShareResult indicating success
   */
  async revoke(id: string): Promise<ShareResult> {
    try {
      const filePath = this.getFilePath(id);

      // Delete the file if it exists (don't fail if it doesn't)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to revoke session export',
      };
    }
  }

  /**
   * Check if the viewer service is available
   *
   * Verifies that the export directory exists and is writable.
   *
   * @returns True if the export path is valid and writable
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check if directory exists
      if (!fs.existsSync(this.exportPath)) {
        return false;
      }

      // Check if directory is writable by attempting to write a temp file
      const testFile = path.join(this.exportPath, `.health-check-${Date.now()}`);
      fs.writeFileSync(testFile, 'test', 'utf-8');
      fs.unlinkSync(testFile);

      return true;
    } catch (error) {
      return false;
    }
  }
}
