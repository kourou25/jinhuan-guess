import type {Env} from '../env'
import type {AiFeature} from './quota'
import {AiError} from './errors'
import type {GuessTaskOptions} from './guess-tasks'
import type {AiCircuit} from './breaker'
import {isTypeSafe} from './protocol'
export type AiProvider={name:'primary'|'vision'|'fallback'|'guess'|'guess-test';url:string;model:string;key:string;protocol?:'typesafe';guessOptions?:GuessTaskOptions;circuit?:AiCircuit;connectionId?:string}
export type AiSettings={enabled:boolean;json:boolean;paid:boolean;personalMax:number|undefined;featureMax:number|undefined;globalMax:number}
const features:AiFeature[]=['img','summary','assistant','road','report','test']
export const AI_DAILY_MAX=10000
export const AI_DEFAULTS:Record<string,string|number>={
 'ai.enabled':'off','ai.json_mode':'off','ai.daily.max':AI_DAILY_MAX,'ai.img.daily_max':200,'ai.guess.review.enabled':'on',
 'ai.voucher.enabled':'off','ai.voucher.price':0,'ai.voucher.user_daily_max':0,'ai.voucher.site_daily_max':0,
 ...Object.fromEntries(features.map(feature=>[`ai.${feature}.enabled`,'on'])),
}
export async function aiSettings(db:D1Database,feature:AiFeature):Promise<AiSettings>{
 if(!features.includes(feature))throw new AiError('ai_input',400)
 const keys=['ai.enabled','ai.json_mode','ai.daily.max',`ai.${feature}.enabled`,`ai.${feature}.daily_max`,'plan']
 const rows=await db.prepare(`SELECT k,v FROM site_settings WHERE k IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all<{k:string;v:string}>()
 const values=Object.fromEntries(rows.results.map(r=>[r.k,r.v]))
 const number=(key:string,fallback:number|undefined)=>{
  if(values[key]===undefined)return fallback
  const n=Number(values[key]);if(!/^\d+$/.test(values[key])||!Number.isSafeInteger(n)||n>100000)throw new AiError('ai_disabled',503)
  return n
 }
 return {enabled:values['ai.enabled']==='on'&&values[`ai.${feature}.enabled`]!=='off',json:values['ai.json_mode']==='on',paid:values.plan==='paid',globalMax:Math.min(number('ai.daily.max',AI_DAILY_MAX)!,AI_DAILY_MAX),personalMax:undefined,featureMax:feature==='img'?number('ai.img.daily_max',Number(AI_DEFAULTS['ai.img.daily_max'])):undefined}
}
export function provider(name:AiProvider['name'],base:string|undefined,model:string|undefined,key:string|undefined):AiProvider|null{
 if(!base||!model||!key)return null
 try{
  const url=new URL(base),host=url.hostname.toLowerCase()
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||host==='localhost'||!host.includes('.')||/^[\d.]+$|:|\.(local|internal|lan)$/.test(host))return null
  if(model.length>100||/[\x00-\x1f\x7f]/.test(model)||!model.trim()||key.length>512||/[^\x21-\x7e]/.test(key))return null
  if(isTypeSafe(base)){
   if(!['','/v1','/v1/systemone'].includes(url.pathname.replace(/\/+$/,'')))return null
   url.pathname='/v1/systemone'
   return {name,url:url.href,model,key,protocol:'typesafe'}
  }
  url.pathname=url.pathname.replace(/\/+$/,'')+'/chat/completions'
  return {name,url:url.href,model,key}
 }catch{return null}
}
export function aiProviders(env:Env,vision:boolean){
 if(vision){
  const primary=provider('vision',env.AI_VISION_BASE_URL||env.AI_BASE_URL,env.AI_VISION_MODEL,env.AI_VISION_BASE_URL?env.AI_VISION_API_KEY:env.AI_API_KEY)
  return primary?[primary]:[]
 }
 const primary=provider('primary',env.AI_BASE_URL,env.AI_MODEL,env.AI_API_KEY)
 if(!primary)return []
 const fallback=provider('fallback',env.AI_FALLBACK_BASE_URL,env.AI_FALLBACK_MODEL,env.AI_FALLBACK_API_KEY)
 return fallback?[primary,fallback]:[primary]
}
