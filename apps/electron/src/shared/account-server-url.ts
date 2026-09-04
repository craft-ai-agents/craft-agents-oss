const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function normalizeAccountServerUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('请输入有效的账户服务器地址')
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isLoopback = LOOPBACK_HOSTS.has(hostname)

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error('公网账户服务器必须使用 HTTPS；仅本机开发地址允许 HTTP')
  }
  if (url.username || url.password) {
    throw new Error('服务器地址中不能包含用户名或密码')
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('请输入服务器根地址，不要包含路径、查询参数或片段')
  }

  return url.origin
}
