import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { AccountScopedRpcServer } from './account-rpc-policy'
import { resolve } from 'node:path'

function harness(managed = false) {
  const handlers = new Map<string, Function>()
  let credits = 2
  const account = { id: 'user-1', username: 'alice', credits, workspaceId: 'ws-1', createdAt: 1 }
  const inner = {
    handle: (channel: string, handler: Function) => handlers.set(channel, handler),
    push: () => {},
    invokeClient: async () => null,
    hasClientCapability: () => false,
    findClientsWithCapability: () => [],
  } as any
  const accounts = {
    getById: () => ({ ...account, credits }),
    getAllWorkspaceIds: () => new Set(['ws-1', 'ws-2']),
    getSkillWorkspaceRoot: () => resolve('test-only-users/alice/workspace'),
    getExternalMember: () => managed ? 'member-test' : undefined,
    debit: async () => {
      if (credits < 1) throw new Error('积分不足')
      credits--
    },
    credit: async () => { credits++ },
  } as any
  const sessions = { getSessions: () => [{ id: 'mine', workspaceId: 'ws-1' }, { id: 'theirs', workspaceId: 'ws-2' }] }
  const control = managed ? {policy:async()=>({active:true,models:['test-model']}),catalog:async()=>[],allowedSources:async()=>[],acceptMessage:async(_account:string,_args:any[],dispatch:()=>Promise<any>)=>dispatch()} as any : undefined
  return { server: new AccountScopedRpcServer(inner, accounts, sessions, control), handlers, getCredits: () => credits }
}

