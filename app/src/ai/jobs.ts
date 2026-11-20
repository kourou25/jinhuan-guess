export type AiJobIdentity={id:number;lease:string}
export type ClaimedAiJob={id:number;kind:'img_reply'|'road_review';target_id:number;user_id:number;state:'running';attempts:number;run_after:number;locked_at:number;lease_token:string;logical_day:string|null;logical_receipt:string|null;logical_committed:number;result:string|null;err:string|null;created_at:number;updated_at:number}
export const AI_JOB_LEASE_SECONDS=600
const time=(t:number)=>{if(!Number.isSafeInteger(t)||t<0||t>253402271999)throw new Error('invalid_ai_job_time')}
export function validAiJobIdentity(job:AiJobIdentity){return !!job&&Number.isSafeInteger(job.id)&&job.id>0&&typeof job.lease==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(job.lease)}

// 一条 UPDATE 原子选取并领取。每次只领一个，执行器可以在领取下一条前检查剩余预算。
export async function claimAiJob(db:D1Database,t:number,kind?:ClaimedAiJob['kind']):Promise<ClaimedAiJob|null>{
 time(t)
 return db.prepare(`UPDATE ai_jobs SET state='running',locked_at=?,lease_token=?,attempts=attempts+1,updated_at=?
  WHERE id=(SELECT id FROM ai_jobs WHERE state='pending' AND run_after<=? AND attempts<4 AND (? IS NULL OR kind=?) ORDER BY run_after,id LIMIT 1)
  AND state='pending' RETURNING *`).bind(t,crypto.randomUUID(),t,t,kind??null,kind??null).first<ClaimedAiJob>()
}

export type AiJobEnd='done'|'pending'|'failed'|'skipped'|'lost'
export type AiJobReason='ineligible'|'filtered'|'gif'|'image'|'fetch'|'size'|'bot_collision'|'ai_disabled'|'ai_off'|'quota'|'ai_busy'|'ai_upstream'|'ai_input'|'internal'
// 正常上游错误最多自动重试三次（5分钟、30分钟、2小时）；中断恢复仍按上面的三次领取阈值终止。
export async function settleImageJob(db:D1Database,job:AiJobIdentity,t:number,state:'pending'|'failed'|'skipped',reason:AiJobReason):Promise<AiJobEnd>{
 time(t);if(!validAiJobIdentity(job))throw new Error('invalid_ai_job_identity')
 const row=await db.prepare(`UPDATE ai_jobs SET state=CASE WHEN ?='pending' AND attempts>=4 THEN 'failed' ELSE ? END,
  run_after=CASE WHEN ?='pending' AND attempts<4 THEN ?+CASE attempts WHEN 1 THEN 300 WHEN 2 THEN 1800 ELSE 7200 END ELSE run_after END,
  err=?,updated_at=?,locked_at=NULL,lease_token=NULL,
  logical_committed=CASE WHEN logical_day IS NOT NULL THEN 1 ELSE 0 END
  WHERE id=? AND lease_token=? AND state='running' AND kind='img_reply' AND locked_at>? AND locked_at<=?
  RETURNING state`).bind(state,state,state,t,reason,t,job.id,job.lease,t-AI_JOB_LEASE_SECONDS,t).first<{state:'pending'|'failed'|'skipped'}>()
 return row?.state??'lost'
}

// 断执行不能证明 fetch 是否已经发出。保留预留额度并固化逻辑资格，避免恢复后再次扣个人额度。
// 只标 interrupted，不推断 CPU 故障；每轮最多处理 5 条，第三次领取后再次中断则终止。
export async function recoverAiJobs(db:D1Database,t:number,kind?:ClaimedAiJob['kind']){
 time(t)
 const result=await db.prepare(`UPDATE ai_jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,
  run_after=?+CASE WHEN attempts<2 THEN 300 ELSE 1800 END,locked_at=NULL,lease_token=NULL,
  logical_committed=CASE WHEN logical_day IS NOT NULL THEN 1 ELSE 0 END,err='interrupted',updated_at=?
  WHERE id IN (SELECT id FROM ai_jobs WHERE state='running' AND locked_at<=? AND (? IS NULL OR kind=?) ORDER BY locked_at,id LIMIT 5)
  AND state='running' AND locked_at<=?`).bind(t,t,t-AI_JOB_LEASE_SECONDS,kind??null,kind??null,t-AI_JOB_LEASE_SECONDS).run()
 return result.meta.changes
}
