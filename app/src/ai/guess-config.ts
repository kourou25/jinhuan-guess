import type {Env} from '../env'
import {seal,unseal} from '../ldc/core'
import {provider,aiProviders,type AiProvider} from './config'
import {AiError} from './errors'
import {fail} from '../lib/http'
import {parseGuessTasks,type GuessTask,type GuessTaskSettings} from './guess-tasks'

const draftKey='ai.guess.draft',activeKey='ai.guess.active',aad='ai-guess-provider:v1'
type Config={revision:string;base:string;model:string;box:string;tasks?:GuessTaskSettings}
type Stored={raw:string;config:Config}
async function read(env:Env,key:string):Promise<Stored|null>{
 const row=await env.DB.prepare('SELECT v FROM site_settings WHERE k=?').bind(key).first<{v:string}>()
 if(!row)return null
 try{const c=JSON.parse(row.v) as Config;if(!c||['revision','base','model','box'].some(k=>typeof c[k as keyof Config]!=='string'))throw Error();c.tasks=parseGuessTasks(c.tasks);return {raw:row.v,config:c}}catch{return fail(409,'猜词模型配置损坏，请先核对配置')}
}
const publicConfig=(c:Config|null)=>c?{revision:c.revision,base:c.base,model:c.model,tasks:c.tasks??{},has_key:!!c.box,ready:!!provider('guess',c.base,c.model,c.box?'validation-key':undefined)}:null
export async function guessConfigState(env:Env){
 const [draft,active]=await Promise.all([read(env,draftKey),read(env,activeKey)])
 return {draft:publicConfig(draft?.config??null),active:publicConfig(active?.config??null),can_store_key:!!env.LDC_ENCRYPTION_KEY}
}
async function resolve(env:Env,c:Config,name:AiProvider['name']){
 let key=''
 try{if(c.box&&env.LDC_ENCRYPTION_KEY)key=await unseal(env.LDC_ENCRYPTION_KEY,aad,c.box)}catch{throw new AiError('ai_disabled',503)}
 const p=provider(name,c.base,c.model,key)
 if(!p)throw new AiError('ai_disabled',503)
 return p
}
export async function legacyGuessProvider(env:Env){
 const stored=await read(env,activeKey)
 return stored?resolve(env,stored.config,'guess'):null
}
export async function guessProviders(env:Env,draft=false,task?:GuessTask){
 const stored=await read(env,draft?draftKey:activeKey)
 if(!stored){if(draft)throw new AiError('ai_disabled',503);return aiProviders(env,false)}
 const options=task?stored.config.tasks?.[task]:undefined
 if(options?.source==='site'){
  const p=provider(draft?'guess-test':'primary',env.AI_BASE_URL,options.model||env.AI_MODEL,env.AI_API_KEY)
  if(!p)throw new AiError('ai_disabled',503)
  return [{...p,guessOptions:options}]
 }
 const p=await resolve(env,{...stored.config,model:options?.model||stored.config.model},draft?'guess-test':'guess')
 return [{...p,...(options?{guessOptions:options}:{})}]
}
export async function saveGuessDraft(env:Env,body:Record<string,unknown>,t:number){
 if(Object.keys(body).some(k=>!['revision','base','model','key','clear_key','tasks'].includes(k))||typeof body.base!=='string'||typeof body.model!=='string'||typeof body.key!=='string'||typeof body.clear_key!=='boolean'||body.revision!==null&&typeof body.revision!=='string')return fail(400,'配置字段无效')
 let tasks:GuessTaskSettings|undefined
 try{if(body.tasks!==undefined)tasks=parseGuessTasks(body.tasks)}catch{return fail(400,'用途配置无效：模型 ID 最多100字，输出上限64–16000，思考开关须为布尔值')}
 const base=body.base.trim(),model=body.model.trim(),key=body.key
 if(base.length>512||base&&!provider('guess',base,'validation-model','validation-key')||model&&!provider('guess','https://example.com/v1',model,'validation-key')||key&&!provider('guess','https://example.com/v1','validation-model',key)||key&&body.clear_key)fail(400,'请检查 HTTPS 基础地址、模型 ID 和密钥格式')
 const old=await read(env,draftKey)
 if(body.revision!==(old?.config.revision??null))fail(409,'配置已被更新，请重新打开后修改')
 if(old?.config.box&&!key&&!body.clear_key&&base!==old.config.base)fail(400,'修改服务地址时请重新输入密钥，或清除已保存密钥')
 let box=body.clear_key?'':old?.config.box??''
 if(key){if(!env.LDC_ENCRYPTION_KEY)return fail(503,'服务端加密配置未就绪，暂不能保存密钥');try{box=await seal(env.LDC_ENCRYPTION_KEY,aad,key)}catch{return fail(503,'服务端加密配置无效，未保存密钥')}}
 const config:Config={revision:crypto.randomUUID(),base,model,box,tasks:tasks??old?.config.tasks??{}},raw=JSON.stringify(config)
 const result=old?await env.DB.prepare('UPDATE site_settings SET v=?,updated_at=? WHERE k=? AND v=?').bind(raw,t,draftKey,old.raw).run():await env.DB.prepare('INSERT OR IGNORE INTO site_settings(k,v,updated_at) VALUES(?,?,?)').bind(draftKey,raw,t).run()
 if(!result.meta.changes)fail(409,'配置已被更新，请重新打开后修改')
 return guessConfigState(env)
}
export async function activateGuessDraft(env:Env,revision:unknown,t:number){
 const draft=await read(env,draftKey)
 if(!draft||typeof revision!=='string'||draft.config.revision!==revision)return fail(409,'草稿已变化，请刷新后重试')
 await resolve(env,draft.config,'guess')
 for(const options of Object.values(draft.config.tasks??{}))if(options.source==='site'&&!provider('primary',env.AI_BASE_URL,options.model||env.AI_MODEL,env.AI_API_KEY))fail(400,'本站文字通道未配置完整，无法启用该用途')
 const result=await env.DB.prepare(`INSERT INTO site_settings(k,v,updated_at) SELECT ?,v,? FROM site_settings WHERE k=? AND v=?
  ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated_at=excluded.updated_at`).bind(activeKey,t,draftKey,draft.raw).run()
 if(!result.meta.changes)fail(409,'草稿已变化，请刷新后重试')
 return guessConfigState(env)
}
export async function disableGuessProvider(env:Env){
 await env.DB.prepare('DELETE FROM site_settings WHERE k=?').bind(activeKey).run()
 return guessConfigState(env)
}