describe('AccountScopedRpcServer', () => {
  it('binds managed workspace selection without mutating server-global active workspace', async () => {
    const {server,handlers}=harness(true)
    server.handle(RPC_CHANNELS.window.SWITCH_WORKSPACE,async()=>{throw Error('must not reach global handler')})
    const ctx={clientId:'c',principalId:'user-1',workspaceId:'ws-1'}
    expect(await handlers.get(RPC_CHANNELS.window.SWITCH_WORKSPACE)!(ctx,'ws-1')).toEqual({workspaceId:'ws-1'})
    await expect(handlers.get(RPC_CHANNELS.window.SWITCH_WORKSPACE)!(ctx,'ws-2')).rejects.toThrow('无权')
  })
  it('managed accounts use only the execution ledger and cannot read server credentials', async () => {
    const {server,handlers,getCredits}=harness(true)
    const ctx={clientId:'c',principalId:'user-1',workspaceId:'ws-1'}
    server.handle(RPC_CHANNELS.sessions.SEND_MESSAGE,async()=>({accepted:true}))
    await expect(handlers.get(RPC_CHANNELS.sessions.SEND_MESSAGE)!(ctx,'mine','hello')).rejects.toThrow('用户及项目级隔离')
    expect(getCredits()).toBe(2)
    for(const channel of [RPC_CHANNELS.llmConnections.GET_API_KEY,RPC_CHANNELS.settings.SET_SERVER_CONFIG,RPC_CHANNELS.workspaces.CREATE]) {
      server.handle(channel,async()=>{throw Error('must not reach handler')})
      await expect(handlers.get(channel)!(ctx)).rejects.toThrow('中台模式')
    }
    server.handle(RPC_CHANNELS.sessions.COMMAND,async()=>true)
    await expect(handlers.get(RPC_CHANNELS.sessions.COMMAND)!(ctx,'mine',{type:'updateWorkingDirectory',dir:'/etc'})).rejects.toThrow('中台模式')
    expect(await handlers.get(RPC_CHANNELS.sessions.COMMAND)!(ctx,'mine',{type:'rename',name:'test'})).toBe(true)
  })
  it('allows account project and canvas metadata but rejects path escapes and unmetered generation',async()=>{
    const {server,handlers}=harness(true)
    const ctx={clientId:'c',principalId:'user-1',workspaceId:'ws-1'}
    for(const channel of [RPC_CHANNELS.projects.GET,RPC_CHANNELS.projects.UPDATE,RPC_CHANNELS.projects.UPLOAD_ASSET,RPC_CHANNELS.canvas.CALL_TOOL,RPC_CHANNELS.sessions.SET_MODEL]) server.handle(channel,async()=>true)
    expect(await handlers.get(RPC_CHANNELS.projects.GET)!(ctx,'ws-1')).toBe(true)
    await expect(handlers.get(RPC_CHANNELS.projects.GET)!(ctx,'unregistered-workspace')).rejects.toThrow('工作区')
    await expect(handlers.get(RPC_CHANNELS.projects.UPDATE)!(ctx,'ws-1','../../escape',{})).rejects.toThrow('标识')
    await expect(handlers.get(RPC_CHANNELS.projects.UPDATE)!(ctx,'ws-1','mine',{workingDirectory:resolve('test-only-users/bob')})).rejects.toThrow('目录之外')
    await expect(handlers.get(RPC_CHANNELS.projects.UPLOAD_ASSET)!(ctx,'ws-1','mine',{filename:'secret.txt',sourcePath:'/etc/passwd'})).rejects.toThrow('服务器源路径')
    await expect(handlers.get(RPC_CHANNELS.canvas.CALL_TOOL)!(ctx,'ws-1','get_infinite_canvas_state',{projectId:'canvas-a'})).rejects.toThrow('无权绑定')
    await expect(handlers.get(RPC_CHANNELS.sessions.SET_MODEL)!(ctx,'mine','ws-1','forbidden')).rejects.toThrow('模型')
    expect(await handlers.get(RPC_CHANNELS.sessions.SET_MODEL)!(ctx,'mine','ws-1','test-model')).toBe(true)
  })
  it('blocks skill workspace spoofing, local editors and file-path bypasses', async () => {
    const { server, handlers } = harness()
    const ctx = { clientId: 'c', principalId: 'user-1', workspaceId: 'ws-1' }
    server.handle(RPC_CHANNELS.skills.GET, async () => { throw new Error('must not call original loader') })
    await expect(handlers.get(RPC_CHANNELS.skills.GET)!(ctx, 'other-workspace')).rejects.toThrow('其他用户')
    server.handle(RPC_CHANNELS.skills.OPEN_EDITOR, async () => 'unsafe')
    await expect(handlers.get(RPC_CHANNELS.skills.OPEN_EDITOR)!(ctx, 'ws-1', 'public')).rejects.toThrow('只读')
    server.handle(RPC_CHANNELS.file.READ, async () => 'private data')
    await expect(handlers.get(RPC_CHANNELS.file.READ)!(ctx, resolve('test-only-users/bob/workspace/skills/private/SKILL.md'))).rejects.toThrow('私有文件')
    await expect(handlers.get(RPC_CHANNELS.file.READ)!(ctx, 'relative/private/SKILL.md')).rejects.toThrow('私有文件')
  })
  it('filters workspace lists and rejects another account workspace/session ids', async () => {
    const { server, handlers } = harness()
    server.handle(RPC_CHANNELS.workspaces.GET, async () => [{ id: 'ws-1' }, { id: 'ws-2' }])
    const call = handlers.get(RPC_CHANNELS.workspaces.GET)!
    expect(await call({ clientId: 'c', principalId: 'user-1', workspaceId: 'ws-1' })).toEqual([{ id: 'ws-1' }])

    server.handle(RPC_CHANNELS.sessions.GET_MESSAGES, async () => ({ ok: true }))
    const getMessages = handlers.get(RPC_CHANNELS.sessions.GET_MESSAGES)!
    await expect(getMessages({ clientId: 'c', principalId: 'user-1', workspaceId: 'ws-1' }, 'theirs')).rejects.toThrow('其他用户')
  })

  it('also blocks legacy account execution, without debit or dispatch', async () => {
    const { server, handlers, getCredits } = harness()
    server.handle(RPC_CHANNELS.sessions.SEND_MESSAGE, async () => { throw new Error('must not dispatch') })
    await expect(handlers.get(RPC_CHANNELS.sessions.SEND_MESSAGE)!({ clientId: 'c', principalId: 'user-1', workspaceId: 'ws-1' }, 'mine', 'hello')).rejects.toThrow('用户及项目级隔离')
    expect(getCredits()).toBe(2)
  })

  it('positively checks session ownership, including unknown IDs and attachment writes',async()=>{
    for(const managed of [false,true]) {
      const {server,handlers}=harness(managed)
      const ctx={clientId:'c',principalId:'user-1',workspaceId:'ws-1'}
      for(const channel of [RPC_CHANNELS.sessions.GET_MESSAGES,RPC_CHANNELS.sessions.DELETE,RPC_CHANNELS.sessions.WATCH_FILES,RPC_CHANNELS.file.STORE_ATTACHMENT]) {
        server.handle(channel,async()=>true)
        for(const id of ['theirs','not-in-session-cache','../escape','']) await expect(handlers.get(channel)!(ctx,id)).rejects.toThrow('无权')
        expect(await handlers.get(channel)!(ctx,'mine')).toBe(true)
      }
      for(const channel of [RPC_CHANNELS.sessions.SEARCH_CONTENT,RPC_CHANNELS.sessions.MARK_ALL_READ]) {
        server.handle(channel,async()=>true)
        await expect(handlers.get(channel)!(ctx,'unknown-workspace')).rejects.toThrow('工作区')
      }
    }
  })

  it('blocks context rebinding, shared project roots, unscoped canvas reads and execution continuations',async()=>{
    const {server,handlers}=harness(true)
    const ctx={clientId:'c',principalId:'user-1',workspaceId:'ws-1'}
    for(const channel of [RPC_CHANNELS.sessions.CREATE,RPC_CHANNELS.sessions.COMMAND,RPC_CHANNELS.projects.UPDATE,RPC_CHANNELS.projects.DELETE,RPC_CHANNELS.canvas.CALL_TOOL,RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION,RPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL]) server.handle(channel,async()=>{throw Error('unsafe handler reached')})
    await expect(handlers.get(RPC_CHANNELS.sessions.CREATE)!(ctx,'ws-1',{})).rejects.toThrow('绑定明确')
    await expect(handlers.get(RPC_CHANNELS.sessions.COMMAND)!(ctx,'mine',{type:'setProjectId',projectId:'other-project'})).rejects.toThrow('跨项目')
    for(const path of ['test-only-users/alice/workspace','test-only-users/alice/workspace/projects/other']) await expect(handlers.get(RPC_CHANNELS.projects.UPDATE)!(ctx,'ws-1','mine',{workingDirectory:resolve(path)})).rejects.toThrow('目录之外')
    await expect(handlers.get(RPC_CHANNELS.projects.DELETE)!(ctx,'ws-1','mine')).rejects.toThrow('归档')
    await expect(handlers.get(RPC_CHANNELS.canvas.CALL_TOOL)!(ctx,'ws-1','get_infinite_canvas_state',{})).rejects.toThrow('禁止回退')
    await expect(handlers.get(RPC_CHANNELS.canvas.CALL_TOOL)!(ctx,'ws-1','bind_infinite_canvas_session',{projectId:'canvas-a',sessionId:'theirs'})).rejects.toThrow('无权')
    for(const channel of [RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION,RPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL]) await expect(handlers.get(channel)!(ctx,'mine')).rejects.toThrow('用户及项目级隔离')
  })
})
