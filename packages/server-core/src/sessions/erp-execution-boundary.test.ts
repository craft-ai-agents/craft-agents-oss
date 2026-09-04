import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionManager, createManagedSession } from './SessionManager'
import { ControlLedger } from '../webui/control-ledger'
import { setWorkspaceSkillRoots } from '@craft-agent/shared/skills'
import { sessionPersistenceQueue } from '@craft-agent/shared/sessions/persistence-queue'
import { rejectUnisolatedAgentExecution } from '../webui/execution-isolation'

const roots: string[] = []
afterEach(async () => { await sessionPersistenceQueue.flushAll(); for (const root of roots.splice(0)) {
  if (!resolve(root).startsWith(resolve(tmpdir())+sep)) throw Error('Unsafe fixture cleanup')
  rmSync(root,{recursive:true,force:true})
} })

/** Exercises real sendMessage and its terminal finally, replacing only provider I/O.
 * Not a paid-provider or browser/WS acceptance test. */
describe('SessionManager ERP execution boundary', () => {
  function fixture() {
    const root=mkdtempSync(join(tmpdir(),'erp-session-'));roots.push(root)
    const sm=new SessionManager();const ledger=new ControlLedger(join(root,'ledger'))
    ledger.ensure('account','member');ledger.grant('account','grant',10)
    const workspace={id:'erp-fixture-workspace',rootPath:root,name:'Fixture',createdAt:Date.now()}
    const session=createManagedSession({id:'fixture-session',name:'Fixture',model:'fixture-model'},workspace as never,{messagesLoaded:true})
    ;(sm as any).sessions.set(session.id,session)
    setWorkspaceSkillRoots(root,{publicRoot:join(root,'empty-public'),privateRoot:join(root,'empty-private')})
    let dispatched=0;let active=true;let authorized=0;let isolationBlocked=false
    const agent={setAllSources(){},getModel:()=> 'fixture-model',getSessionId:()=>undefined,
      async *chat(){dispatched++;yield {type:'complete'}}}
    ;(sm as any).getOrCreateAgent=async()=>agent
    sm.setExecutionPolicy({
      // Provider/ledger unit fixture only. Production ErpControlRuntime always
      // rejects SDK execution until a real isolated executor replaces its gate.
      assertAgentExecution:()=>{if(isolationBlocked) rejectUnisolatedAgentExecution()},
      prepare:async()=>{},allowedSources:async()=>[],
      authorize:async()=>{authorized++;if(!active) throw Error('ERP disabled')},
      begin:async()=>{
        if(!active) throw Error('ERP disabled')
        ledger.reserve('account','task','fixture-model',2,1)
        return {complete:async status=>{ledger.finish('account','task',status==='unknown'?0:2,status)}}
      },
    })
    return {sm,ledger,session,agent,blockIsolation:()=>{isolationBlocked=true},setActive:(v:boolean)=>active=v,dispatched:()=>dispatched,authorized:()=>authorized}
  }
  it('blocks unisolated direct/internal sends before ACK, credentials, persistence or billing',async()=>{
    const f=fixture();f.blockIsolation();let ack=false
    ;(f.sm as any).getOrCreateAgent=async()=>{throw Error('must not load credentials or SDK')}
    await expect(f.sm.sendMessage(f.session.id,'hello',undefined,undefined,undefined,undefined,undefined,()=>{ack=true})).rejects.toThrow('用户及项目级隔离')
    expect(ack).toBe(false);expect(f.authorized()).toBe(0);expect(f.session.messages).toHaveLength(0)
    expect(f.ledger.balance('account')).toMatchObject({available:10,reserved:0,sequence:1})
  })
  it('does not migrate existing session context between projects through internal setters',async()=>{
    const f=fixture();f.session.projectId='project-a'
    await expect(f.sm.setSessionProjectId(f.session.id,'project-b')).rejects.toThrow('跨项目')
    await expect(f.sm.setSessionProjectId(f.session.id,null)).rejects.toThrow('跨项目')
    expect(f.session.projectId).toBe('project-a')
    expect(()=>f.sm.updateWorkingDirectory(f.session.id,'other-project')).toThrow('工作目录不能更改')
  })
  it('locks multi-account hosts even without ERP policy, including direct SDK initialization',async()=>{
    const f=fixture();f.sm.requireIsolatedAccountExecution()
    ;(f.sm as any).executionPolicy=undefined
    await expect(f.sm.sendMessage(f.session.id,'hello')).rejects.toThrow('用户及项目级隔离')
    await expect((SessionManager.prototype as any).getOrCreateAgent.call(f.sm,f.session)).rejects.toThrow('用户及项目级隔离')
    expect(f.dispatched()).toBe(0)
  })
  it('rejects cross-user and cross-project agent metadata/message targets and attachment paths',()=>{
    const f=fixture();f.session.projectId='project-a';f.session.workingDirectory=join(f.session.workspace.rootPath,'projects','a')
    const sm=f.sm as any
    sm.sessions.set('other-project',{...f.session,id:'other-project',projectId:'project-b'})
    sm.sessions.set('other-user',{...f.session,id:'other-user',workspace:{...f.session.workspace,id:'other-workspace'}})
    for(const id of ['other-project','other-user','unknown']) expect(()=>sm.assertAgentContextTarget(f.session,id)).toThrow('禁止')
    expect(()=>sm.assertAgentContextTarget(f.session,f.session.id)).not.toThrow()
    expect(()=>sm.assertAgentAttachmentPath(f.session,join(f.session.workspace.rootPath,'projects','b','secret.txt'))).toThrow('目录之外')
    expect(()=>sm.assertAgentAttachmentPath(f.session,join(f.session.workingDirectory!,'input.txt'))).not.toThrow()
  })
  it('denies revoked authorization before acknowledgement or provider dispatch',async()=>{
    const f=fixture();f.setActive(false);let ack=false
    await expect(f.sm.sendMessage(f.session.id,'hello',undefined,undefined,undefined,undefined,undefined,()=>{ack=true})).rejects.toThrow('ERP disabled')
    expect(ack).toBe(false);expect(f.dispatched()).toBe(0)
    expect(f.ledger.balance('account')).toMatchObject({available:10,reserved:0})
  })
  it('reserves before the provider and settles from the real terminal path',async()=>{
    const f=fixture();let heldAtDispatch=0
    const original=f.agent.chat
    f.agent.chat=async function*(){heldAtDispatch=f.ledger.balance('account').reserved;yield* original()}
    await f.sm.sendMessage(f.session.id,'hello')
    expect(heldAtDispatch).toBe(2);expect(f.dispatched()).toBe(1);expect(f.authorized()).toBeGreaterThanOrEqual(2)
    expect(f.ledger.balance('account')).toMatchObject({available:8,reserved:0,sequence:3})
  })
  it('retains unknown outcomes when a provider stream ends without a terminal event',async()=>{
    const f=fixture()
    f.agent.chat=async function*(){return}
    await f.sm.sendMessage(f.session.id,'hello')
    expect(f.ledger.balance('account')).toMatchObject({available:8,reserved:2,sequence:2})
    expect(f.ledger.reconciliation('account')[0]?.status).toBe('unknown')
  })
  it('clears processing after agent initialization fails, without consuming credits',async()=>{
    const f=fixture();let ack=false
    ;(f.sm as any).getOrCreateAgent=async()=>{throw Error('fixture initialization failure')}
    await expect(f.sm.sendMessage(f.session.id,'hello',undefined,undefined,undefined,undefined,undefined,()=>{ack=true})).rejects.toThrow('initialization failure')
    expect(ack).toBe(true)
    expect(f.session.isProcessing).toBe(false)
    expect(f.ledger.balance('account')).toMatchObject({available:10,reserved:0,sequence:1})
  })
  it('does not acknowledge or dispatch a message when its durable write fails',async()=>{
    const f=fixture();let ack=false
    ;(f.sm as any).flushSession=async()=>{throw Error('fixture disk failure')}
    await expect(f.sm.sendMessage(f.session.id,'hello',undefined,undefined,undefined,undefined,undefined,()=>{ack=true})).rejects.toThrow('disk failure')
    expect(ack).toBe(false);expect(f.dispatched()).toBe(0)
    expect(f.ledger.balance('account')).toMatchObject({available:10,reserved:0})
  })
})
