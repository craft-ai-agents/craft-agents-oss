/**
 * Web UI HTTP handler and standalone server.
 *
 * The core logic lives in `createWebuiHandler()` which returns a web-standard
 * fetch handler `(Request) => Promise<Response>`. This handler can be:
 *
 * 1. **Embedded** — attached to the WsRpcServer's HTTPS server via the
 *    node-adapter so that HTTP and WSS share a single port.
 * 2. **Standalone** — wrapped in `Bun.serve()` via `startWebuiHttpServer()`
 *    for separate-port deployments or development.
 */

import { join, extname } from 'node:path'
import { boundRequestBody, MAX_AUTH_BODY_BYTES, MAX_WEBUI_BODY_BYTES, RequestBodyError } from './request-limits'
import { createProxyTrust, normalizeIp, resolveClientIp, proxyOriginValue, validHost, type HttpPeerContext } from './proxy-trust'
import {
  RateLimiter,
  initPasswordHash,
  verifyPassword,
  createSessionToken,
  validateSession,
  extractSessionCookie,
  buildSessionCookie,
  buildLogoutCookie,
} from './auth'
import { generateCallbackPage } from '@craft-agent/shared/auth'
import type { PlatformServices } from '../runtime/platform'
import type { AccountStore } from './accounts'
import type { ErpControlRuntime } from './erp-control-runtime'
import { erpSkillLibrary } from './erp-resource-bundle'
import { AccountSkillLibrary, GLOBAL_AGENT_SKILLS_DIR, SkillLibraryError, invalidateSkillsCache } from '@craft-agent/shared/skills'

// ---------------------------------------------------------------------------
// MIME types for static file serving
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.map': 'application/json',
}

function getMimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function getRequestProto(req: Request, trustProxyHeaders: boolean): string {
  const forwarded = trustProxyHeaders ? proxyOriginValue(req, 'proto')?.toLowerCase() : null
  // A forwarded header must never downgrade a directly encrypted connection.
  if (new URL(req.url).protocol === 'https:') return 'https'
  return forwarded === 'https' ? 'https' : 'http'
}

function getRequestHost(req: Request, trustProxyHeaders: boolean): string | null {
  return (trustProxyHeaders ? validHost(proxyOriginValue(req, 'host')) : null)
    ?? validHost(new URL(req.url).host)
}

function formatHostWithPort(host: string, port: number): string {
  try {
    const parsed = new URL(`http://${host}`)
    return `${parsed.hostname}:${port}`
  } catch {
    const withoutPort = host.replace(/:\d+$/, '')
    return `${withoutPort}:${port}`
  }
}

export function shouldUseSecureCookies(req: Request, secureCookies?: boolean, trustProxyHeaders = false): boolean {
  if (secureCookies != null) return secureCookies
  return getRequestProto(req, trustProxyHeaders) === 'https'
}

export interface ResolveWebSocketUrlOptions {
  publicWsUrl?: string
  wsProtocol: 'ws' | 'wss'
  wsPort: number
  trustProxyHeaders?: boolean
}

export function resolveWebSocketUrl(
  req: Request,
  { publicWsUrl, wsProtocol, wsPort, trustProxyHeaders = false }: ResolveWebSocketUrlOptions,
): string {
  if (publicWsUrl) return publicWsUrl

  const host = getRequestHost(req, trustProxyHeaders)
  if (host) {
    return `${wsProtocol}://${formatHostWithPort(host, wsPort)}`
  }

  return `${wsProtocol}://127.0.0.1:${wsPort}`
}

// ---------------------------------------------------------------------------
// Handler options (shared between embedded and standalone modes)
// ---------------------------------------------------------------------------

/** Dependencies for the /api/oauth/callback HTTP route (server-side OAuth completion). */
export interface OAuthCallbackDeps {
  flowStore: { getByState: (state: string) => any; remove: (state: string) => void }
  credManager: { exchangeAndStore: (...args: any[]) => Promise<any> }
  sessionManager: { completeAuthRequest: (...args: any[]) => Promise<void> }
  pushSourcesChanged: (workspaceId: string) => void
}

