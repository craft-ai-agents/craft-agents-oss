import { useEffect, useState } from 'react'
import { isWebUI } from '@/lib/platform'
import { parseModelEntitlement, type ModelEntitlement } from '@/lib/model-entitlement'

/** Presentation only. The server remains authoritative for every execution request. */
export function useModelEntitlement(): ModelEntitlement {
  const [policy, setPolicy] = useState<ModelEntitlement>({ status: isWebUI ? 'loading' : 'unmanaged' })
  useEffect(() => {
    if (!isWebUI) return
    let disposed = false
    let running = false
    const controller = new AbortController()
    const refresh = async () => {
      if (running) return
      running = true
      try {
        const options = { credentials: 'same-origin' as const, cache: 'no-store' as const,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }
        const authResponse = await fetch('/api/auth/policy', options)
        if (!authResponse.ok) throw new Error('Policy unavailable')
        const auth = await authResponse.json()
        let next: ModelEntitlement
        if (auth.sso === true) {
          const response = await fetch('/api/account/entitlement', options)
          if (!response.ok) throw new Error('Entitlement unavailable')
          next = parseModelEntitlement(await response.json())
        } else if ((auth.sso === false || auth.sso === undefined)
          && typeof auth.allowRegistration === 'boolean' && auth.executionMode === undefined) {
          next = { status: 'unmanaged' }
        } else {
          next = { status: 'error' }
        }
        if (!disposed) setPolicy(next)
      } catch {
        if (!disposed) setPolicy({ status: 'error' })
      } finally { running = false }
    }
    void refresh()
    const timer = window.setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    return () => {
      disposed = true
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  return policy
}
