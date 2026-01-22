/**
 * UserContent Component
 *
 * Component for displaying user-generated content that should NOT be translated.
 * This includes session names, workspace names, user messages, etc.
 *
 * SECURITY: This component sanitizes all content to prevent XSS attacks.
 * User input is never safe and must always be sanitized before display.
 *
 * IMPORTANT: Never use the translation function (t()) with user content!
 * This component serves as a visual marker and documentation.
 *
 * @example
 * ```tsx
 * // ✅ CORRECT - User content is displayed safely
 * <UserContent content={session.name} />
 *
 * // ❌ WRONG - Never translate user content
 * <span>{t('sessionName', { name: session.name })}</span>
 *
 * // ✅ CORRECT - Translate labels, keep user content separate
 * <span>{t('conversation')} <UserContent content={session.name} /></span>
 * ```
 */

import React from 'react';
import { sanitizeUserInput } from '@/lib/sanitization';

export interface UserContentProps {
  /** The user-generated content to display */
  content: string;
  /** Optional className for styling */
  className?: string;
  /** Optional inline styles */
  style?: React.CSSProperties;
}

/**
 * Component for displaying user-generated content without translation
 *
 * This component:
 * - Sanitizes content to prevent XSS attacks (CRITICAL for security)
 * - Displays content safely after sanitization
 * - Marks the content as user-generated for ESLint rules
 * - Prevents accidental translation
 */
export const UserContent = React.memo<UserContentProps>(({ content, className, style }) => {
  // Sanitize user content to prevent XSS attacks
  const safeContent = sanitizeUserInput(content);

  return (
    <span className={className} style={style} data-user-content>
      {safeContent}
    </span>
  );
});

UserContent.displayName = 'UserContent';

export default UserContent;
