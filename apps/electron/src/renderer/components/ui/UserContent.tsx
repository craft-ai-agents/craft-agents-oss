/**
 * UserContent Component
 *
 * Component for displaying user-generated content that should NOT be translated.
 * This includes session names, workspace names, user messages, etc.
 *
 * IMPORTANT: Never use the translation function (t()) with user content!
 * This component serves as a visual marker and documentation.
 *
 * @example
 * ```tsx
 * // ✅ CORRECT - User content is displayed as-is
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
 * - Displays content exactly as provided by the user
 * - Marks the content as user-generated for ESLint rules
 * - Prevents accidental translation
 * - Can be extended with additional safety checks
 */
export const UserContent = React.memo<UserContentProps>(({ content, className, style }) => {
  return (
    <span className={className} style={style} data-user-content>
      {content}
    </span>
  );
});

UserContent.displayName = 'UserContent';

export default UserContent;
