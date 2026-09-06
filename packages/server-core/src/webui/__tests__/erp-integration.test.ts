import { afterEach, describe, expect, it } from 'bun:test'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ControlLedger } from '../control-ledger'
import { AccountDatabaseFile } from '../account-database'
import { ErpSsoClient, ssoConfig, accessSnapshot, resolveManagedDefaultModel, type AccessSnapshot } from '../erp-sso'
import { ErpControlRuntime } from '../erp-control-runtime'
import { AccountStore } from '../accounts'
import { createWebuiHandler } from '../http-server'
import { createSessionToken } from '../auth'

const roots:string[]=[]
afterEach(()=>{for(const root of roots.splice(0)){if(!resolve(root).startsWith(resolve(tmpdir())))throw Error('Unsafe cleanup');rmSync(root,{recursive:true,force:true})}})
function temp(){const r=mkdtempSync(join(tmpdir(),'erp-v2-test-'));roots.push(r);return r}
const account='erp-0123456789abcdef01234567'; const member='fixture-member'
const policy:AccessSnapshot={schema_version:2,member_id:member,account_id:account,login_email:'User.Name+design@example.com',tenant_id:'customer-a',active:true,role:'user',models:['test-model'],skills:[],sources:[],task_price:2,max_concurrency:1,ttl_seconds:60,policy_version:'a'.repeat(64),pricing_version:'fixed-task-v1',execution_mode:'server_only',desktop_channel:'internal'}
function fixture(){
  const root=temp();const calls:Array<{method:string;body:any}>=[];const workspaceNames:string[]=[];let down=false;let active=true;let role:AccessSnapshot['role']='user';let desktopChannel:AccessSnapshot['desktop_channel']='internal'
  const request=(async(input:string|URL|Request,init:RequestInit={})=>{
    const url=new URL(String(input)); const method=url.pathname.split('.').pop()!;const body=typeof init.body==='string'?JSON.parse(init.body):{}
    calls.push({method,body})
    if(down)return new Response('upstream secret must never escape',{status:503})
    if(method==='get_token')return Response.json({access_token:'fixture-ephemeral-token',token_type:'Bearer'})
    if(method==='my_identity')return Response.json({message:{member_id:member,account_id:account}})
    if(method==='get_access_snapshot')return Response.json({message:{...policy,active,role,desktop_channel:desktopChannel}})
    if(method==='pending_grants')return Response.json({message:{grants:[{grant_id:'test-grant',units:10}]}})
    if(method==='pending_resolutions')return Response.json({message:{resolutions:[]}})
    if(method==='resources')return Response.json({message:{schema_version:1,releases:[]}})
    if(method==='ingest_event')return Response.json({message:{event_id:body.event.event_id,sequence:body.event.sequence}})
    return Response.json({message:{accepted:true}})
  })as typeof fetch
  const client=new ErpSsoClient({erp:'https://erp.example',origin:'https://craft.example',clientId:'test-client',serviceUser:'service@example.invalid',apiKey:'test-key',apiSecret:'test-secret'},request)
  const store=new AccountStore({filePath:join(root,'accounts.json'),usersRoot:join(root,'users'),createWorkspace:({name})=>{workspaceNames.push(name);return{id:name}}})
  const ledger=new ControlLedger(join(root,'ledger.json'));const runtime=new ErpControlRuntime(client,store,ledger)
  return{root,client,store,ledger,runtime,calls,workspaceNames,setDown(v:boolean){down=v},setActive(v:boolean){active=v},setRole(v:AccessSnapshot['role']){role=v},setDesktopChannel(v:AccessSnapshot['desktop_channel']){desktopChannel=v}}
}

