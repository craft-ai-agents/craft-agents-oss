import * as React from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface Props {
  slug?: string
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function AccountSkillEditor({ slug, trigger, open: controlledOpen, onOpenChange }: Props) {
  const [localOpen, setLocalOpen] = React.useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value) }
  const [skillSlug, setSkillSlug] = React.useState(slug ?? '')
  const [content, setContent] = React.useState('')
  const [revision, setRevision] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    let active = true
    setError(null)
    setSkillSlug(slug ?? '')
    setRevision(null)
    setContent('---\nname: 我的技能\ndescription: 描述这个技能的用途\n---\n\n在这里填写技能指令。\n')
    if (slug) {
      setBusy(true)
      window.electronAPI.getAccountSkill!(slug).then(bundle => {
        if (!active) return
        if (bundle.skill.readOnly) throw new Error('公共技能只读')
        const file = bundle.files.find(file => file.path === 'SKILL.md')
        if (!file) throw new Error('SKILL.md 不存在')
        setContent(new TextDecoder().decode(Uint8Array.from(atob(file.base64), c => c.charCodeAt(0))))
        setRevision(bundle.revision)
      }).catch(error => { if (active) setError(error instanceof Error ? error.message : '加载失败') })
        .finally(() => { if (active) setBusy(false) })
    }
    return () => { active = false }
  }, [open, slug])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await window.electronAPI.saveAccountSkill!({ slug: skillSlug, content, expectedRevision: revision })
      window.dispatchEvent(new Event('jonwork:skills-changed'))
      toast.success('已保存到账号技能库，其他设备将同步更新')
      setOpen(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败')
    } finally { setBusy(false) }
  }

  return <Dialog open={open} onOpenChange={setOpen}>
    {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{slug ? '编辑私有技能' : '新增账号技能'}</DialogTitle>
        <DialogDescription>仅本人可见，保存到服务器后可在网页和桌面端同步使用。不要在技能内容中填写密码或 API 密钥。</DialogDescription>
      </DialogHeader>
      <label className="text-sm">技能标识<Input aria-label="技能标识" value={skillSlug} disabled={!!slug || busy} onChange={event => setSkillSlug(event.target.value)} placeholder="my-skill" /></label>
      <label className="text-sm">SKILL.md（含 name、description 和指令）
        <Textarea aria-label="SKILL.md" value={content} onChange={event => setContent(event.target.value)} disabled={busy} className="mt-2 h-72 font-mono text-sm" />
      </label>
      <label className="text-sm">导入 SKILL.md
        <input type="file" accept=".md,text/markdown" disabled={busy} className="ml-3 text-xs" onChange={async event => {
          const file = event.target.files?.[0]
          if (!file) return
          if (file.size > 1024 * 1024) { setError('SKILL.md 不能超过 1 MB'); return }
          setContent(await file.text())
        }} />
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>取消</Button>
        <Button onClick={save} disabled={busy || !skillSlug || (!!slug && !revision)}>{busy ? '正在处理…' : '保存到账号'}</Button>
      </div>
    </DialogContent>
  </Dialog>
}
