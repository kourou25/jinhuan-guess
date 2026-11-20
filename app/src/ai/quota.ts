import {AI_JOB_LEASE_SECONDS,validAiJobIdentity,type AiJobIdentity} from './jobs'
import {AI_DAILY_MAX} from './config'
export type AiFeature='img'|'summary'|'assistant'|'road'|'report'|'test'
type Claim={scope:string;key:number;limit?:number}
export type AiQuotaReceipt={hash:string}
type Attempt={feature:AiFeature;uid:number;t:number;first:boolean;personalMax?:number;featureMax?:number;globalMax:number;job?:AiJobIdentity}
const features=new Set<AiFeature>(['img','summary','assistant','road','report','test'])
const validLimit=(value:number)=>Number.isSafeInteger(value)&&value>=0&&value<=100000

// 个人只统计逻辑操作，不限次数；功能额度按逻辑操作计，ai:* 按真实上游请求计。
// 同一 batch 先写随机收据，再有条件写全部计数，任一上限不足则所有计数都不变。
// 备用请求即使只扣全站次数也保留账号归属，使合并资格与退休ID守卫覆盖它。
// uid=0 的系统收据用NULL外加显式payload.uid=0，区别于旧版未知归属收据。
export async function reserveAiAttempt(db:D1Database,input:Attempt):Promise<AiQuotaReceipt|null>{
 const {feature,uid,t,first}=input
 if(!features.has(feature)||!Number.isSafeInteger(uid)||!Number.isSafeInteger(t)||t<0||t>253402271999||typeof first!=='boolean')throw new Error('invalid_ai_quota_input')
 if(!validLimit(input.globalMax))throw new Error('invalid_ai_quota_limit')
 for(const value of [input.globalMax,input.personalMax,input.featureMax])if(value!==undefined&&!validLimit(value))throw new Error('invalid_ai_quota_limit')
 if(input.job&&(!validAiJobIdentity(input.job)||uid<=0||!['img','road'].includes(feature)||feature==='img'&&input.featureMax===undefined))throw new Error('invalid_ai_quota_job')
 const day=new Date((t+28800)*1000).toISOString().slice(0,10)
 const claims:Claim[]=[{scope:'ai:*',key:0,limit:Math.min(input.globalMax,AI_DAILY_MAX)}]
 if((first||input.job)&&uid!==0)claims.push({scope:feature==='road'?'ai:road_review':`ai:${feature}`,key:uid})
 // ai:road 是公开回复条数，不能在模型调用时消费；由评论发布事务单独核算。
 if((first||input.job)&&feature==='img'&&input.featureMax!==undefined)claims.push({scope:'ai:img',key:0,limit:input.featureMax})
 if(input.job)return reserveJobAttempt(db,input,day,claims)
 if(claims.some(c=>c.limit===0))return null
 const hash='ai-quota:'+crypto.randomUUID()
 const limited=claims.filter(c=>c.limit!==undefined)
 const gates=limited.map(()=>"COALESCE((SELECT n FROM quota_usage WHERE day=? AND scope=? AND key=?),0)<?").join(' AND ')
 const result=await db.batch([
  db.prepare(`INSERT INTO auth_tokens(token_hash,kind,user_id,payload,expires_at,created_at)
   SELECT ?,'ai-quota',?,?,?,? WHERE ${gates}`).bind(hash,uid||null,JSON.stringify({uid,day,claims}),t+300,t,...limited.flatMap(c=>[day,c.scope,c.key,c.limit!])),
  ...claims.map(c=>db.prepare(`INSERT INTO quota_usage(day,scope,key,n) SELECT ?,?,?,1 WHERE EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=?)
   ON CONFLICT(day,scope,key) DO UPDATE SET n=n+1`).bind(day,c.scope,c.key,hash)),
 ])
 return result[0].meta.changes===1?{hash}:null
}