describe('ERP SSO and reliable business integration',()=>{
  it('production policy enables the project-scoped agent runtime without touching the ledger',async()=>{
    const f=fixture();await f.runtime.provision({member_id:member,account_id:account})
    expect(()=>f.runtime.assertAgentExecution()).not.toThrow()
    expect(f.ledger.balance(account)).toMatchObject({available:10,reserved:0,sequence:1})
  })
  it('uses stable server provider reservations, original prices and rejects duplicate creation',async()=>{
    const f=fixture();const a=await f.runtime.provision({member_id:member,account_id:account})
    const input={workspaceId:a.workspaceId,model:'test-model',skills:[],sources:[]}
    const job=f.runtime.providerTask(input,'canvas-fixture')
    await expect(job.check()).rejects.toThrow('预占')
    await job.reserve();await job.check()
    await expect(job.reserve()).rejects.toThrow('already accepted')
    await job.finish('unknown')
    expect(f.ledger.balance(account).reserved).toBe(2)
    // A durable provider task may later return a definite terminal result.
    await job.finish('complete');await job.finish('complete');await f.runtime.sync()
    expect(f.ledger.balance(account)).toMatchObject({available:8,reserved:0,sequence:3})
    f.setActive(false)
    await expect(job.authorize()).rejects.toThrow('未授权')
  })
  it('is opt-in and fails on partial or unsafe configuration',()=>{
    expect(ssoConfig({})).toBeUndefined()
    expect(()=>ssoConfig({JONWORK_SSO_ERP_URL:'https://erp.example'})).toThrow()
    expect(()=>accessSnapshot({...policy,models:['*']})).toThrow()
    expect(()=>accessSnapshot({...policy,login_email:'not-an-email'})).toThrow()
    expect(accessSnapshot(policy).login_email).toBe('user.name+design@example.com')
    expect(accessSnapshot({...policy,role:'admin'}).role).toBe('admin')
    expect(()=>accessSnapshot({...policy,role:'owner'})).toThrow()
  })
  it('uses the ERP default model, with DeepSeek as the backward-compatible product default',()=>{
    const models=['claude-opus-4-8','pi/deepseek-v4-pro','pi/deepseek-v4-flash']
    expect(resolveManagedDefaultModel({...policy,models})).toBe('pi/deepseek-v4-pro')
    expect(resolveManagedDefaultModel({...policy,models,default_model:'pi/deepseek-v4-flash'})).toBe('pi/deepseek-v4-flash')
    expect(accessSnapshot({...policy,models,default_model:'pi/deepseek-v4-flash'}).default_model).toBe('pi/deepseek-v4-flash')
    expect(()=>accessSnapshot({...policy,models,default_model:'pi/not-authorized'})).toThrow()
  })
  it('binds OAuth state to browser, uses PKCE, and consumes callback once',async()=>{
    const f=fixture();const flow=f.client.start();const loginUrl=new URL(flow.url)
    expect(loginUrl.pathname).toBe('/email-login')
    const url=new URL(loginUrl.searchParams.get('redirect-to')!,loginUrl.origin)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    await expect(f.client.complete(url.searchParams.get('state')!,'test-code','wrong-browser')).rejects.toThrow()
    expect(f.calls).toHaveLength(0)
    const result=await f.client.complete(url.searchParams.get('state')!,'test-code',flow.browser)
    expect(result.device).toBe(false)
    await expect(f.client.complete(url.searchParams.get('state')!,'test-code',flow.browser)).rejects.toThrow()
  })
  it('releases desktop result only to the matching verifier, once',async()=>{
    const f=fixture();const verifier=randomBytes(32).toString('base64url');const challenge=createHash('sha256').update(verifier).digest('base64url')
    const device=f.client.startDevice(challenge);const flow=f.client.start(device.device)
    expect(f.client.poll(device.device,verifier)).toBeNull()
    const loginUrl=new URL(flow.url);const oauthUrl=new URL(loginUrl.searchParams.get('redirect-to')!,loginUrl.origin)
    await f.client.complete(oauthUrl.searchParams.get('state')!,'code',flow.browser)
    expect(()=>f.client.poll(device.device,'z'.repeat(43))).toThrow()
    expect(f.client.poll(device.device,verifier)?.account_id).toBe(account)
    expect(()=>f.client.poll(device.device,verifier)).toThrow()
  })
  it('provisions a normal user idempotently without legacy credit import or password login',async()=>{
    const f=fixture();const a=await f.runtime.provision({member_id:member,account_id:account})
    expect(f.workspaceNames).toEqual(['customer-a 企业工作区'])
    expect(a.role).toBe('user');expect(a.credits).toBe(10);expect(a.username).toBe('user.name+design@example.com')
    await f.runtime.provision({member_id:member,account_id:account})
    expect(f.workspaceNames).toEqual(['customer-a 企业工作区','customer-a 企业工作区'])
    expect(f.store.listAccounts()).toHaveLength(1);expect(f.ledger.balance(account).available).toBe(10)
    await expect(f.store.charge(account,'test-request-0001')).rejects.toThrow()
    await expect(f.store.credit(account,10)).rejects.toThrow()
    await expect(f.store.setRole(account,'admin')).rejects.toThrow()
    expect(await f.store.authenticate(account,'anything')).toBeNull()
  })
  it('maps ERP administrators to Jonwork administrators and revokes old role sessions',async()=>{
    const f=fixture()
    f.setRole('admin')
    const admin=await f.runtime.provision({member_id:member,account_id:account})
    expect(admin.role).toBe('admin')
    expect(f.store.isAdmin(account)).toBe(true)
    const oldVersion=admin.authVersion??0
    f.setRole('user')
    const downgraded=await f.runtime.provision({member_id:member,account_id:account})
    expect(downgraded.role).toBe('user')
    expect(downgraded.authVersion).toBe(oldVersion+1)
    expect(f.store.isSessionActive(account,oldVersion)).toBe(false)
  })
  it('enforces current policy before dispatch and retains outbox across outages/restart',async()=>{
    const f=fixture();const a=await f.runtime.provision({member_id:member,account_id:account})
    const input={workspaceId:a.workspaceId,model:'test-model',sources:[],skills:[]}
    await expect(f.runtime.begin({...input,model:'not-authorized'})).rejects.toThrow()
    const receipt=await f.runtime.begin(input)
    await expect(f.runtime.begin(input)).rejects.toThrow('并发')
    f.setDown(true);await receipt.complete('complete');await f.runtime.sync()
    const reopened=new ControlLedger(join(f.root,'ledger.json'))
    expect(reopened.balance(account)).toMatchObject({available:8,reserved:0,pending:3})
    f.setDown(false);await f.runtime.sync()
    expect(reopened.balance(account).pending).toBe(0)
    f.setActive(false);await expect(f.runtime.begin(input)).rejects.toThrow()
  })
  it('serializes reservations and rejects altered grants or duplicate execution',()=>{
    const root=temp();const a=new ControlLedger(join(root,'wallet'));const b=new ControlLedger(join(root,'wallet'))
    a.ensure(account,member);a.grant(account,'g-1',10);b.grant(account,'g-1',10)
    expect(()=>b.grant(account,'g-1',20)).toThrow()
    a.reserve(account,'task-1','test-model',6,3)
    expect(()=>b.reserve(account,'task-2','test-model',6,3)).toThrow()
    expect(()=>b.reserve(account,'task-1','test-model',1,3)).toThrow()
    b.finish(account,'task-1',4,'complete');b.finish(account,'task-1',4,'complete')
    expect(a.balance(account)).toMatchObject({available:6,reserved:0,pending:4})
    expect(()=>a.acknowledge(account,'wrong',1)).toThrow()
  })
  it('preserves terminal capacity and retries a legacy full-outbox completion after restart',()=>{
    const path=join(temp(),'wallet'); const ledger=new ControlLedger(path)
    ledger.ensure(account,member); ledger.grant(account,'g-1',10); ledger.reserve(account,'task-1','test-model',2,1)
    // Simulate the exact pre-upgrade failure state without 10,000 filesystem transactions.
    new AccountDatabaseFile<any>(path,v=>v).transaction(s=>{
      const w=s.wallets[account]
      w.pending=Array.from({length:10000},(_,i)=>({...w.pending[0],event_id:`fixture-${i}`,sequence:i+1}))
      w.sequence=10000
    })
    ledger.finish(account,'task-1',1,'complete')
    expect(ledger.reconciliation(account)).toEqual([{task:'task-1',reserved:2,model:'test-model',status:'settlement_pending'}])
    expect(()=>ledger.grant(account,'g-2',1)).toThrow('outbox full')
    const reopened=new ControlLedger(path); reopened.recoverInterrupted()
    expect(reopened.balance(account).reserved).toBe(2)
    for(let i=0;i<2;i++){const e=reopened.next(account)!;reopened.acknowledge(account,e.event_id,e.sequence)}
    expect(reopened.balance(account)).toMatchObject({available:9,reserved:0,pending:10000,sequence:10002})
    expect(reopened.reconciliation(account)).toEqual([])
    reopened.finish(account,'task-1',1,'complete')
    expect(reopened.balance(account).sequence).toBe(10002)
  })
  it('marks crash outcomes unknown instead of refunding and persists zero-charge releases',()=>{
    const path=join(temp(),'wallet');const ledger=new ControlLedger(path)
    ledger.ensure(account,member);ledger.grant(account,'g',10);ledger.reserve(account,'task','test-model',2,1)
    const reopened=new ControlLedger(path);reopened.recoverInterrupted()
    expect(reopened.reconciliation(account)[0]?.status).toBe('unknown')
    expect(reopened.balance(account)).toMatchObject({available:8,reserved:2})
    reopened.finish(account,'task',0,'interrupted')
    expect(new ControlLedger(path).balance(account)).toMatchObject({available:10,reserved:0})
    reopened.finish(account,'task',0,'interrupted')
    expect(()=>reopened.finish(account,'task',2,'complete')).toThrow('Conflicting')
  })
  it('reports delivery and unknown-execution failures without leaking upstream details',async()=>{
    const f=fixture();const a=await f.runtime.provision({member_id:member,account_id:account})
    await f.runtime.begin({workspaceId:a.workspaceId,model:'test-model',sources:[],skills:[]})
    f.ledger.recoverInterrupted();await f.runtime.sync()
    const heartbeat=f.calls.filter(c=>c.method==='heartbeat').at(-1)!.body
    expect(heartbeat).toMatchObject({unknown_tasks:1,sync_error:'unknown_execution',provisioning_status:'blocked'})
  })
  it('deduplicates concurrent and post-restart message acceptance before dispatch',async()=>{
    const f=fixture();await f.runtime.provision({member_id:member,account_id:account})
    const args=['session-a','hello',[],[],{requestId:'stable-request-1'}];let calls=0
    const dispatch=async()=>{calls++;return {accepted:true,messageId:'message-a'}}
    const results=await Promise.all([f.runtime.acceptMessage(account,args,dispatch),f.runtime.acceptMessage(account,args,dispatch)])
    expect(calls).toBe(1);expect(results[0]).toEqual(results[1])
    const restarted=new ErpControlRuntime(f.client,f.store,new ControlLedger(join(f.root,'ledger.json')))
    expect(await restarted.acceptMessage(account,args,dispatch)).toEqual(results[0]);expect(calls).toBe(1)
    await expect(restarted.acceptMessage(account,[args[0],'different',...args.slice(2)],dispatch)).rejects.toThrow('其他内容')
    await expect(restarted.acceptMessage(account,['session-a','hello'],dispatch)).rejects.toThrow('稳定请求')
  })
  it('does not redispatch an ambiguous crashed request',async()=>{
    const f=fixture();await f.runtime.provision({member_id:member,account_id:account})
    const args=['session-a','hello',[],[],{requestId:'stable-request-1'}]
    const key=createHash('sha256').update(JSON.stringify([account,args[0],'stable-request-1'])).digest('hex')
    f.ledger.claimRequest(account,key,createHash('sha256').update(JSON.stringify(args)).digest('hex'))
    let calls=0
    await expect(f.runtime.acceptMessage(account,args,async()=>{calls++;return {accepted:true,messageId:'m'}})).rejects.toThrow('不会重复')
    expect(calls).toBe(0)
  })
  it('applies approved reconciliation once, never against a running task',()=>{
    const ledger=new ControlLedger(join(temp(),'wallet'))
    ledger.ensure(account,member);ledger.grant(account,'g',10);ledger.reserve(account,'task','test-model',2,1)
    expect(()=>ledger.resolveUnknown(account,'task','resolution-1',1,'failed')).toThrow('Only unknown')
    ledger.recoverInterrupted()
    ledger.resolveUnknown(account,'task','resolution-1',1,'failed')
    ledger.resolveUnknown(account,'task','resolution-1',1,'failed')
    expect(ledger.balance(account)).toMatchObject({available:9,reserved:0,sequence:4})
    expect(()=>ledger.resolveUnknown(account,'task','resolution-2',0,'interrupted')).toThrow('Conflicting')
  })
  it('serves managed HTTP account state and blocks legacy login/client refunds',async()=>{
    const f=fixture();const a=await f.runtime.provision({member_id:member,account_id:account});const secret='fixture-signing-key'
    const h=createWebuiHandler({webuiDir:f.root,secret,wsProtocol:'ws',wsPort:1,accountStore:f.store,erpControl:f.runtime,getHealthCheck:()=>({status:'ok'}),logger:{info(){},warn(){},error(){}}as any})
    try{
      const policyResponse=await h.fetch(new Request('https://craft.example/api/auth/policy'));expect((await policyResponse.json() as any).sso).toBe(true)
      const failedCallback=await h.fetch(new Request('https://craft.example/api/auth/sso/callback?code=expired&state=expired'))
      expect(failedCallback.status).toBe(403);expect(failedCallback.headers.get('content-type')).toContain('text/html')
      const failedPage=await failedCallback.text();expect(failedPage).toContain('重新登录');expect(failedPage).toContain('刷新重试');expect(failedPage).toContain('返回登录页')
      const token=await createSessionToken(secret,a.id)
      const response=await h.fetch(new Request('https://craft.example/api/account',{headers:{Authorization:`Bearer ${token}`}}))
      expect((await response.json() as any).credits).toBe(10)
      expect((await h.fetch(new Request('https://craft.example/api/desktop/update-access'))).status).toBe(401)
      expect((await h.fetch(new Request('https://craft.example/api/desktop/update-access',{headers:{Authorization:`Bearer ${token}`}}))).status).toBe(204)
      f.setDesktopChannel('')
      expect((await h.fetch(new Request('https://craft.example/api/desktop/update-access',{headers:{Authorization:`Bearer ${token}`}}))).status).toBe(403)
      f.setDesktopChannel('internal')
      for(const path of ['/api/auth','/api/auth/register','/api/account/refund','/api/account/charge']){
        expect((await h.fetch(new Request(`https://craft.example${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}))).status).toBe(403)
      }
      await f.runtime.policy(account,true); f.setActive(false); await f.runtime.policy(account,true)
      expect((await h.fetch(new Request('https://craft.example/api/account',{headers:{Authorization:`Bearer ${token}`}}))).status).toBe(401)
    }finally{h.dispose()}
  })
  it('serves only the fixed public Windows installer path before login',async()=>{
    const f=fixture();const downloads=join(f.root,'downloads');mkdirSync(downloads)
    writeFileSync(join(downloads,'Jonwork-Setup-x64.exe'),'signed-fixture')
    writeFileSync(join(downloads,'private.txt'),'must-not-be-public')
    const h=createWebuiHandler({webuiDir:f.root,secret:'fixture-signing-key',wsProtocol:'ws',wsPort:1,accountStore:f.store,erpControl:f.runtime,getHealthCheck:()=>({status:'ok'}),logger:{info(){},warn(){},error(){}}as any})
    try{
      const installer=await h.fetch(new Request('https://v2.jonwork.com/downloads/Jonwork-Setup-x64.exe'))
      expect(installer.status).toBe(200);expect(await installer.text()).toBe('signed-fixture')
      expect(installer.headers.get('content-disposition')).toContain('Jonwork-Setup-x64.exe')
      const head=await h.fetch(new Request('https://v2.jonwork.com/downloads/Jonwork-Setup-x64.exe',{method:'HEAD'}))
      expect(head.status).toBe(200);expect(await head.text()).toBe('')
      const denied=await h.fetch(new Request('https://v2.jonwork.com/downloads/private.txt'))
      expect(denied.status).toBe(401)
    }finally{h.dispose()}
  })
})