export interface WebuiHandlerOptions {
  /** Path to built web UI dist/ directory. */
  webuiDir: string
  /** Secret used to sign JWTs — typically CRAFT_SERVER_TOKEN. */
  secret: string
  /** Optional separate web UI password. Falls back to `secret` for verification. */
  password?: string
  /** Explicit Secure-cookie override. When unset, infer from the request / proxy headers. */
  secureCookies?: boolean
  /** Optional browser-facing WebSocket URL override for reverse-proxy deployments. */
  publicWsUrl?: string
  /** RPC WebSocket protocol used when building a browser-facing fallback URL. */
  wsProtocol: 'ws' | 'wss'
  /** RPC WebSocket port used when building a browser-facing fallback URL. */
  wsPort: number
  /** Health check function (injected from existing server handler). */
  getHealthCheck: () => { status: string }
  /** Logger. */
  logger: PlatformServices['logger']
  /** OAuth callback deps — when provided, enables /api/oauth/callback route. */
  oauthCallbackDeps?: OAuthCallbackDeps
  /**
   * Trusted proxy IPs/CIDRs. When set, proxy headers (x-forwarded-for, x-forwarded-proto)
   * are only trusted from these sources. When empty/unset, proxy headers are ignored
   * and the socket peer IP is used as the rate-limit key. Adapters MUST supply peer metadata.
   */
  trustedProxies?: string[]
  /** Enables named user accounts, registration, credits, and per-user workspaces. */
  accountStore?: AccountStore
  /** Public self-registration is disabled unless explicitly enabled. It never bootstraps an administrator. */
  allowRegistration?: boolean
  /** Loopback-only development credentials used to prefill the local login page. Never enable in production. */
  developmentLoginDefaults?: { username: string; password: string }
  /** Operator-managed public catalog; credentials are never shared with it. */
  publicSkillsRoot?: string
  erpControl?: ErpControlRuntime
}

// ---------------------------------------------------------------------------
// Handler factory — the core request handler
// ---------------------------------------------------------------------------

export interface WebuiHandler {
  /** Web-standard fetch handler. */
  fetch: (req: Request, peer?: HttpPeerContext) => Promise<Response>
  /** Call on shutdown to release timers. */
  dispose: () => void
  /** Inject OAuth callback deps after bootstrap (lazy wiring). */
  setOAuthCallbackDeps: (deps: OAuthCallbackDeps) => void
}

/**
 * Create a web-standard fetch handler for the WebUI.
 *
 * This handler can be used directly with `Bun.serve({ fetch })`,
 * or adapted for Node's HTTP server via `nodeHttpAdapter()`.
 */
