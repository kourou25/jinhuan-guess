export type AiCircuit='primary'|'vision'|'fallback'|'guess'|'guess-test'|`connection.${string}`|`connection-test.${string}`
type Breaker={fails:number;since:number;open_until:number;epoch:number;probe:string|null;probe_until:number;backoff?:number}
export type AiPermit={epoch:number;probe:string|null;scope?:AiCircuit;backoff?:number}
const initial:Breaker={fails:0,since:0,open_until:0,epoch:0,probe:null,probe_until:0,backoff:0}
export const aiCircuitKey=(scope?:AiCircuit)=>scope?`ai.breaker.${scope}`:'ai.breaker'
export function parseAiBreaker(value:string):Breaker|null{
 let state:Breaker;try{state=JSON.parse(value)}catch{return null}
 if(!state||typeof state!=='object'||![state.fails,state.since,state.open_until,state.epoch,state.probe_until].every(n=>Number.isSafeInteger(n)&&n>=0)||state.probe!==null&&typeof state.probe!=='string')return null
 if(state.backoff!==undefined&&(!Number.isSafeInteger(state.backoff)||state.backoff<0||state.backoff>300))return null
 return state
}
export function initialAiCircuit(legacy:string|undefined,t:number):Breaker|null{
 if(legacy===undefined)return initial
 const state=parseAiBreaker(legacy);if(!state)return null
 // The old shared circuit cannot identify the failing channel. Probe once per
 // channel on upgrade, without inheriting its 30-minute global suspension.
 return state.open_until>0?{...initial,fails:5,since:t,open_until:t,epoch:state.epoch+1,backoff:30}:initial
}
export async function acquireAiPermit(db:D1Database,t:number,scope?:AiCircuit):Promise<AiPermit|null>{
 const key=aiCircuitKey(scope)
 const rows=await db.prepare('SELECT k,v FROM site_settings WHERE k IN (?,?)').bind(key,'ai.breaker').all<{k:string;v:string}>()
 let row=rows.results.find(r=>r.k===key)
 if(!row){
  const seed=scope&&['primary','vision','fallback'].includes(scope)?initialAiCircuit(rows.results.find(r=>r.k==='ai.breaker')?.v,t):initial
  await db.prepare('INSERT OR IGNORE INTO site_settings(k,v,updated_at) VALUES(?,?,?)').bind(key,JSON.stringify(seed),t).run()
  row=await db.prepare('SELECT k,v FROM site_settings WHERE k=?').bind(key).first<{k:string;v:string}>()??undefined
 }
 const state=parseAiBreaker(row?.v??'null');if(!state)return null
 if(state.open_until>t)return null
 if(state.open_until===0)return {epoch:state.epoch,probe:null,scope}
 const probe=crypto.randomUUID()
 const result=await db.prepare(`UPDATE site_settings SET v=json_set(v,'$.probe',?,'$.probe_until',?),updated_at=?
  WHERE k=? AND json_extract(v,'$.epoch')=? AND json_extract(v,'$.open_until')>0
  AND json_extract(v,'$.open_until')<=? AND json_extract(v,'$.probe_until')<=?`).bind(probe,t+65,t,key,state.epoch,t,t).run()
 return result.meta.changes?{epoch:state.epoch,probe,scope,backoff:state.backoff||30}:null
}
// 按完成顺序记录连续失败；epoch 防止旧请求的迟到成功把新熔断状态清掉。
export async function settleAiPermit(db:D1Database,permit:AiPermit,t:number,outcome:'success'|'failure'|'neutral'){
 if(permit.probe){
  if(outcome==='neutral'){await releaseAiPermit(db,permit,t);return false}
  const failed=outcome==='failure'
  const backoff=failed?Math.min(300,(permit.backoff||30)*2):0
  const result=await db.prepare(`UPDATE site_settings SET v=json_object('fails',?,'since',?,'open_until',?,'epoch',?,'probe',NULL,'probe_until',0,'backoff',?),updated_at=?
   WHERE k=? AND json_extract(v,'$.epoch')=? AND json_extract(v,'$.probe')=?`).bind(failed?5:0,failed?t:0,failed?t+backoff:0,permit.epoch+1,backoff,t,aiCircuitKey(permit.scope),permit.epoch,permit.probe).run()
  return failed&&result.meta.changes===1
 }
 if(outcome==='neutral')return false
 const n="CASE WHEN json_extract(v,'$.since')<=?1-600 OR json_extract(v,'$.fails')=0 THEN 1 ELSE json_extract(v,'$.fails')+1 END"
 const sql=outcome==='success'?`json_set(v,'$.fails',0,'$.since',0,'$.backoff',0)`:`json_set(v,'$.fails',${n},'$.since',CASE WHEN json_extract(v,'$.since')<=?1-600 OR json_extract(v,'$.fails')=0 THEN ?1 ELSE json_extract(v,'$.since') END,'$.open_until',CASE WHEN (${n})>=5 THEN ?1+30 ELSE 0 END,'$.backoff',CASE WHEN (${n})>=5 THEN 30 ELSE 0 END,'$.epoch',CASE WHEN (${n})>=5 THEN ?2+1 ELSE ?2 END)`
 const result=await db.prepare(`UPDATE site_settings SET v=${sql},updated_at=?1 WHERE k=?3 AND json_extract(v,'$.epoch')=?2 AND json_extract(v,'$.open_until')=0 RETURNING v`).bind(t,permit.epoch,aiCircuitKey(permit.scope)).first<{v:string}>()
 return result?JSON.parse(result.v).open_until>t:false
}
export async function recordAiAlert(db:D1Database,t:number,reason:'cap'|'breaker'|'configuration'){
 const day=new Date((t+28800)*1000).toISOString().slice(0,10)
 await db.prepare('INSERT OR IGNORE INTO site_settings(k,v,updated_at) VALUES(?,?,?)').bind(`ai.alert.${day}.${reason}`,JSON.stringify({reason,at:t}),t).run()
}
export async function releaseAiPermit(db:D1Database,permit:AiPermit,t:number){
 if(!permit.probe)return
 await db.prepare(`UPDATE site_settings SET v=json_set(v,'$.probe',NULL,'$.probe_until',0),updated_at=?
  WHERE k=? AND json_extract(v,'$.epoch')=? AND json_extract(v,'$.probe')=?`).bind(t,aiCircuitKey(permit.scope),permit.epoch,permit.probe).run()
}

