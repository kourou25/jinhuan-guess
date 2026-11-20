import type {Env} from '../env'
import {seal,unseal} from '../ldc/core'
import {provider,type AiProvider} from './config'
import {guessConfigState,legacyGuessProvider} from './guess-config'
import {AiError} from './errors'
import {fail} from '../lib/http'
import {parseConnectionTasks,type AiTask,type ConnectionTasks} from './connections-shared'
import {parseAiBreaker,aiCircuitKey} from './breaker'
import {isTypeSafe,supportsTypeSafeTask} from './protocol'

const draftKey='ai.connections.draft',activeKey='ai.connections.active'
const fixedIds=['cf-primary','cf-vision','cf-fallback','legacy-guess']
type Connection={id:string;name:string;base:string;model:string;box:string}
type Config={version:1;revision:string;connections:Connection[];tasks:ConnectionTasks}
type Stored={raw:string;config:Config}
const aad=(id:string)=>`ai-connection:v1:${id}`
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(v)&&!fixedIds.includes(v)
const validText=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v)
function validConnection(c:Record<string,unknown>){
 return validId(c.id)&&validText(c.name,60)&&!!c.name.trim()&&validText(c.base,512)&&validText(c.model,100)&&(!c.base||!!provider('guess',c.base,'check','check'))&&(!c.model||!!provider('guess','https://example.com/v1',c.model,'check'))
}
async function read(env:Env,key:string):Promise<Stored|null>{
 const row=await env.DB.prepare('SELECT v FROM site_settings WHERE k=?').bind(key).first<{v:string}>()
 if(!row)return null
 try{
  const c=JSON.parse(row.v)
  if(!record(c)||Object.keys(c).some(k=>!['version','revision','connections','tasks'].includes(k))||c.version!==1||typeof c.revision!=='string'||!Array.isArray(c.connections)||c.connections.length>10||c.connections.some(e=>!record(e)||Object.keys(e).some(k=>!['id','name','base','model','box'].includes(k))||!validConnection(e)||typeof e.box!=='string'||e.box.length>2048)||new Set(c.connections.map(e=>e.id)).size!==c.connections.length)throw Error()
  const config={...c,tasks:parseConnectionTasks(c.tasks)} as Config
  const ids=new Set([...fixedIds,...config.connections.map(c=>c.id)])
  if(Object.values(config.tasks).some(r=>!ids.has(r.connection)))throw Error()
  return {raw:row.v,config}
 }catch{return fail(409,'模型连接配置损坏，请先核对配置')}
}
function cfSlots(env:Env){
 return [
  {id:'cf-primary',name:'Cloudflare 主文字',base:env.AI_BASE_URL,model:env.AI_MODEL,key:env.AI_API_KEY},
  {id:'cf-vision',name:'Cloudflare 视觉',base:env.AI_VISION_BASE_URL||env.AI_BASE_URL,model:env.AI_VISION_MODEL,key:env.AI_VISION_BASE_URL?env.AI_VISION_API_KEY:env.AI_API_KEY},
  {id:'cf-fallback',name:'Cloudflare 备用',base:env.AI_FALLBACK_BASE_URL,model:env.AI_FALLBACK_MODEL,key:env.AI_FALLBACK_API_KEY},
 ]
}
function compatibleTask(env:Env,config:Config,task:string,id:string){
 const base=cfSlots(env).find(c=>c.id===id)?.base??config.connections.find(c=>c.id===id)?.base??''
 return !isTypeSafe(base)||supportsTypeSafeTask(task)
}
function taskOptions(p:AiProvider,row:ConnectionTasks[AiTask]){
 if(!row)throw new AiError('ai_input',400)
 return {source:'dedicated' as const,model:'',thinking:p.protocol==='typesafe'?false:row.thinking,stream:p.protocol==='typesafe'?false:row.stream,maxTokens:row.maxTokens}
}
async function resolve(env:Env,config:Config,id:string,test=false):Promise<AiProvider>{
 let p:AiProvider|null=null
 if(id==='legacy-guess'){
  p=await legacyGuessProvider(env)
 }else{
  const cf=cfSlots(env).find(c=>c.id===id)
  if(cf)p=provider('guess',cf.base,cf.model,cf.key)
  else{
   const c=config.connections.find(c=>c.id===id)
   let key=''
   try{if(c?.box&&env.LDC_ENCRYPTION_KEY)key=await unseal(env.LDC_ENCRYPTION_KEY,aad(id),c.box)}catch{throw new AiError('ai_disabled',503)}
   if(c)p=provider('guess',c.base,c.model,key)
  }
 }
 if(!p)throw new AiError('ai_disabled',503)
 // Identity includes credentials without exposing them. Label edits do not reset cooldown.
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([p.url,p.model,p.key])))
 const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('').slice(0,32)
 return {...p,name:test?'guess-test':'guess',connectionId:id,circuit:`${test?'connection-test':'connection'}.${hash}`}
}
export async function connectionState(env:Env){
 const [draft,active,old]=await Promise.all([read(env,draftKey),read(env,activeKey),guessConfigState(env)])
 const catalog=[...cfSlots(env).map(c=>({id:c.id,name:c.name,base:c.base??'',model:c.model??'',has_key:!!c.key,ready:!!provider('guess',c.base,c.model,c.key),readonly:true})),{id:'legacy-guess',name:'原猜词专用连接',base:old.active?.base??'',model:old.active?.model??'',has_key:old.active?.has_key??false,ready:old.active?.ready??false,readonly:true}]
 const publicConfig=(c:Config|null)=>{
  if(!c)return null
  const connections=c.connections.map(({box,...rest})=>({...rest,has_key:!!box,ready:!!provider('guess',rest.base,rest.model,box&&env.LDC_ENCRYPTION_KEY?'check':undefined)}))
  const available=new Map([...catalog,...connections].map(c=>[c.id,c.ready]))
  return {revision:c.revision,connections,tasks:c.tasks,ready:Object.entries(c.tasks).every(([task,r])=>available.get(r.connection)===true&&compatibleTask(env,c,task,r.connection))}
 }
 return {catalog,draft:publicConfig(draft?.config??null),active:publicConfig(active?.config??null),can_store_key:!!env.LDC_ENCRYPTION_KEY}
}
export async function saveConnectionDraft(env:Env,body:Record<string,unknown>,t:number){
 if(Object.keys(body).some(k=>!['revision','connections','tasks'].includes(k))||body.revision!==null&&typeof body.revision!=='string'||!Array.isArray(body.connections)||body.connections.length>10)return fail(400,'连接配置格式无效，最多10个自定义连接')
 let tasks:ConnectionTasks
 try{tasks=parseConnectionTasks(body.tasks)}catch{return fail(400,'用途配置无效：输出上限为64–16000，开关须为布尔值')}
 const entries=body.connections
 if(entries.some(c=>!record(c)||Object.keys(c).some(k=>!['id','name','base','model','key','clear_key'].includes(k))||!validConnection(c)||typeof c.key!=='string'||typeof c.clear_key!=='boolean'||c.key&&c.clear_key||c.key&&!provider('guess','https://example.com/v1','check',c.key))||new Set(entries.map(c=>c.id)).size!==entries.length)fail(400,'请检查连接名称、唯一编号、HTTPS地址、模型和密钥格式')
 const ids=new Set([...fixedIds,...entries.map(c=>c.id)])
 if(Object.values(tasks).some(r=>!ids.has(r.connection)))fail(400,'用途引用了不存在的连接')
 const [old,active]=await Promise.all([read(env,draftKey),read(env,activeKey)])
 if(body.revision!==(old?.config.revision??null))fail(409,'连接草稿已被更新，请刷新后重试')
 if(active&&Object.values(active.config.tasks).some(r=>!ids.has(r.connection)))fail(409,'连接仍在使用，请先修改用途并启用，再删除连接')
 const connections:Connection[]=[]
 for(const e of entries){
  const previous=old?.config.connections.find(c=>c.id===e.id),base=e.base.trim(),model=e.model.trim()
  if(previous?.box&&!e.key&&!e.clear_key&&base!==previous.base)fail(400,'修改服务地址时请重新输入密钥，或清除已保存密钥')
  let box=e.clear_key?'':previous?.box??''
  if(e.key){
   if(!env.LDC_ENCRYPTION_KEY)return fail(503,'服务端加密配置未就绪，暂不能保存密钥')
   try{box=await seal(env.LDC_ENCRYPTION_KEY,aad(e.id),e.key)}catch{return fail(503,'服务端加密配置无效，未保存密钥')}
  }
  connections.push({id:e.id,name:e.name.trim(),base,model,box})
 }
 const config:Config={version:1,revision:crypto.randomUUID(),connections,tasks},raw=JSON.stringify(config)
 for(const [task,row] of Object.entries(tasks))if(!compatibleTask(env,config,task,row.connection))fail(400,'Jev 仅支持相关度和是非判断；出题、线索及对话请选择文字生成模型')
 const result=old?await env.DB.prepare('UPDATE site_settings SET v=?,updated_at=? WHERE k=? AND v=?').bind(raw,t,draftKey,old.raw).run():await env.DB.prepare('INSERT OR IGNORE INTO site_settings(k,v,updated_at) VALUES(?,?,?)').bind(draftKey,raw,t).run()
 if(!result.meta.changes)fail(409,'连接草稿已被更新，请刷新后重试')
 return connectionState(env)
}
export async function activateConnections(env:Env,revision:unknown,t:number){
 const draft=await read(env,draftKey)
 if(!draft||typeof revision!=='string'||draft.config.revision!==revision)return fail(409,'连接草稿已变化，请刷新后重试')
 for(const [task,row] of Object.entries(draft.config.tasks))if(!compatibleTask(env,draft.config,task,row.connection))fail(400,'Jev 仅支持相关度和是非判断，请修改不支持的用途后再启用')
 for(const id of new Set(Object.values(draft.config.tasks).map(r=>r.connection))){
  try{await resolve(env,draft.config,id)}catch{return fail(400,'已选择的连接尚未完整配置或无法解密，请核对后再启用')}
 }
 const result=await env.DB.prepare(`INSERT INTO site_settings(k,v,updated_at) SELECT ?,v,? FROM site_settings WHERE k=? AND v=?
  ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated_at=excluded.updated_at`).bind(activeKey,t,draftKey,draft.raw).run()
 if(!result.meta.changes)fail(409,'连接草稿已变化，请刷新后重试')
 return connectionState(env)
}
export async function disableConnections(env:Env,revision:unknown){
 const active=await read(env,activeKey)
 if(!active||typeof revision!=='string'||revision!==active.config.revision)return fail(409,'生效配置已变化，请刷新后重试')
 const result=await env.DB.prepare('DELETE FROM site_settings WHERE k=? AND v=?').bind(activeKey,active.raw).run()
 if(!result.meta.changes)fail(409,'生效配置已变化，请刷新后重试')
 return connectionState(env)
}
export async function configuredTaskProvider(env:Env,task:AiTask):Promise<AiProvider|null>{
 const active=await read(env,activeKey),row=active?.config.tasks[task]
 if(!active||!row)return null
 const p=await resolve(env,active.config,row.connection)
 if(p.protocol==='typesafe'&&!supportsTypeSafeTask(task))throw new AiError('ai_input',400)
 return {...p,guessOptions:taskOptions(p,row)}
}
export async function connectionDraftProvider(env:Env,revision:unknown,task:AiTask){
 const draft=await read(env,draftKey)
 if(!draft||typeof revision!=='string'||revision!==draft.config.revision)return fail(409,'连接草稿已变化，请先保存再测试')
 const row=draft.config.tasks[task]
 if(!row)return fail(400,'请为测试用途选择一个连接')
 const p=await resolve(env,draft.config,row.connection,true)
 if(p.protocol==='typesafe'&&!supportsTypeSafeTask(task))fail(400,'Jev 仅支持相关度和是非判断，请选择对应测试用途')
 return {...p,guessOptions:taskOptions(p,row)}
}
export async function connectionRuntimeState(env:Env,t:number){
 const active=await read(env,activeKey)
 if(!active)return {}
 const rows=await Promise.all(Object.entries(active.config.tasks).map(async([task,row])=>{
  try{const p=await resolve(env,active.config,row.connection);return {task,connection:row.connection,model:p.model,circuit:p.circuit!,ready:true}}
  catch{return {task,connection:row.connection,model:null,circuit:null,ready:false}}
 }))
 const keys=[...new Set(rows.flatMap(r=>r.circuit?[aiCircuitKey(r.circuit)]:[]))]
 const values=keys.length?await env.DB.prepare(`SELECT k,v FROM site_settings WHERE k IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all<{k:string;v:string}>():{results:[]}
 const raw=new Map(values.results.map(r=>[r.k,r.v]))
 return Object.fromEntries(rows.map(({circuit,...r})=>{const value=circuit?raw.get(aiCircuitKey(circuit)):undefined,b=value===undefined?null:parseAiBreaker(value);return [r.task,{...r,status:!r.ready?'unconfigured':value!==undefined&&!b?'invalid':b&&b.open_until>t?'open':b&&b.open_until>0?'half_open':'closed',until:b?.open_until??0}]}))
}