export function createWebuiHandler(options: WebuiHandlerOptions): WebuiHandler {
  const {
    webuiDir,
    secret,
    password,
    secureCookies,
    publicWsUrl,
    wsProtocol,
    wsPort,
    getHealthCheck,
    logger,
    trustedProxies,
    accountStore,
  } = options

  const erpControl = options.erpControl
  const ssoLimiter = new RateLimiter(180, 60_000, 3000)
  const rateLimiter = new RateLimiter(5, 60_000)
  const revokedDesktopTokens = new Set<string>()
  const cleanupTimer = setInterval(() => rateLimiter.cleanup(), 120_000)

  const loginPassword = password || secret
  const isTrustedProxy = createProxyTrust(trustedProxies)

  function isLoopbackRequest(req: Request, peer?: HttpPeerContext): boolean {
    const peerIp = normalizeIp(peer?.remoteAddress)
    if (peerIp !== '127.0.0.1' && peerIp !== '::1') return false
    const hostname = new URL(req.url).hostname
    if (hostname === 'localhost') return true
    const requestIp = normalizeIp(hostname)
    return requestIp === '127.0.0.1' || requestIp === '::1'
  }

  // Hash the login password at startup (async, but resolves before first auth attempt in practice)
  const passwordReady = initPasswordHash(loginPassword)

  async function getAuthenticatedSession(req: Request) {
    const authorization = req.headers.get('authorization')
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (authorization && !bearer) return null
    const cookie = bearer ? `craft_session=${bearer}` : req.headers.get('cookie')
    const token = extractSessionCookie(cookie)
    if (token && (revokedDesktopTokens.has(token) || accountStore?.isTokenRevoked(token))) return null
    const session = await validateSession(cookie, secret)
    if (session && accountStore && !accountStore.isSessionActive(session.sub, session.ver ?? 0)) return null
    if (session && erpControl) {
      try { if (!(await erpControl.policy(session.sub)).active) return null } catch { return null }
    }
    return session
  }

  async function fetch(req: Request, peer?: HttpPeerContext): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const trustProxyHeaders = isTrustedProxy(peer?.remoteAddress)
    const useSecureCookies = shouldUseSecureCookies(req, secureCookies, trustProxyHeaders)
    const clientIp = resolveClientIp(req, peer, isTrustedProxy)
    if (!['GET', 'HEAD'].includes(req.method)) {
      try {
        req = await boundRequestBody(req, path.startsWith('/api/auth') || path.startsWith('/api/admin') ? MAX_AUTH_BODY_BYTES : MAX_WEBUI_BODY_BYTES)
      } catch (error) {
        return Response.json({ error: error instanceof RequestBodyError ? error.message : 'Invalid request body' }, { status: error instanceof RequestBodyError ? error.status : 400 })
      }
    }

    // ── Health endpoint (no auth) ──
    if (path === '/health') {
      const health = getHealthCheck()
      return Response.json(health, {
        status: health.status === 'ok' ? 200 : 503,
      })
    }

    // ── Login page (no auth) ──
    if (path === '/login' || path === '/login/') {
      const loginFile = Bun.file(join(webuiDir, 'login.html'))
      if (await loginFile.exists()) {
        return new Response(loginFile, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      return new Response('Login page not found', { status: 404 })
    }

    // ── Static assets that login page needs (no auth) ──
    if (path === '/favicon.ico' || path === '/favicon.svg' || path === '/apple-touch-icon.png' || path === '/icon-192.png' || path.startsWith('/login-assets/')) {
      const file = Bun.file(join(webuiDir, path))
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Content-Type': getMimeType(path) },
        })
      }
      return new Response('Not Found', { status: 404 })
    }

    // Public, fixed-name desktop bootstrap installer. Production normally
    // serves this path from v2.jonwork.com's read-only artifact storage; this
    // fallback supports a mounted WebUI downloads directory without exposing
    // directory listings or accepting a caller-controlled filesystem path.
    if (path === '/downloads/Jonwork-Setup-x64.exe' && (req.method === 'GET' || req.method === 'HEAD')) {
      const file = Bun.file(join(webuiDir, 'downloads', 'Jonwork-Setup-x64.exe'))
      if (!await file.exists()) return new Response('Installer not found', { status: 404 })
      const headers = {
        'Cache-Control': 'no-cache',
        'Content-Disposition': 'attachment; filename="Jonwork-Setup-x64.exe"',
        'Content-Type': 'application/vnd.microsoft.portable-executable',
        'X-Content-Type-Options': 'nosniff',
      }
      return new Response(req.method === 'HEAD' ? null : file, { headers })
    }

    // Public, non-identifying policy for the login page; never disclose account/bootstrap state.
    if (path === '/api/auth/policy' && req.method === 'GET') {
      return Response.json({ allowRegistration: !erpControl && !!accountStore && options.allowRegistration === true,
        ...(erpControl ? {sso:true, loginUrl:'/api/auth/sso/start', executionMode:'server_only'} : {}),
        ...(!erpControl && options.developmentLoginDefaults && isLoopbackRequest(req, peer)
          ? { developmentLoginDefaults: options.developmentLoginDefaults }
          : {}) }, {
        headers: { 'Cache-Control': 'no-store' },
      })
    }

    if (erpControl && path.startsWith('/api/auth/sso/')) {
      const headers: Record<string,string> = {'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}
      if (!ssoLimiter.check(clientIp)) return Response.json({error:'Too many SSO requests'},{status:429,headers})
      const ssoCookie = (value:string,maxAge=300) => `craft_sso=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/sso; Max-Age=${maxAge}${erpControl.client.config.origin.startsWith('https:')?'; Secure':''}`
      try {
        if (path === '/api/auth/sso/start' && req.method === 'GET') {
          const started=erpControl.client.start(url.searchParams.get('device')??undefined)
          return new Response(null,{status:302,headers:{...headers,Location:started.url,'Set-Cookie':ssoCookie(started.browser)}})
        }
        if (path === '/api/auth/sso/callback' && req.method === 'GET') {
          const browser=req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('craft_sso='))?.slice('craft_sso='.length)??''
          const result=await erpControl.client.complete(url.searchParams.get('state')??'',url.searchParams.get('code')??'',browser)
          if (result.device) return new Response('<!doctype html><meta charset="utf-8"><title>登录完成</title><p>ERP 登录成功，请返回 Jonwork 客户端。</p>',{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Set-Cookie':ssoCookie('',0)}})
          const account=await erpControl.provision(result.identity)
          const token=await createSessionToken(secret,account.id,account.authVersion??0)
          const h=new Headers({...headers,Location:'/'}); h.append('Set-Cookie',ssoCookie('',0)); h.append('Set-Cookie',buildSessionCookie(token,erpControl.client.config.origin.startsWith('https:')))
          return new Response(null,{status:302,headers:h})
        }
        if (path === '/api/auth/sso/device/start' && req.method === 'POST') {
          const body=await req.json() as {challenge:string}
          return Response.json(erpControl.client.startDevice(body.challenge),{headers})
        }
        if (path === '/api/auth/sso/device/poll' && req.method === 'POST') {
          const body=await req.json() as {device:string;verifier:string}
          const identity=erpControl.client.poll(body.device,body.verifier)
          if (!identity) return Response.json({pending:true},{status:202,headers})
          const account=await erpControl.provision(identity)
          const token=await createSessionToken(secret,account.id,account.authVersion??0)
          return Response.json({accessToken:token,account},{headers})
        }
        return Response.json({error:'Not found'},{status:404,headers})
      } catch { return Response.json({error:'ERP 登录或授权验证失败，请重新登录或联系管理员'},{status:403,headers}) }
    }

    // ── Auth endpoint ──
    if ((path === '/api/auth' || path === '/api/auth/desktop') && req.method === 'POST') {
      if (erpControl) return Response.json({error:'请通过 ERPNext 企业账号登录'},{status:403})
      await passwordReady
      const ip = clientIp

      if (!rateLimiter.check(ip)) {
        logger.warn(`[webui] Rate limited auth attempt from ${ip}`)
        return Response.json(
          { error: 'Too many attempts. Try again later.' },
          { status: 429 },
        )
      }

      let body: { username?: string; password?: string }
      try {
        body = await req.json() as { username?: string; password?: string }
      } catch {
        return Response.json({ error: 'Invalid request body' }, { status: 400 })
      }

      if (!body || typeof body !== 'object' || typeof body.password !== 'string' || !body.password || body.password.length > 128) {
        return Response.json({ error: 'Password is required' }, { status: 400 })
      }

      let subject = 'webui'
      let account = null
      let authenticated = false
      if (accountStore) {
        if (!body.username || typeof body.username !== 'string' || body.username.length > 32) {
          return Response.json({ error: 'Username is required' }, { status: 400 })
        }
        account = await accountStore.authenticate(body.username, body.password)
        if (account) {
          subject = account.id
          authenticated = true
        }
      } else if (await verifyPassword(body.password)) {
        authenticated = true
      }

      if (!authenticated) {
        logger.warn(`[webui] Failed auth attempt from ${ip}`)
        return Response.json({ error: 'Invalid credentials' }, { status: 401 })
      }

      const jwt = await createSessionToken(secret, subject, account?.authVersion ?? 0)
      logger.info(`[webui] Successful auth from ${ip}`)

      return Response.json({
        ok: true,
        account,
        ...(path === '/api/auth/desktop' ? { accessToken: jwt } : {}),
      }, {
        status: 200,
        headers: {
          'Set-Cookie': buildSessionCookie(jwt, useSecureCookies),
        },
      })
    }

    // ── Account registration ──
    if (path === '/api/auth/register' && req.method === 'POST') {
      if (erpControl) return Response.json({error:'请由 ERPNext 管理员开通账号'},{status:403})
      if (!accountStore || options.allowRegistration !== true) {
        return Response.json({ error: 'Registration is disabled' }, { status: 403 })
      }
      const ip = clientIp
      if (!rateLimiter.check(ip)) {
        return Response.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
      }
      let body: { username?: string; password?: string }
      try {
        body = await req.json() as { username?: string; password?: string }
      } catch {
        return Response.json({ error: 'Invalid request body' }, { status: 400 })
      }
      if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
        return Response.json({ error: 'Username and password are required' }, { status: 400 })
      }
      try {
        const account = await accountStore.register(body.username, body.password, { public: true })
        const jwt = await createSessionToken(secret, account.id, account.authVersion)
        logger.info(`[webui] Registered account ${account.id} from ${ip}`)
        return Response.json({ ok: true, account }, {
          status: 201,
          headers: { 'Set-Cookie': buildSessionCookie(jwt, useSecureCookies) },
        })
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Registration failed' }, { status: 409 })
      }
    }

    // ── Logout endpoint ──
    if (path === '/api/auth/logout' && req.method === 'POST') {
      const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? extractSessionCookie(req.headers.get('cookie'))
      if (token) {
        const session = await validateSession(`craft_session=${token}`, secret)
        if (session) {
          if (accountStore) await accountStore.revokeToken(token, session.exp * 1000)
          else {
            revokedDesktopTokens.add(token)
            setTimeout(() => revokedDesktopTokens.delete(token), Math.max(1, session.exp * 1000 - Date.now())).unref()
          }
        }
      }
      return new Response(null, {
        status: 204,
        headers: {
          'Set-Cookie': buildLogoutCookie(useSecureCookies),
        },
      })
    }

    // ── Current account ──
    if (path === '/api/account' && req.method === 'GET') {
      const accountSession = await getAuthenticatedSession(req)
      if (!accountSession) return Response.json({ error: 'Unauthorized' }, { status: 401 })
      if (!accountStore || accountSession.sub === 'webui') {
        return Response.json({ id: 'webui', username: '系统管理员', credits: null, workspaceId: null, role: 'admin' })
      }
      const account = accountStore.getById(accountSession.sub)
      return account
        ? Response.json(erpControl ? erpControl.publicAccount(account) : account, {headers:{'Cache-Control':'no-store'}})
        : Response.json({ error: 'Account not found' }, { status: 401 })
    }

    if (path === '/api/account/entitlement' && req.method === 'GET') {
      const session = await getAuthenticatedSession(req)
      const headers = { 'Cache-Control': 'no-store' }
      if (!session || !accountStore || session.sub === 'webui' || !accountStore.getById(session.sub)) {
        return Response.json({ error: '请先登录账户' }, { status: 401, headers })
      }
      if (url.search) return Response.json({ error: '授权接口不接受账号参数' }, { status: 400, headers })
      if (erpControl) return Response.json({configured:true,enforcement:'server',...(await erpControl.policy(session.sub)),balance:erpControl.ledger.balance(session.sub)},{headers})
      return Response.json({ configured: false, enforcement: 'local' }, { headers })
    }

    // Nginx auth_request target for the protected internal update feed. This
    // endpoint returns no token or account data and always refreshes ERP policy.
    if (path === '/api/desktop/update-access' && req.method === 'GET') {
      const session = await getAuthenticatedSession(req)
      const headers = { 'Cache-Control': 'no-store' }
      if (!session || !accountStore || !erpControl || session.sub === 'webui'
        || !accountStore.getById(session.sub)) return new Response(null, { status: 401, headers })
      try {
        const policy = await erpControl.policy(session.sub, true)
        return new Response(null, { status: policy.active && policy.desktop_channel === 'internal' ? 204 : 403, headers })
      } catch {
        return new Response(null, { status: 503, headers })
      }
    }

    if (path === '/api/account/charges' && req.method === 'GET') {
      const session = await getAuthenticatedSession(req)
      if (!session || !accountStore || !accountStore.getById(session.sub)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
      return Response.json({ charges: erpControl ? erpControl.ledger.history(session.sub) : accountStore.listCharges(session.sub),
        ...(erpControl ? {reconciliation:erpControl.ledger.reconciliation(session.sub)} : {}) }, { headers: { 'Cache-Control': 'no-store' } })
    }

    if ((path === '/api/account/charge' || path === '/api/account/refund') && req.method === 'POST') {
      if (erpControl) return Response.json({error:'此实例由服务端执行计费，不接受客户端扣费或退款'},{status:403})
      const accountSession = await getAuthenticatedSession(req)
      if (!accountSession || !accountStore || accountSession.sub === 'webui') {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const origin = req.headers.get('origin')
      if ((origin && origin !== url.origin) || req.headers.get('sec-fetch-site') === 'cross-site') {
        return Response.json({ error: '不允许跨站修改积分' }, { status: 403 })
      }
      try {
        const body = await req.json() as { chargeId?: string; requestId?: string }
        const headers = { 'Cache-Control': 'no-store' }
        if (path === '/api/account/charge') {
          return Response.json(await accountStore.charge(accountSession.sub, body?.requestId ?? ''), { headers })
        }
        if (typeof body?.chargeId !== 'string' || body.chargeId.length > 128) throw new Error('无效的退款记录')
        return Response.json({ account: await accountStore.refund(accountSession.sub, body.chargeId) }, { headers })
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : '积分操作失败' }, { status: 400 })
      }
    }

    // Both browser cookies and desktop session tokens resolve to the same owner.
    // No workspaceId, ownerId, or filesystem path is accepted from clients.
    if (path === '/api/account/skills' || path.startsWith('/api/account/skills/')) {
      const skillSession = await getAuthenticatedSession(req)
      if (!skillSession || !accountStore || skillSession.sub === 'webui' || !accountStore.getById(skillSession.sub)) {
        return Response.json({ error: '请先登录账户' }, { status: 401 })
      }
      const headers = { 'Cache-Control': 'no-store' }
      if (req.method !== 'GET') {
        const origin = req.headers.get('origin')
        if ((origin && origin !== url.origin) || req.headers.get('sec-fetch-site') === 'cross-site') {
          return Response.json({ error: '不允许跨站修改技能' }, { status: 403, headers })
        }
      }
      try {
        if (url.search) throw new SkillLibraryError('技能接口不接受账号、工作区或路径参数')
        const library = erpControl
          ? await erpSkillLibrary(erpControl, skillSession.sub, join(accountStore.getSkillWorkspaceRoot(skillSession.sub), 'skills'))
          : new AccountSkillLibrary(
          options.publicSkillsRoot ?? process.env.CRAFT_PUBLIC_SKILLS_DIR ?? GLOBAL_AGENT_SKILLS_DIR,
          join(accountStore.getSkillWorkspaceRoot(skillSession.sub), 'skills'),
        )
        if (path === '/api/account/skills' && req.method === 'GET') {
          const snapshot = await library.snapshot()
          // Browsers need metadata only; supporting scripts/assets are fetched
          // by the desktop execution cache, not copied into every UI refresh.
          return Response.json(req.headers.get('x-jonwork-skills') === 'metadata'
            ? { skills: snapshot.skills.map(({ skill, revision }) => ({ skill, revision })) }
            : snapshot, { headers })
        }
        const slug = decodeURIComponent(path.slice('/api/account/skills/'.length))
        if (req.method === 'GET') {
          const bundle = await library.get(slug)
          return bundle ? Response.json(bundle, { headers }) : Response.json({ error: '技能不存在' }, { status: 404, headers })
        }
        if (req.method === 'PUT' || req.method === 'DELETE') {
          const raw = await req.text()
          if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new SkillLibraryError('请求过大', 413)
          let body
          try { body = JSON.parse(raw) } catch { throw new SkillLibraryError('无效的请求格式') }
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SkillLibraryError('无效的请求格式')
          if (Object.keys(body).some(key => !['content', 'expectedRevision'].includes(key))) throw new SkillLibraryError('不支持的技能参数')
          if (req.method === 'PUT') {
            const bundle = library.save({ slug, content: body.content, expectedRevision: body.expectedRevision })
            invalidateSkillsCache()
            return Response.json(bundle, { headers })
          }
          library.delete(slug, body.expectedRevision)
          invalidateSkillsCache()
          return new Response(null, { status: 204, headers })
        }
        return Response.json({ error: '不支持的操作' }, { status: 405, headers })
      } catch (error) {
        const status = error instanceof SkillLibraryError ? error.status : 400
        return Response.json({ error: error instanceof SkillLibraryError ? error.message : '技能操作失败' }, { status, headers })
      }
    }

    // ── Administrator account management ──
    if (path.startsWith('/api/admin/')) {
      const adminSession = await getAuthenticatedSession(req)
      if (!adminSession) return Response.json({ error: 'Unauthorized' }, { status: 401 })
      if (!accountStore || !accountStore.isAdmin(adminSession.sub)) {
        return Response.json({ error: '需要管理员权限' }, { status: 403 })
      }

      if (path === '/api/admin/users' && req.method === 'GET') {
        return Response.json({ users: accountStore.listAccounts() })
      }

      if (path === '/api/admin/audit' && req.method === 'GET') {
        return Response.json({ events: accountStore.listAudit() }, { headers: { 'Cache-Control': 'no-store' } })
      }

      if (path === '/api/admin/users' && req.method === 'POST') {
        const body = await req.json().catch(() => null) as { username?: unknown; password?: unknown } | null
        if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') return Response.json({ error: 'Invalid request body' }, { status: 400 })
        try {
          const account = await accountStore.register(body.username, body.password, { actorId: adminSession.sub })
          return Response.json({ account }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
        } catch { return Response.json({ error: '开户失败，请检查用户名、密码策略和管理员权限' }, { status: 400 }) }
      }

      const lifecycle = path.match(/^\/api\/admin\/users\/([^/]+)\/(status|password)$/)
      if (lifecycle && req.method === 'PATCH') {
        const body = await req.json().catch(() => null) as { disabled?: unknown; password?: unknown } | null
        if (!body) return Response.json({ error: 'Invalid request body' }, { status: 400 })
        try {
          const id = decodeURIComponent(lifecycle[1]!)
          if (lifecycle[2] === 'status') {
            if (typeof body.disabled !== 'boolean') throw new Error('Invalid state')
            const account = await accountStore.setDisabled(id, body.disabled, adminSession.sub)
            return Response.json({ account }, { headers: { 'Cache-Control': 'no-store' } })
          }
          if (typeof body.password !== 'string') throw new Error('Invalid password')
          await accountStore.resetPassword(id, body.password, adminSession.sub)
          return new Response(null, { status: 204 })
        } catch { return Response.json({ error: '账号更新失败，请检查密码策略、管理员权限以及至少保留一名有效管理员' }, { status: 400 }) }
      }

      const rechargeMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/recharge$/)
      if (rechargeMatch && req.method === 'POST') {
        let body: { amount?: number }
        try {
          body = await req.json() as { amount?: number }
        } catch {
          return Response.json({ error: 'Invalid request body' }, { status: 400 })
        }
        try {
          const account = await accountStore.recharge(decodeURIComponent(rechargeMatch[1]!), body.amount as number)
          logger.info(`[webui] Admin ${adminSession.sub} recharged account ${account.id} by ${body.amount}`)
          return Response.json({ account })
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : '充值失败' }, { status: 400 })
        }
      }

      const roleMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/role$/)
      if (roleMatch && req.method === 'PATCH') {
        let body: { role?: 'admin' | 'user' }
        try {
          body = await req.json() as { role?: 'admin' | 'user' }
        } catch {
          return Response.json({ error: 'Invalid request body' }, { status: 400 })
        }
        try {
          const account = await accountStore.setRole(decodeURIComponent(roleMatch[1]!), body.role as 'admin' | 'user', adminSession.sub)
          logger.info(`[webui] Admin ${adminSession.sub} changed account ${account.id} role to ${account.role}`)
          return Response.json({ account })
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : '角色更新失败' }, { status: 400 })
        }
      }

      return Response.json({ error: 'Not Found' }, { status: 404 })
    }

    // ── OAuth callback (no cookie auth — state param is CSRF protection) ──
    // Receives redirect from the relay (or directly from OAuth provider for MCP sources).
    // Completes the token exchange server-side and renders a success/error page.
    if (path === '/api/oauth/callback' && req.method === 'GET' && options.oauthCallbackDeps) {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')
      const errorDescription = url.searchParams.get('error_description')

      if (error) {
        const flow = state ? options.oauthCallbackDeps.flowStore.getByState(state) : null
        if (flow && state) options.oauthCallbackDeps.flowStore.remove(state)
        const errorMsg = errorDescription || error
        logger.warn(`[webui] OAuth callback error: ${errorMsg}`)
        return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: errorMsg }), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }

      if (!code || !state) {
        return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: 'Missing code or state parameter' }), {
          status: 400,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }

      try {
        const { completeOAuthFlow } = await import('../handlers/rpc/oauth')
        const result = await completeOAuthFlow({
          code,
          state,
          flowStore: options.oauthCallbackDeps.flowStore,
          credManager: options.oauthCallbackDeps.credManager as any,
          sessionManager: options.oauthCallbackDeps.sessionManager,
          pushSourcesChanged: options.oauthCallbackDeps.pushSourcesChanged,
          logger,
          // No clientId/workspaceId — HTTP callback skips ownership checks (state is auth)
        })

        if (result.success) {
          return new Response(generateCallbackPage({ title: 'Authorization Successful', isSuccess: true }), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        } else {
          return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: result.error }), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Token exchange failed'
        logger.error(`[webui] OAuth callback failed: ${msg}`)
        return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: msg }), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
    }

    // ── Config endpoint (requires session cookie) ──
    if (path === '/api/config' && req.method === 'GET') {
      const configSession = await getAuthenticatedSession(req)
      if (!configSession) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return Response.json({
        wsUrl: resolveWebSocketUrl(req, { publicWsUrl, wsProtocol, wsPort, trustProxyHeaders }),
      })
    }

    // Return the default workspace ID so the webui can include it in the WS handshake
    if (path === '/api/config/workspaces' && req.method === 'GET') {
      const configSession = await getAuthenticatedSession(req)
      if (!configSession) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const { getActiveWorkspace } = await import('@craft-agent/shared/config/storage')
      const active = getActiveWorkspace()
      return Response.json({
        defaultWorkspaceId: accountStore && configSession.sub !== 'webui'
          ? accountStore.getWorkspaceId(configSession.sub)
          : active?.id ?? null,
      })
    }

    // ── Everything below requires a valid session cookie ──
    const cookieHeader = req.headers.get('cookie')
    const session = await getAuthenticatedSession(req)

    if (!session) {
      const accept = req.headers.get('accept') ?? ''
      if (accept.includes('text/html') || path === '/' || path === '') {
        return Response.redirect('/login', 302)
      }
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Serve SPA static files ──
    if (path !== '/') {
      const file = Bun.file(join(webuiDir, path))
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Content-Type': getMimeType(path) },
        })
      }
    }

    // SPA fallback — serve index.html for all non-file routes
    const indexFile = Bun.file(join(webuiDir, 'index.html'))
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    return new Response('Not Found', { status: 404 })
  }

  return {
    fetch,
    dispose: () => { clearInterval(cleanupTimer); erpControl?.dispose() },
    setOAuthCallbackDeps: (deps: OAuthCallbackDeps) => {
      options.oauthCallbackDeps = deps
    },
  }
}

// ---------------------------------------------------------------------------
// Standalone server (backwards-compatible, uses Bun.serve)
// ---------------------------------------------------------------------------

export interface WebuiHttpServerOptions extends WebuiHandlerOptions {
  /** Port to bind on. Use 0 for an ephemeral port in tests. */
  port: number
}

export async function startWebuiHttpServer(
  options: WebuiHttpServerOptions,
): Promise<{ port: number, stop: () => void }> {
  const { port, logger, ...handlerOpts } = options
  const handler = createWebuiHandler({ ...handlerOpts, logger })

  const server = Bun.serve({
    port,
    maxRequestBodySize: MAX_WEBUI_BODY_BYTES,
    fetch: (req, server) => handler.fetch(req, { remoteAddress: server.requestIP(req)?.address }),
  })

  const boundPort = server.port ?? port
  logger.info(`[webui] Web UI server listening on http://0.0.0.0:${boundPort}`)

  return {
    port: boundPort,
    stop: () => {
      handler.dispose()
      server.stop()
    },
  }
}
