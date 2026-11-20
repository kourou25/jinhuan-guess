import type {Env} from '../env'
import {aiProviders,AI_DEFAULTS,AI_DAILY_MAX} from './config'
import {parseAiBreaker,initialAiCircuit,aiCircuitKey,type AiCircuit} from './breaker'
import {connectionRuntimeState} from './connections'

export function validAiSetting(key:string,value:unknown){
 if(!Object.hasOwn(AI_DEFAULTS,key))return false
 // Configuration only: issuance stays closed until the budgeted voucher flow ships.
 if(key==='ai.voucher.enabled')return value==='off'
 return typeof AI_DEFAULTS[key]==='number'?typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=(key==='ai.daily.max'?AI_DAILY_MAX:100000):value==='on'||value==='off'
}
export async function aiAdminState(env:Env,t:number){
 const channels:AiCircuit[]=['primary','vision','fallback'],circuitKeys=[...channels.map(aiCircuitKey),'ai.breaker']
 const keys=Object.keys(AI_DEFAULTS),day=new Date((t+28800)*1000).toISOString().slice(0,10)
 const [values,counts]=await env.DB.batch<Record<string,unknown>>([
  env.DB.prepare(`SELECT k,v FROM site_settings WHERE k IN (${[...keys,...circuitKeys].map(()=>'?').join(',')})`).bind(...keys,...circuitKeys),
  env.DB.prepare("SELECT scope,n FROM quota_usage WHERE day=? AND key=0 AND scope IN ('ai:*','ai:img','ai:road')").bind(day),
 ])
 const settings={...AI_DEFAULTS},invalid:string[]=[],raw=Object.fromEntries(values.results.map(r=>[String(r.k),String(r.v)]))
 for(const key of keys){
  if(raw[key]===undefined)continue
  const value=typeof AI_DEFAULTS[key]==='number'&&/^\d+$/.test(raw[key])?Number(raw[key]):raw[key]
  if(validAiSetting(key,value))settings[key]=value
  else invalid.push(key)
 }
 const text=aiProviders(env,false),vision=aiProviders(env,true)
 const status=(name:string,providers:ReturnType<typeof aiProviders>)=>{const p=providers.find(p=>p.name===name);return {ready:!!p,model:p?.model??null}}
 const providers={primary:status('primary',text),fallback:status('fallback',text),vision:status('vision',vision)}
 const circuits=Object.fromEntries(channels.map(channel=>{
  const value=raw[aiCircuitKey(channel)],state=value===undefined?initialAiCircuit(raw['ai.breaker'],t):parseAiBreaker(value)
  return [channel,{status:!state?'invalid':state.open_until>t?'open':state.open_until>0?'half_open':'closed',until:state?.open_until??0,fails:state?.fails??0}]
 })) as Record<AiCircuit,{status:string;until:number;fails:number}>
 // Text availability follows either configured text channel. Vision has its own state.
 const candidates=text.map(p=>circuits[p.name]),breaker=candidates.find(s=>s.status==='closed')||candidates.find(s=>s.status==='half_open')||candidates.filter(s=>s.status==='open').sort((a,b)=>a.until-b.until)[0]||circuits.primary
 const usage=Object.fromEntries(counts.results.map(r=>[String(r.scope),Number(r.n)])),used=usage['ai:*']??0
 const task_routes=await connectionRuntimeState(env,t)
 return {settings,invalid,providers,circuits,day,used,usage,breaker,checkedAt:t,task_routes,can_enable:text.length>0||Object.values(task_routes).some(r=>r.ready),available:settings['ai.enabled']==='on'&&text.length>0&&!invalid.length&&breaker.status==='closed'&&used<Number(settings['ai.daily.max'])}
}
