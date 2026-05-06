import { UnifiedDiffViewer as BaseUnifiedDiffViewer, type UnifiedDiffViewerProps as BaseProps } from '@craft-agent/ui'
import { useTheme } from '@/hooks/useTheme'

export interface UnifiedDiffViewerProps extends Omit<BaseProps, 'theme' | 'shikiTheme'> {}

export function UnifiedDiffViewer(props: UnifiedDiffViewerProps) {
  const { isDark, shikiTheme } = useTheme()

  return <BaseUnifiedDiffViewer {...props} theme={isDark ? 'dark' : 'light'} shikiTheme={shikiTheme} />
}
