import { toast } from 'sonner'
import type { PluginInsertTextMode, PluginInvokeResult } from '@craft-agent/shared/plugins'
import { navigate, type Route } from '@/lib/navigate'
import { parseRoute } from '../../../shared/route-parser'

export interface PluginInvokeExecutionOptions {
  currentInput?: string
  onInputChange?: (value: string) => void
}

export function applyPluginInsertText(
  currentInput: string,
  text: string,
  mode: PluginInsertTextMode = 'append',
): string {
  switch (mode) {
    case 'replace':
      return text
    case 'prepend':
      return currentInput ? `${text} ${currentInput}` : text
    case 'append':
    default:
      return currentInput ? `${currentInput} ${text}` : text
  }
}

export function executePluginInvokeResult(
  result: PluginInvokeResult,
  options: PluginInvokeExecutionOptions = {},
): void {
  switch (result.type) {
    case 'noop':
      return
    case 'navigate': {
      const parsed = parseRoute(result.route)
      if (!parsed) {
        toast.error('Plugin action could not open route', {
          description: result.route,
        })
        return
      }
      navigate(result.route as Route, { newPanel: result.newPanel })
      return
    }
    case 'toast': {
      if (result.level === 'success') {
        toast.success(result.message, { description: result.description })
        return
      }
      if (result.level === 'error') {
        toast.error(result.message, { description: result.description })
        return
      }
      toast(result.message, { description: result.description })
      return
    }
    case 'insertText': {
      const nextValue = applyPluginInsertText(options.currentInput ?? '', result.text, result.mode)
      options.onInputChange?.(nextValue)
      return
    }
  }
}
