import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { CanvasStore } from '@craft-agent/session-tools-core/canvas-store'
import { CANVAS_WORKFLOWS, planCanvasWorkflow } from '@craft-agent/session-tools-core/canvas-workflows'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createProject, updateProject } from '@craft-agent/shared/projects'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { AccountScopedRpcServer } from './account-rpc-policy'

const roots:string[]=[]
afterEach(()=>{for(const root of roots.splice(0)) {
  if(!resolve(root).startsWith(resolve(tmpdir())+sep)) throw Error('Unsafe test cleanup')
  rmSync(root,{recursive:true,force:true})
}})
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'account-project-isolation-'));roots.push(root)
  const handlers=new Map<string,Function>()
  const workspace=join(root,'alice');mkdirSync(workspace)
  const ctx={clientId:'c',principalId:'alice',workspaceId:'ws-alice'}
  const accounts={getById:()=>({id:'alice',workspaceId:'ws-alice'}),getSkillWorkspaceRoot:()=>workspace,getExternalMember:()=> 'erp-member'} as any
  const policy={active:true,models:['fixture','meshy/image-to-3d'],skills:[] as string[]}
  const control={policy:async()=>policy} as any
  const sessions:Array<{id:string;workspaceId:string;projectId?:string}>=[{id:'mine',workspaceId:'ws-alice'}]
  const server=new AccountScopedRpcServer({handle:(channel:string,handler:Function)=>handlers.set(channel,handler)} as any,accounts,
    {getSessions:()=>sessions},control)
  return {root,workspace,server,handlers,ctx,sessions,policy,control}
}
describe('account project filesystem boundary',()=>{
  it('requires each of the fourteen skill grants in addition to model access',async()=>{
    const f=fixture(), project=createProject(f.workspace,{name:'Skill permission test'})
    f.sessions[0]!.projectId=project.id
    let dispatched=0
    f.server.handle(RPC_CHANNELS.canvas.CALL_TOOL,async()=>{dispatched++;return true})
    const call=f.handlers.get(RPC_CHANNELS.canvas.CALL_TOOL)!
    for(const workflow of [...CANVAS_WORKFLOWS].sort((a,b)=>Number(b.mode==='model')-Number(a.mode==='model'))) {
      await expect(call(f.ctx,'ws-alice','run_infinite_canvas_workflow',{projectId:project.id,sessionId:'mine',workflow:{id:workflow.id}})).rejects.toThrow('技能')
    }
    expect(dispatched).toBe(0)
  })

  it('revoked skill access blocks a queued provider task before billing or network',async()=>{
    const f=fixture(), project=createProject(f.workspace,{name:'Revoked skill test'})
    f.sessions[0]!.projectId=project.id
    f.server.handle(RPC_CHANNELS.canvas.CALL_TOOL,async()=>{throw Error('unexpected handler')})
    f.control.providerTask=()=>{throw Error('unexpected billing')}
    const store=new CanvasStore(f.workspace), snapshot={projectId:project.id,nodes:[]}
    await store.save(snapshot); await store.bindSession('mine',project.id)
    const plan=planCanvasWorkflow(snapshot,{id:'user-insight',inputIds:[],count:1,requirements:'test',materialsNote:'no interviews',briefConfirmed:true},'skill-revocation-test')
    await store.enqueue('mine',plan.ops,plan.summary,project.id)
    const entry=(await store.claim(project.id)).update!
    const call=f.handlers.get(RPC_CHANNELS.canvas.CALL_TOOL)!
    await expect(call(f.ctx,'ws-alice','advance_infinite_canvas_provider',{projectId:project.id,revision:entry.revision,deliveryToken:entry.deliveryToken,nodeId:entry.ops.find(op=>op.type==='run_generation')!.nodeId,images:[]})).rejects.toThrow('技能')
  })

  it('allows explicitly granted workflows and carries the exact skill into fresh billing authorization',async()=>{
    const f=fixture(), project=createProject(f.workspace,{name:'Granted skill test'})
    f.sessions[0]!.projectId=project.id
    f.policy.skills=CANVAS_WORKFLOWS.map(workflow=>`jonwork-${workflow.id}`)
    const names=['JONWORK_CANVAS_TEXT_MODEL','JONWORK_CANVAS_TEXT_API_KEY','JONWORK_CANVAS_IMAGE_MODEL','JONWORK_CANVAS_IMAGE_API_KEY']
    const previous=names.map(name=>process.env[name])
    names.forEach(name=>{process.env[name]=name.endsWith('_MODEL')?'fixture':'synthetic-test-key'})
    try {
      f.server.handle(RPC_CHANNELS.canvas.CALL_TOOL,async()=>true)
      const call=f.handlers.get(RPC_CHANNELS.canvas.CALL_TOOL)!
      for(const workflow of CANVAS_WORKFLOWS) expect(await call(f.ctx,'ws-alice','run_infinite_canvas_workflow',{projectId:project.id,sessionId:'mine',workflow:{id:workflow.id}})).toBe(true)
      f.policy.models=[]
      await expect(call(f.ctx,'ws-alice','run_infinite_canvas_workflow',{projectId:project.id,workflow:{id:'image-to-3d'}})).rejects.toThrow('模型')
      f.policy.models=['fixture','meshy/image-to-3d']
      const store=new CanvasStore(f.workspace), snapshot={projectId:project.id,nodes:[]}
      await store.save(snapshot); await store.bindSession('mine',project.id)
      const plan=planCanvasWorkflow(snapshot,{id:'user-insight',inputIds:[],count:1,requirements:'test',materialsNote:'no interviews',briefConfirmed:true},'skill-billing-test')
      await store.enqueue('mine',plan.ops,plan.summary,project.id)
      const entry=(await store.claim(project.id)).update!
      let billingInput:any
      f.control.providerTask=(input:any)=>{billingInput=input;throw Error('test stopped before provider')}
      await expect(call(f.ctx,'ws-alice','advance_infinite_canvas_provider',{projectId:project.id,revision:entry.revision,deliveryToken:entry.deliveryToken,nodeId:entry.ops.find(op=>op.type==='run_generation')!.nodeId,images:[]})).rejects.toThrow('test stopped')
      expect(billingInput).toEqual({workspaceId:'ws-alice',model:'fixture',skills:['jonwork-user-insight'],sources:[]})
    } finally { names.forEach((name,i)=>{if(previous[i]===undefined) delete process.env[name];else process.env[name]=previous[i]}) }
  })

  it('assigns only the chosen project directory and ignores caller-selected execution roots',async()=>{
    const f=fixture();const a=createProject(f.workspace,{name:'A'});const b=createProject(f.workspace,{name:'B'})
    f.server.handle(RPC_CHANNELS.sessions.CREATE,async(_ctx,_ws,input)=>input)
    const result=await f.handlers.get(RPC_CHANNELS.sessions.CREATE)!(f.ctx,'ws-alice',{projectId:a.id,workingDirectory:join(f.workspace,'projects',b.slug)})
    expect(result.workingDirectory).toBe(join(f.workspace,'projects',a.slug))
    expect(result.projectId).toBe(a.id)
  })
  it('refuses an old project configuration pointing at a sibling or account-wide directory',async()=>{
    const f=fixture();const a=createProject(f.workspace,{name:'A'});const b=createProject(f.workspace,{name:'B'})
    f.server.handle(RPC_CHANNELS.sessions.CREATE,async()=>{throw Error('unsafe creation')})
    for(const path of [f.workspace,join(f.workspace,'projects',b.slug)]) {
      updateProject(f.workspace,a.slug,{workingDirectory:path})
      await expect(f.handlers.get(RPC_CHANNELS.sessions.CREATE)!(f.ctx,'ws-alice',{projectId:a.id})).rejects.toThrow('目录之外')
    }
  })
  it('rejects a session directory symlink/junction to another account before attachment writes',async()=>{
    const f=fixture();const other=join(f.root,'bob');mkdirSync(other);mkdirSync(join(f.workspace,'sessions'))
    symlinkSync(other,join(f.workspace,'sessions','mine'),process.platform==='win32'?'junction':'dir')
    f.server.handle(RPC_CHANNELS.file.STORE_ATTACHMENT,async()=>{throw Error('unsafe write')})
    await expect(f.handlers.get(RPC_CHANNELS.file.STORE_ATTACHMENT)!(f.ctx,'mine',{})).rejects.toThrow('符号链接')
  })
  it('requires the canvas and bound session to use the same existing business project',async()=>{
    const f=fixture();const a=createProject(f.workspace,{name:'A'});const b=createProject(f.workspace,{name:'B'})
    f.sessions[0]!.projectId=a.id
    f.server.handle(RPC_CHANNELS.canvas.CALL_TOOL,async()=>true)
    const call=f.handlers.get(RPC_CHANNELS.canvas.CALL_TOOL)!
    expect(await call(f.ctx,'ws-alice','get_infinite_canvas_state',{projectId:a.id})).toBe(true)
    expect(await call(f.ctx,'ws-alice','bind_infinite_canvas_session',{projectId:a.id,sessionId:'mine'})).toBe(true)
    await expect(call(f.ctx,'ws-alice','bind_infinite_canvas_session',{projectId:b.id,sessionId:'mine'})).rejects.toThrow('同一业务项目')
    await expect(call(f.ctx,'ws-alice','get_infinite_canvas_state',{projectId:'legacy-unmapped-canvas'})).rejects.toThrow('无权绑定')
  })
  it('exposes only managed mode and rejects a forged successful image receipt', async () => {
    const f = fixture(), project = createProject(f.workspace, { name: 'New acceptance project' })
    f.sessions[0]!.projectId = project.id
    f.server.handle(RPC_CHANNELS.canvas.CALL_TOOL, async () => { throw Error('forged receipt reached publisher') })
    const call = f.handlers.get(RPC_CHANNELS.canvas.CALL_TOOL)!
    expect(await call(f.ctx, 'ws-alice', 'get_infinite_canvas_capabilities', {})).toEqual({ content: [], structuredContent: { managed: true }, isError: false })
    const store = new CanvasStore(f.workspace)
    const snapshot = { projectId: project.id, nodes: [] }
    await store.save(snapshot); await store.bindSession('mine', project.id)
    const plan = planCanvasWorkflow(snapshot, { id: 'user-insight', inputIds: [], count: 1, requirements: 'test', materialsNote: 'no real interviews', briefConfirmed: true }, 'forged-receipt-audit')
    await store.enqueue('mine', plan.ops, plan.summary, project.id)
    const entry = (await store.claim(project.id)).update!
    await expect(call(f.ctx, 'ws-alice', 'ack_infinite_canvas_update', { projectId: project.id, revision: entry.revision, deliveryToken: entry.deliveryToken, snapshot, artifacts: [{ mimeType: 'text/markdown', text: 'fake success' }] })).rejects.toThrow('不能由客户端')
    await expect(call(f.ctx, 'ws-alice', 'get_infinite_canvas_capabilities', { projectId: '../escape' })).resolves.toMatchObject({ structuredContent: { managed: true } })
  })
})
