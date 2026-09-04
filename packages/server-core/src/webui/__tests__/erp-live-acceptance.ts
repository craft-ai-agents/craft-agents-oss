/** Opt-in, local-only acceptance. Launched by erpnext/deploy/integration/test-local.ps1.
 * Real ERP HTTP OAuth and ledger; no model/provider calls or customer data.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { strict as assert } from 'node:assert'
import { ErpSsoClient } from '../erp-sso'
import { ErpControlRuntime } from '../erp-control-runtime'
import { AccountStore } from '../accounts'
import { ControlLedger } from '../control-ledger'
import { createWebuiHandler } from '../http-server'
import { validateSession, isEstablishedAccountSessionActive } from '../auth'
import { WsRpcServer, WsRpcClient } from '../../transport'
import { SessionManager, createManagedSession } from '../../sessions/SessionManager'
import { registerSessionsHandlers } from '../../handlers/rpc/sessions'
import { AccountScopedRpcServer } from '../../../../server/src/account-rpc-policy'
import { desktopErpLogin } from '../../../../../apps/electron/src/main/desktop-erp-login'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { sessionPersistenceQueue } from '@craft-agent/shared/sessions/persistence-queue'

const config=JSON.parse(process.env.CRAFT_E2E_CONFIG ?? '{}')
delete process.env.CRAFT_E2E_CONFIG
if (!/^[a-f0-9]{16}$/.test(config.tag ?? '')) throw Error('Local fixture required')
function bench(method:string,args:unknown[]) {
  const out=execFileSync('docker',['exec','jonwork-erpnext-backend-1','bench','--site','frontend','execute',`jonwork_control.tests.http_fixture.${method}`,'--args',JSON.stringify(args)],{encoding:'utf8',stdio:['ignore','pipe','pipe']})
  return JSON.parse(out.trim().split('\n').at(-1)!)
}
const root=mkdtempSync(join(tmpdir(),'craft-live-e2e-'))
const client=new ErpSsoClient({erp:'http://127.0.0.1:8080',origin:'http://127.0.0.1:19190',clientId:config.clientId,serviceUser:config.service,apiKey:config.apiKey,apiSecret:config.apiSecret})
let workspace: any
const accounts=new AccountStore({filePath:join(root,'accounts.json'),usersRoot:join(root,'users'),createWorkspace:({name,rootPath})=>{
  workspace={id:'fixture-erp-workspace',name,rootPath,createdAt:Date.now()};return workspace
}})
const runtime=new ErpControlRuntime(client,accounts,new ControlLedger(join(root,'ledger.json')))
const secret=crypto.randomUUID()
const wsServer=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,
  validateSessionCookie:async cookie=>{
    const claims=await validateSession(cookie,secret)
    return claims && isEstablishedAccountSessionActive(cookie,claims.sub,accounts) && (await runtime.policy(claims.sub)).active ? claims.sub : null
  },
  isSessionActive:(cookie,id)=>isEstablishedAccountSessionActive(cookie,id,accounts)&&runtime.isActive(id),
  resolvePrincipalWorkspace:id=>accounts.getWorkspaceId(id),
})
await wsServer.listen()
let wsClient: WsRpcClient | undefined
const handler=createWebuiHandler({webuiDir:root,secret,wsProtocol:'ws',wsPort:wsServer.port,accountStore:accounts,erpControl:runtime,jonworkControl:null,getHealthCheck:()=>({status:'ok'}),logger:{info(){},warn(){},error(){}} as any})
const server=Bun.serve({hostname:'127.0.0.1',port:19190,fetch:req=>handler.fetch(req)})
let stage='web-oauth'
let terminalTimer: ReturnType<typeof setTimeout> | undefined
try {
  const start=await fetch('http://127.0.0.1:19190/api/auth/sso/start',{redirect:'manual'})
  assert.equal(start.status,302)
  const cookie=start.headers.get('set-cookie')!.split(';')[0]!
  const consent=bench('authorize',[config.tag,start.headers.get('location')])
  const callback=await fetch(consent.location,{redirect:'manual',headers:{Cookie:cookie}})
  assert.equal(callback.status,302,'Real ERP OAuth callback failed')
  const session=callback.headers.getSetCookie().find(c=>c.startsWith('craft_session='))!.split(';')[0]!
  const accountResponse=await fetch('http://127.0.0.1:19190/api/account',{headers:{Cookie:session}})
  assert.equal(accountResponse.status,200)
  const account=await accountResponse.json() as any
  assert.equal(account.id,config.account); assert.equal(account.credits,10)
  stage='desktop-device-login'
  // Exercise the same device helper used by Electron. Browser consent is driven
  // through real ERP HTTP, not a real GUI; the provider alone remains a test double.
  const desktop=await desktopErpLogin('http://127.0.0.1:19190',{
    request:fetch,cancelled:()=>false,wait:async()=>{},
    open:async url=>{
      const start=await fetch(url,{redirect:'manual'})
      const consent=bench('authorize',[config.tag,start.headers.get('location')])
      const callback=await fetch(consent.location,{redirect:'manual',headers:{Cookie:start.headers.get('set-cookie')!.split(';')[0]!}})
      assert.equal(callback.status,200)
    },
  })
  stage='session-and-websocket-setup'
  const sm=new SessionManager()
  sm.requireIsolatedAccountExecution()
  sm.setExecutionPolicy(runtime)
  sm.setEventSink((...args)=>wsServer.push(...args))
  const managed=createManagedSession({id:'live-fixture-session',name:'Fixture',model:'fixture-model'},workspace,{messagesLoaded:true})
  ;(sm as any).sessions.set(managed.id,managed)
  let dispatched=0,held=0
  ;(sm as any).getOrCreateAgent=async()=>({setAllSources(){},getModel:()=> 'fixture-model',getSessionId:()=>undefined,
    async *chat(){dispatched++;held=runtime.ledger.balance(account.id).reserved;yield {type:'complete'}}})
  const scoped=new AccountScopedRpcServer(wsServer,accounts,sm,runtime)
  registerSessionsHandlers(scoped,{sessionManager:sm,platform:{logger:{info(){},warn(){},error(){}}}} as any)
  wsClient=new WsRpcClient(`ws://127.0.0.1:${wsServer.port}`,{token:desktop.accessToken,workspaceId:account.workspaceId,autoReconnect:false,clientCapabilities:[]})
  wsClient.connect()
  stage='websocket-isolation-denial'
  const args=[managed.id,'fixture task',null,null,{requestId:'live-acceptance-request'}]
  await assert.rejects(wsClient.invoke('sessions:sendMessage',...args),/用户及项目级隔离/)
  await assert.rejects(wsClient.invoke('sessions:sendMessage',...args),/用户及项目级隔离/)
  stage='internal-isolation-denial-and-mirror'
  await assert.rejects(sm.sendMessage(managed.id,'internal retry'),/用户及项目级隔离/)
  await runtime.sync()
  assert.equal(dispatched,0);assert.equal(held,0);assert.equal(managed.messages.length,0)
  assert.equal(runtime.ledger.balance(account.id).pending,0)
  assert.deepEqual(bench('inspect',[config.tag]),{available:10,reserved:0,sequence:1,online:true})
  const replay=await fetch(consent.location,{redirect:'manual',headers:{Cookie:cookie}})
  assert.equal(replay.status,403)
  console.log('PASS: real ERP HTTP + desktop device PKCE + account-bearer WebSocket + direct SessionManager isolation denial + retries do not execute or debit + ERP grant mirror/heartbeat. Shared-process agent execution is intentionally unavailable; no sandbox or paid-provider acceptance claimed.')
} catch (error) {
  // Never leak temporary OAuth codes, tokens, cookies, API keys or raw errors.
  console.error(`FAIL: local ERP/Craft acceptance at ${stage}; sensitive error details suppressed.`)
  if (error instanceof Error) console.error(`Error category: ${error.name}; code: ${(error as any).code ?? 'none'}`)
  const safeErrors=['ERP 未授权此模型、技能或数据源','无权访问其他用户的数据','此工作区未绑定 ERP','ERP 授权已停用','ERP service unavailable or access denied']
  if(error instanceof Error && safeErrors.includes(error.message)) console.error(error.message)
  process.exitCode=1
} finally {
  clearTimeout(terminalTimer);wsClient?.destroy();wsServer.close();runtime.dispose();server.stop(true);handler.dispose()
  await sessionPersistenceQueue.flushAll()
  if (!resolve(root).startsWith(resolve(tmpdir())+require('node:path').sep)) throw Error('Unsafe fixture cleanup')
  rmSync(root,{recursive:true,force:true})
}
