/**
 * HookTestPanel
 *
 * Inline panel displaying test execution results.
 * Uses Info_Alert variants for consistent styling.
 */

import { CheckCircle2, XCircle, ShieldAlert, Loader2 } from 'lucide-react'
import { Info_Alert } from '@/components/info'
import { cn } from '@/lib/utils'
import type { TestResult } from './types'

export interface HookTestPanelProps {
  result: TestResult
  className?: string
}

export function HookTestPanel({ result, className }: HookTestPanelProps) {
  if (result.state === 'idle') return null

  // Running state
  if (result.state === 'running') {
    return (
      <div className={cn('flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground', className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Running test...</span>
      </div>
    )
  }

  // Success state
  if (result.state === 'success') {
    return (
      <Info_Alert variant="success" icon={<CheckCircle2 className="h-4 w-4" />} className={className}>
        <Info_Alert.Title>
          Test Passed
          {result.duration != null && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {result.duration}ms
            </span>
          )}
        </Info_Alert.Title>
        {result.stdout && (
          <Info_Alert.Description>
            <pre className="font-mono text-xs mt-1 whitespace-pre-wrap">{result.stdout}</pre>
          </Info_Alert.Description>
        )}
      </Info_Alert>
    )
  }

  // Error state
  if (result.state === 'error') {
    return (
      <Info_Alert variant="error" icon={<XCircle className="h-4 w-4" />} className={className}>
        <Info_Alert.Title>
          Test Failed
          {result.exitCode != null && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              Error code: {result.exitCode}
            </span>
          )}
        </Info_Alert.Title>
        {result.stderr && (
          <Info_Alert.Description>
            <pre className="font-mono text-xs mt-1 whitespace-pre-wrap text-destructive">{result.stderr}</pre>
          </Info_Alert.Description>
        )}
      </Info_Alert>
    )
  }

  // Blocked state
  if (result.state === 'blocked') {
    return (
      <Info_Alert variant="warning" icon={<ShieldAlert className="h-4 w-4" />} className={className}>
        <Info_Alert.Title>Action Blocked</Info_Alert.Title>
        <Info_Alert.Description>
          {result.blockedReason || 'This action was blocked by your safety settings.'}
        </Info_Alert.Description>
      </Info_Alert>
    )
  }

  return null
}