async function reserveJobAttempt(db:D1Database,input:Attempt,day:string,claims:Claim[]):Promise<AiQuotaReceipt|null>{
 const job=input.job!,hash='ai-quota:'+crypto.randomUUID(),t=input.t
 const gate=()=>'COALESCE((SELECT n FROM quota_usage WHERE day=? AND scope=? AND key=?),0)<?'
 const limited=claims.filter(c=>c.limit!==undefined),logical=limited.slice(1),logicalGates=logical.length?logical.map(gate).join(' AND '):'1'
 const full=JSON.stringify({uid:input.uid,day,claims,job,logical:true}),retry=JSON.stringify({uid:input.uid,day,claims:claims.slice(0,1),job,logical:false})
 const result=await db.batch([
  db.prepare(`INSERT INTO auth_tokens(token_hash,kind,user_id,payload,expires_at,created_at)
   SELECT ?,'ai-quota',j.user_id,CASE WHEN j.logical_day IS NULL THEN ? ELSE ? END,?,? FROM ai_jobs j
   WHERE j.id=? AND j.lease_token=? AND j.state='running' AND j.locked_at>? AND j.locked_at<=? AND j.user_id=? AND j.kind=?
   AND (j.logical_day IS NULL OR j.logical_committed=1) AND ${gate()}
   AND (j.logical_day IS NOT NULL OR (${logicalGates}))`).bind(hash,full,retry,t+300,t,job.id,job.lease,t-AI_JOB_LEASE_SECONDS,t,input.uid,input.feature==='img'?'img_reply':'road_review',...limited.flatMap(c=>[day,c.scope,c.key,c.limit!])),
  ...claims.map((c,i)=>db.prepare(`INSERT INTO quota_usage(day,scope,key,n) SELECT ?,?,?,1
   WHERE EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=? ${i?'AND json_extract(payload,\'$.logical\')=1':''})
   ON CONFLICT(day,scope,key) DO UPDATE SET n=n+1`).bind(day,c.scope,c.key,hash)),
  db.prepare(`UPDATE ai_jobs SET logical_day=?,logical_receipt=?,logical_committed=0 WHERE id=? AND logical_day IS NULL
   AND EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=?)`).bind(day,hash,job.id,hash),
 ])
 return result[0].meta.changes===1?{hash}:null
}

// 收据中的任务身份仅由服务端生成。查数据库而非相信调用者提供的 first 或内存布尔值。
const liveJobReceipt=`(json_type(payload,'$.job') IS NULL OR EXISTS(SELECT 1 FROM ai_jobs j
 WHERE j.id=json_extract(payload,'$.job.id') AND j.lease_token=json_extract(payload,'$.job.lease')
 AND j.state='running' AND j.locked_at>? AND j.locked_at<=?))`

// 网关在 fetch 前立即标记。只有未发送的收据能退款；已发请求无论结果均计费。
export async function markAiAttemptSent(db:D1Database,receipt:AiQuotaReceipt,t:number){
 const result=await db.batch([
  db.prepare(`UPDATE auth_tokens SET used_at=? WHERE token_hash=? AND kind='ai-quota' AND used_at IS NULL AND expires_at>? AND ${liveJobReceipt}`).bind(t,receipt.hash,t,t-AI_JOB_LEASE_SECONDS,t),
  db.prepare(`UPDATE ai_jobs SET logical_committed=1 WHERE logical_receipt=? AND logical_committed=0
   AND id=(SELECT json_extract(payload,'$.job.id') FROM auth_tokens WHERE token_hash=? AND used_at=? AND claim_id IS NULL)`).bind(receipt.hash,receipt.hash,t),
 ])
 return result[0].meta.changes===1
}

export async function refundAiAttempt(db:D1Database,receipt:AiQuotaReceipt,t=Math.floor(Date.now()/1000)){
 const row=await db.prepare("SELECT payload FROM auth_tokens WHERE token_hash=? AND kind='ai-quota' AND used_at IS NULL AND expires_at>?").bind(receipt.hash,t).first<{payload:string}>()
 if(!row)return false
 const {day,claims}=JSON.parse(row.payload) as {day:string;claims:Claim[]}
 const claim=crypto.randomUUID()
 const result=await db.batch([
  db.prepare(`UPDATE auth_tokens SET used_at=?,claim_id=? WHERE token_hash=? AND kind='ai-quota' AND used_at IS NULL AND expires_at>? AND ${liveJobReceipt}
   AND (json_extract(payload,'$.logical') IS NOT 1 OR EXISTS(SELECT 1 FROM ai_jobs WHERE id=json_extract(payload,'$.job.id') AND logical_receipt=? AND logical_committed=0))`).bind(t,claim,receipt.hash,t,t-AI_JOB_LEASE_SECONDS,t,receipt.hash),
  ...claims.map(c=>db.prepare(`UPDATE quota_usage SET n=MAX(0,n-1) WHERE day=? AND scope=? AND key=?
   AND EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=? AND claim_id=?)`).bind(day,c.scope,c.key,receipt.hash,claim)),
  db.prepare(`UPDATE ai_jobs SET logical_day=NULL,logical_receipt=NULL,logical_committed=0 WHERE logical_receipt=? AND logical_committed=0
   AND id=(SELECT json_extract(payload,'$.job.id') FROM auth_tokens WHERE token_hash=? AND claim_id=?)`).bind(receipt.hash,receipt.hash,claim),
  db.prepare('DELETE FROM auth_tokens WHERE token_hash=? AND claim_id=?').bind(receipt.hash,claim),
 ])
 return result[0].meta.changes===1
}
