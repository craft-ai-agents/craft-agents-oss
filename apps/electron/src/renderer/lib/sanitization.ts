/**
 * Sanitization Utilities
 *
 * Security utilities for preventing XSS attacks in translations
 * Uses DOMPurify to sanitize user-generated content before interpolation
 */

import DOMPurify from 'dompurify';

/**
 * Sanitize user input to prevent XSS attacks
 *
 * This function removes all HTML tags and attributes from user input,
 * making it safe to use in translations and other contexts.
 *
 * @param input - The user input to sanitize
 * @returns Sanitized plain text string
 *
 * @example
 * ```tsx
 * const sanitizedName = sanitizeUserInput(session.name);
 * t('deleteConversationMessage', { name: sanitizedName });
 * ```
 */
export function sanitizeUserInput(input: string): string {
  if (!input) return '';

  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],        // Remove all HTML tags
    ALLOWED_ATTR: []         // Remove all attributes
  });
}

/**
 * Sanitize HTML content with allowed tags
 *
 * Use this when you want to allow specific HTML tags (like <b>, <i>)
 * while still preventing dangerous content.
 *
 * @param input - The HTML input to sanitize
 * @param allowedTags - Optional array of allowed HTML tags
 * @returns Sanitized HTML string
 *
 * @example
 * ```tsx
 * const safeHtml = sanitizeHtml('<b>Bold</b> <script>alert("xss")</script>', ['b']);
 * // Returns: '<b>Bold</b> '
 * ```
 */
export function sanitizeHtml(input: string, allowedTags: string[] = []): string {
  if (!input) return '';

  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: []     // No attributes allowed
  });
}

/**
 * Sanitize attributes for HTML elements
 *
 * Use this for attribute values like title, alt, data-*, etc.
 *
 * @param input - The attribute value to sanitize
 * @returns Sanitized string safe for use in attributes
 */
export function sanitizeAttribute(input: string): string {
  if (!input) return '';

  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: []
  }).replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
