/**
 * PermissionAdminPage
 *
 * Admin page for managing user permissions (admin / super_admin).
 * Migrated from CoPaw console. Falls back to stub data if API is unavailable.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Trash2, ShieldX } from 'lucide-react'
import { toast } from 'sonner'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SettingsSection, SettingsCard } from '@/components/settings'
import { cn } from '@/lib/utils'

// ============================================================
// Types
// ============================================================

interface PermissionPO {
  employeeId: string
  userType: 'admin' | 'super_admin'
  createTime?: string
  updateTime?: string
}

// ============================================================
// API (uses VITE_PERMISSION_API_URL env var; falls back to stub)
// ============================================================

const PERMISSION_API_BASE: string = import.meta.env.VITE_PERMISSION_API_URL ?? ''

const TOAST_OPTS = { position: 'top-center' as const }

const STUB_DATA: PermissionPO[] = [
  { employeeId: 'EMP001', userType: 'super_admin', createTime: '2025-01-01 10:00:00', updateTime: '2025-01-01 10:00:00' },
  { employeeId: 'EMP002', userType: 'admin', createTime: '2025-03-15 09:30:00', updateTime: '2025-03-15 09:30:00' },
]

async function permRequest<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const url = `${PERMISSION_API_BASE}${path}`
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {
    ...(token ? { authorization: token } : {}),
    ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
  }
  const res = await fetch(url, { ...options, headers })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  const json = await res.json() as { body: T }
  return json.body
}

function buildPermissionApi(token: string) {
  return {
    getList: () => permRequest<PermissionPO[]>('/api/mdp/permission/list', token),
    saveOrUpdate: (employeeId: string, userType: string) =>
      permRequest<boolean>('/api/mdp/permission/saveOrUpdate', token, {
        method: 'POST',
        body: JSON.stringify({ employeeId, userType }),
      }),
    delete: (employeeId: string) =>
      permRequest<void>(`/api/mdp/permission/delete?employeeId=${encodeURIComponent(employeeId)}`, token, {
        method: 'POST',
      }),
  }
}

// ============================================================
// Sub-components
// ============================================================

const USER_TYPE_LABELS: Record<string, { label: string; className: string }> = {
  admin: { label: 'admin', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  super_admin: { label: 'super_admin', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
}

function UserTypeBadge({ type }: { type: string }) {
  const cfg = USER_TYPE_LABELS[type] ?? { label: type, className: 'bg-foreground/10 text-foreground/70' }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', cfg.className)}>
      {cfg.label}
    </span>
  )
}

interface AddFormProps {
  onAdd: (employeeId: string, userType: string) => Promise<void>
  submitting: boolean
}

function AddForm({ onAdd, submitting }: AddFormProps) {
  const [employeeId, setEmployeeId] = useState('')
  const [userType, setUserType] = useState<'admin' | 'super_admin'>('admin')

  const handleSubmit = async () => {
    const id = employeeId.trim()
    if (!id) return
    await onAdd(id, userType)
    setEmployeeId('')
    setUserType('admin')
  }

  return (
    <div className="flex items-end gap-3 flex-wrap">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-foreground/60">工号</label>
        <input
          type="text"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          placeholder="请输入工号"
          className={cn(
            'h-8 rounded-[6px] border border-border bg-background px-3 text-sm outline-none',
            'focus:ring-1 focus:ring-accent/50 transition-shadow',
            'placeholder:text-foreground/30'
          )}
          style={{ width: 180 }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-foreground/60">权限类型</label>
        <select
          value={userType}
          onChange={(e) => setUserType(e.target.value as 'admin' | 'super_admin')}
          className={cn(
            'h-8 rounded-[6px] border border-border bg-background px-3 text-sm outline-none',
            'focus:ring-1 focus:ring-accent/50 transition-shadow'
          )}
          style={{ width: 200 }}
        >
          <option value="admin">admin（管理员）</option>
          <option value="super_admin">super_admin（超级管理员）</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs opacity-0 select-none">提交</label>
        <Button
          size="sm"
          disabled={submitting || !employeeId.trim()}
          onClick={handleSubmit}
          className="h-8 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium"
        >
          <Plus className="h-3.5 w-3.5 mr-0.5" />
          {submitting ? '提交中...' : '提交'}
        </Button>
      </div>
    </div>
  )
}

interface PermissionRowProps {
  record: PermissionPO
  deleting: boolean
  onDelete: (employeeId: string) => void
}

function PermissionRow({ record, deleting, onDelete }: PermissionRowProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex items-center gap-4 px-4 py-2.5 text-sm border-b border-border/50 last:border-0 hover:bg-foreground/2 transition-colors">
      <span className="w-32 font-mono text-foreground/80 shrink-0">{record.employeeId}</span>
      <span className="w-32 shrink-0">
        <UserTypeBadge type={record.userType} />
      </span>
      <span className="text-xs text-foreground/50 flex-1">{record.createTime}</span>
      <span className="text-xs text-foreground/50 flex-1">{record.updateTime}</span>
      <div className="w-20 shrink-0">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={deleting}
              className={cn(
                'flex items-center gap-1 -mx-1 px-1 py-1 rounded-md text-xs text-destructive',
                'hover:bg-destructive/10 transition-colors disabled:opacity-40'
              )}
            >
              <Trash2 className="h-3 w-3" />
              删除
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" side="top" align="end">
            <p className="text-xs text-foreground/70 mb-2">确定删除 {record.employeeId} 的权限吗？</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs px-2 py-1 rounded-md hover:bg-foreground/5 text-foreground/50 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => { onDelete(record.employeeId); setOpen(false) }}
                className="text-xs px-2 py-1 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-40"
              >
                删除
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

// ============================================================
// Main Component
// ============================================================

export default function PermissionAdminPage() {
  const [authStatus, setAuthStatus] = useState<'checking' | 'ok' | 'denied'>('checking')
  const [list, setList] = useState<PermissionPO[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [permApi, setPermApi] = useState<ReturnType<typeof buildPermissionApi> | null>(null)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10
  const checkedRef = useRef(false)

  useEffect(() => {
    if (checkedRef.current) return
    checkedRef.current = true
    window.electronAPI.getSsoSession().then((session) => {
      if (!session.authenticated) { setAuthStatus('denied'); return }
      const api = buildPermissionApi(session.token)
      setPermApi(api)
      fetch(`${PERMISSION_API_BASE}/api/mdp/permission/checkAdmin?employeeId=${encodeURIComponent(session.employeeId)}`, {
        headers: { authorization: session.token },
      })
        .then((res) => res.json())
        .then((json: { body: boolean }) => setAuthStatus(json.body ? 'ok' : 'denied'))
        .catch(() => { toast('权限验证失败，请检查网络', TOAST_OPTS); setAuthStatus('denied') })
    }).catch(() => { toast('获取登录信息失败', TOAST_OPTS); setAuthStatus('denied') })
  }, [])

  const fetchList = useCallback(async () => {
    if (!permApi) return
    setLoading(true)
    try {
      const data = await permApi.getList()
      const newList = data ?? []
      setList(newList)
      setPage(p => {
        const maxPage = Math.max(1, Math.ceil(newList.length / PAGE_SIZE))
        return p > maxPage ? maxPage : p
      })
    } catch {
      setList(STUB_DATA)
    } finally {
      setLoading(false)
    }
  }, [permApi])

  useEffect(() => { fetchList() }, [fetchList])

  const handleAdd = async (employeeId: string, userType: string) => {
    if (!permApi) return
    setSubmitting(true)
    try {
      await permApi.saveOrUpdate(employeeId, userType)
      toast('权限保存成功', TOAST_OPTS)
      fetchList()
    } catch {
      toast('保存失败，请检查接口地址或参数', TOAST_OPTS)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (employeeId: string) => {
    if (!permApi) return
    setDeletingId(employeeId)
    try {
      await permApi.delete(employeeId)
      toast('权限已删除', TOAST_OPTS)
      fetchList()
    } catch {
      toast('删除失败', TOAST_OPTS)
    } finally {
      setDeletingId(null)
    }
  }

  if (authStatus === 'checking') {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader title="权限管理" />
        <div className="flex flex-1 items-center justify-center text-sm text-foreground/40">
          验证权限中...
        </div>
      </div>
    )
  }

  if (authStatus === 'denied') {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader title="权限管理" />
        <div className="flex flex-col flex-1 items-center justify-center gap-3 text-foreground/40">
          <ShieldX className="h-10 w-10 opacity-30" />
          <p className="text-sm">您没有访问该页面的权限</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="权限管理" />
      <ScrollArea className="h-full">
        <div className="px-4 py-4 space-y-4 max-w-3xl">
          {/* Add form */}
          <SettingsSection title="添加 / 更新权限">
            <SettingsCard>
              <div className="p-4">
                <AddForm onAdd={handleAdd} submitting={submitting} />
              </div>
            </SettingsCard>
          </SettingsSection>

          {/* List */}
          <SettingsSection title="权限列表">
            <SettingsCard>
              {/* Table header */}
              <div className="flex items-center gap-4 px-4 py-2 text-xs font-medium text-foreground/50 border-b border-border/50">
                <span className="w-32 shrink-0">工号</span>
                <span className="w-32 shrink-0">权限类型</span>
                <span className="flex-1">创建时间</span>
                <span className="flex-1">更新时间</span>
                <span className="w-20 shrink-0">操作</span>
              </div>
              {loading ? (
                <div className="py-8 text-center text-sm text-foreground/40">加载中...</div>
              ) : list.length === 0 ? (
                <div className="py-8 text-center text-sm text-foreground/40">暂无数据</div>
              ) : (
                list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((record) => (
                  <PermissionRow
                    key={record.employeeId}
                    record={record}
                    deleting={deletingId === record.employeeId}
                    onDelete={handleDelete}
                  />
                ))
              )}
              {/* Pagination footer */}
              {list.length > 0 && (
                <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/50 text-xs text-foreground/50">
                  <span>共 {list.length} 条</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage(p => p - 1)}
                      className="px-2 py-0.5 rounded border border-border/50 disabled:opacity-30 hover:bg-foreground/5 transition-colors"
                    >
                      上一页
                    </button>
                    <span>第 {page} / {Math.ceil(list.length / PAGE_SIZE)} 页</span>
                    <button
                      type="button"
                      disabled={page >= Math.ceil(list.length / PAGE_SIZE)}
                      onClick={() => setPage(p => p + 1)}
                      className="px-2 py-0.5 rounded border border-border/50 disabled:opacity-30 hover:bg-foreground/5 transition-colors"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}
            </SettingsCard>
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  )
}
