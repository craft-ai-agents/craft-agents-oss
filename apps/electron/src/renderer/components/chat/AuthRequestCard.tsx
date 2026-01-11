import * as React from 'react'
import { useState, useCallback } from 'react'
import { Key, User, Lock, Eye, EyeOff, Check, X, ExternalLink, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { Message, CredentialResponse } from '../../../shared/types'
import type { AuthRequestType, AuthStatus } from '@craft-agent/core/types'

interface AuthRequestCardProps {
  message: Message
  /** Callback to respond to credential request */
  onRespondToCredential?: (sessionId: string, requestId: string, response: CredentialResponse) => void
  /** Session ID for this auth request */
  sessionId: string
}

/**
 * AuthRequestCard - Inline auth UI displayed in chat history
 *
 * Renders different UIs based on auth type:
 * - credential: Form for API key, bearer token, basic auth
 * - oauth/oauth-google/oauth-slack/oauth-microsoft: OAuth flow with browser redirect
 *
 * Status handling:
 * - pending: Show interactive form/button
 * - completed: Show success state
 * - cancelled: Show cancelled state
 * - failed: Show error state
 */
export function AuthRequestCard({ message, onRespondToCredential, sessionId }: AuthRequestCardProps) {
  const [value, setValue] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const {
    authRequestId,
    authRequestType,
    authSourceSlug,
    authSourceName,
    authStatus,
    authCredentialMode,
    authHeaderName,
    authLabels,
    authDescription,
    authHint,
    authError,
    authEmail,
    authWorkspace,
  } = message

  const isBasicAuth = authCredentialMode === 'basic'
  const isValid = isBasicAuth
    ? username.trim() && password.trim()
    : value.trim()

  const handleSubmit = useCallback(() => {
    if (!isValid || !authRequestId || !onRespondToCredential) return

    setIsSubmitting(true)

    if (isBasicAuth) {
      onRespondToCredential(sessionId, authRequestId, {
        type: 'credential',
        username: username.trim(),
        password: password.trim(),
        cancelled: false
      })
    } else {
      onRespondToCredential(sessionId, authRequestId, {
        type: 'credential',
        value: value.trim(),
        cancelled: false
      })
    }
  }, [isBasicAuth, username, password, value, isValid, onRespondToCredential, sessionId, authRequestId])

  const handleCancel = useCallback(() => {
    if (!authRequestId || !onRespondToCredential) return
    onRespondToCredential(sessionId, authRequestId, { type: 'credential', cancelled: true })
  }, [onRespondToCredential, sessionId, authRequestId])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && isValid) {
      handleSubmit()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }, [isValid, handleSubmit, handleCancel])

  const handleOAuthClick = useCallback(() => {
    // OAuth is handled automatically by the backend
    // The message status will update when OAuth completes
    setIsSubmitting(true)
  }, [])

  // Get field labels
  const credentialLabel = authLabels?.credential ||
    (authCredentialMode === 'bearer' ? 'Bearer Token' : 'API Key')
  const usernameLabel = authLabels?.username || 'Username'
  const passwordLabel = authLabels?.password || 'Password'

  // Get auth type display info
  const getAuthTypeInfo = (type: AuthRequestType | undefined) => {
    switch (type) {
      case 'oauth':
        return { label: 'OAuth', icon: ExternalLink }
      case 'oauth-google':
        return { label: 'Google Sign-In', icon: ExternalLink }
      case 'oauth-slack':
        return { label: 'Slack Sign-In', icon: ExternalLink }
      case 'oauth-microsoft':
        return { label: 'Microsoft Sign-In', icon: ExternalLink }
      case 'credential':
      default:
        return { label: 'Authentication', icon: Key }
    }
  }

  const authTypeInfo = getAuthTypeInfo(authRequestType)
  const AuthIcon = authTypeInfo.icon

  // Render completed state
  if (authStatus === 'completed') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-success/10 rounded-[8px] px-4 py-3 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-success">
              Connected to {authSourceName}
            </div>
            {authEmail && (
              <div className="text-xs text-success/70 mt-0.5">
                Signed in as {authEmail}
              </div>
            )}
            {authWorkspace && (
              <div className="text-xs text-success/70 mt-0.5">
                Workspace: {authWorkspace}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Render cancelled state
  if (authStatus === 'cancelled') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-muted/50 rounded-[8px] px-4 py-3 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-muted-foreground">
              Authentication cancelled
            </div>
            <div className="text-xs text-muted-foreground/70 mt-0.5">
              {authSourceName}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Render failed state
  if (authStatus === 'failed') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-destructive/10 rounded-[8px] px-4 py-3 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-destructive">
              Authentication failed
            </div>
            {authError && (
              <div className="text-xs text-destructive/70 mt-0.5">
                {authError}
              </div>
            )}
            <div className="text-xs text-destructive/50 mt-0.5">
              {authSourceName}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Render OAuth pending state (waiting for browser auth)
  if (authRequestType !== 'credential' && isSubmitting) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-background shadow-minimal rounded-[8px] px-4 py-3 flex items-start gap-3">
          <Loader2 className="h-5 w-5 text-foreground shrink-0 mt-0.5 animate-spin" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">
              Waiting for {authTypeInfo.label}...
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Complete authentication in your browser
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Render OAuth button for non-credential auth types
  if (authRequestType !== 'credential') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-background shadow-minimal rounded-[8px] overflow-hidden">
          <div className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AuthIcon className="h-5 w-5 text-foreground shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {authTypeInfo.label} Required
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {authSourceName}
                </div>
                {authDescription && (
                  <p className="text-xs text-muted-foreground mt-1">{authDescription}</p>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 border-t border-border/50">
            <Button
              size="sm"
              variant="default"
              className="h-7 gap-1.5"
              onClick={handleOAuthClick}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Sign in with {authTypeInfo.label.replace(' Sign-In', '')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={handleCancel}
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Render credential input form
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] bg-background shadow-minimal rounded-[8px] overflow-hidden">
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-start gap-3">
            <Key className="h-5 w-5 text-foreground shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  Authentication Required
                </span>
                <span className="text-xs text-muted-foreground">
                  ({authSourceName})
                </span>
              </div>
              {authDescription && (
                <p className="text-xs text-muted-foreground">{authDescription}</p>
              )}
            </div>
          </div>

          {/* Input fields */}
          <div className="space-y-3">
            {isBasicAuth ? (
              <>
                {/* Username field */}
                <div className="space-y-1.5">
                  <Label htmlFor={`auth-username-${authRequestId}`} className="text-xs">
                    {usernameLabel}
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id={`auth-username-${authRequestId}`}
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="pl-9"
                      placeholder={`Enter ${usernameLabel.toLowerCase()}`}
                      autoFocus
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
                {/* Password field */}
                <div className="space-y-1.5">
                  <Label htmlFor={`auth-password-${authRequestId}`} className="text-xs">
                    {passwordLabel}
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id={`auth-password-${authRequestId}`}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="pl-9 pr-9"
                      placeholder={`Enter ${passwordLabel.toLowerCase()}`}
                      disabled={isSubmitting}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              /* Single credential field */
              <div className="space-y-1.5">
                <Label htmlFor={`auth-value-${authRequestId}`} className="text-xs">
                  {credentialLabel}
                  {authCredentialMode === 'header' && authHeaderName && (
                    <span className="text-muted-foreground ml-1">
                      ({authHeaderName})
                    </span>
                  )}
                </Label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id={`auth-value-${authRequestId}`}
                    type={showPassword ? 'text' : 'password'}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="pl-9 pr-9"
                    placeholder={`Enter ${credentialLabel.toLowerCase()}`}
                    autoFocus
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {/* Hint */}
            {authHint && (
              <p className="text-[11px] text-muted-foreground">
                {authHint}
              </p>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 px-3 py-2 border-t border-border/50">
          <Button
            size="sm"
            variant="default"
            className="h-7 gap-1.5"
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </Button>

          <div className="flex-1" />

          <span className="text-[10px] text-muted-foreground">
            Credentials are encrypted at rest
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Memoized version for performance in chat list
 */
export const MemoizedAuthRequestCard = React.memo(AuthRequestCard, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.authStatus === next.message.authStatus &&
    prev.sessionId === next.sessionId
  )
})
