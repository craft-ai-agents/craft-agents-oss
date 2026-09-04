import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { normalizeAccountServerUrl } from '../../../shared/account-server-url'
import { DESKTOP_RELEASE } from '@craft-agent/shared/deployment'

interface Props {
  onErpLogin: (serverUrl: string) => Promise<void>
  onLocalLogin: (serverUrl: string, username: string, password: string) => Promise<void>
}

function formatLoginError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '登录失败'
  if (message.includes("No handler registered for 'desktop-account")) {
    return '桌面后台组件尚未更新，请完全退出 Jonwork 后重新启动。'
  }
  return message
}

export function DesktopAccountLogin({ onErpLogin, onLocalLogin }: Props) {
  const isDevelopment = import.meta.env.DEV
  const developmentMode = import.meta.env.VITE_JONWORK_DESKTOP_MODE === 'test' ? 'test' : 'local'
  const useLocalPassword = isDevelopment && developmentMode === 'local'
  const configuredDevelopmentUrl = import.meta.env.VITE_JONWORK_ACCOUNT_SERVER_URL?.trim()
  const [serverUrl, setServerUrl] = useState(isDevelopment
    ? (configuredDevelopmentUrl || (useLocalPassword ? 'http://127.0.0.1:9100' : ''))
    : DESKTOP_RELEASE.accountServerUrl)
  const [username, setUsername] = useState(useLocalPassword ? 'local-admin' : '')
  const [password, setPassword] = useState(useLocalPassword ? 'JonworkLocal@2026' : '')
  const [showServer, setShowServer] = useState(isDevelopment || !DESKTOP_RELEASE.accountServerUrl)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  return (
    <div className="flex min-h-screen items-center justify-center bg-foreground-2 p-6">
      <section className="w-full max-w-sm space-y-4 rounded-2xl bg-background p-7 shadow-modal-small">
        <div>
          <h1 className="text-xl font-semibold">{useLocalPassword ? '登录本地 Jonwork' : '连接 ERPNext'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{useLocalPassword ? '本地开发账号已自动填充，可直接登录验证桌面端。' : 'Craft 不维护独立账号。请先登录 ERPNext，再同步企业、权限、项目和积分到 Craft。'}</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">首次登录成功后，登录状态会使用系统安全存储保存；以后正常启动将自动恢复，无需重复输入账号密码。</p>
        </div>
        {showServer && <div className="space-y-1.5">
          <Input
            value={serverUrl}
            onChange={event => setServerUrl(event.target.value)}
            placeholder="账户服务器地址（https://…）"
            type="url"
            autoComplete="url"
            required
            readOnly={!isDevelopment && !DESKTOP_RELEASE.allowCustomAccountServer}
          />
          <p className="text-xs text-muted-foreground">公网生产地址必须使用 HTTPS；HTTP 仅限本机开发。</p>
        </div>}
        {useLocalPassword && <div className="space-y-3">
          <Input value={username} onChange={event => setUsername(event.target.value)} placeholder="用户名" autoComplete="username" required />
          <Input value={password} onChange={event => setPassword(event.target.value)} placeholder="密码" type="password" autoComplete="current-password" required />
        </div>}
        {DESKTOP_RELEASE.allowCustomAccountServer && DESKTOP_RELEASE.accountServerUrl && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setShowServer(!showServer)}>高级：账户服务器设置</button>
        )}
        <Button type="button" className="w-full" disabled={loading || !serverUrl || (useLocalPassword && (!username || !password))} onClick={async () => {
          setError(''); setLoading(true)
          try {
            const normalized = normalizeAccountServerUrl(serverUrl)
            if (useLocalPassword) await onLocalLogin(normalized, username, password)
            else await onErpLogin(normalized)
          }
          catch (cause) { setError(formatLoginError(cause)) }
          finally { setLoading(false) }
        }}>{loading ? (useLocalPassword ? '正在登录…' : '正在从 ERPNext 同步，最长等待 5 分钟…') : (useLocalPassword ? '登录本地 Jonwork' : '登录 ERPNext 并同步到 Craft')}</Button>
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </section>
    </div>
  )
}