// 站长确认上游已修复时，只提前开放一次半开探测；实际请求仍走单探针、配额与失败退避。
export async function allowEarlyAiProbe(db:D1Database,t:number,scope:AiCircuit):Promise<'ready'|'not_open'|'invalid'|'busy'|'rate'>{
 const key=aiCircuitKey(scope),row=await db.prepare('SELECT v FROM site_settings WHERE k=?').bind(key).first<{v:string}>()
 const state=parseAiBreaker(row?.v??'null')
 if(!state)return 'invalid'
 if(state.open_until<=t)return 'not_open'
 if(state.probe_until>t)return 'busy'
 const throttle=await db.prepare(`INSERT INTO site_settings(k,v,updated_at) VALUES(?,?,?)
  ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated_at=excluded.updated_at
  WHERE site_settings.updated_at<=excluded.updated_at-60 RETURNING v`).bind('ai.breaker.manual_probe',String(t),t).first()
 if(!throttle)return 'rate'
 const result=await db.prepare(`UPDATE site_settings SET v=json_set(v,'$.open_until',?,'$.probe',NULL,'$.probe_until',0),updated_at=?
  WHERE k=? AND json_extract(v,'$.epoch')=? AND json_extract(v,'$.open_until')>?
  AND json_extract(v,'$.probe_until')<=?`).bind(t,t,key,state.epoch,t,t).run()
 return result.meta.changes?'ready':'busy'
}
