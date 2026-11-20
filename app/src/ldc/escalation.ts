import type {Env} from '../env'
import type {C} from '../types'
import {fail} from '../lib/http'
import {now} from '../lib/time'
import {rewardCents} from './core'
import {gameStores} from './game-store'

export async function authorPolicy(env:Env,uid:number){
 const p=await env.DB.prepare('SELECT bad_streak,good_streak,restricted FROM guess_author_policies WHERE owner_id=?').bind(uid).first<{bad_streak:number;good_streak:number;restricted:number}>()
 return {restricted:false,bad_streak:p?.bad_streak||0,good_streak:p?.good_streak||0}
}
export async function escalationOptions(c:C,b:Record<string,unknown>,uid:number,total:number){
 const every=b.escalation_every??0
 if(typeof every!=='number'||!Number.isInteger(every)||every<0||every>300)fail(400,'追加奖励间隔需为1–300次，0为关闭')
 const coin=b.payment_provider==='coin52',limit=coin?2000000:200000,unit=coin?'D币':'LDC'
 let step=0,cap=0
 if(every){
  if(b.provider==='free_guess'||!['guess','clues'].includes(String(b.mode)))fail(400,'追加奖励仅用于有奖励的猜词')
  try{step=rewardCents(b.escalation_amount,b.payment_provider);cap=rewardCents(b.escalation_cap,b.payment_provider)}catch(e){fail(400,(e as Error).message)}
  if(cap<step||total+cap>limit)fail(400,`累计追加上限不能低于单次追加，初始奖励加上限不能超过${limit/100} ${unit}`)
 }
 return {every,step,cap}
}
// 预算预占尚未完成时不确认额外奖励；已结束的失败调用仍按页面AI总次数计入。
const settledCount=(cache:string,free=false)=>`MAX(0,${free?'p.ai_count':'MIN(p.ai_count,COALESCE(p.reward_freeze_ai_count,p.ai_count))'}-(SELECT COUNT(*) FROM ${cache} c WHERE c.packet_id=p.packet_id AND c.state='pending' AND c.budget_reserved=1 AND c.expires_at>unixepoch()))`
const noPending=(cache:string)=>`NOT EXISTS(SELECT 1 FROM ${cache} c WHERE c.packet_id=p.packet_id AND c.state='pending' AND c.budget_reserved=1 AND c.expires_at>unixepoch())`
const wonUnsent=`EXISTS(SELECT 1 FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.state='reserved' AND a.attempts=0 AND a.sent_at IS NULL)`
export async function settleGuessProgress(env:Env,id:string,reward:'ldc'|'none'='ldc'){
 const db=env.DB,free=reward==='none',table=free?'guess_free_rounds':'ldc_packets',cache=free?'guess_free_cache':'ldc_question_cache',store=gameStores[free?1:0],count=settledCount(cache,free),at=now()
 const statements=[db.prepare(`UPDATE ${table} AS p SET hundred_reached=1 WHERE packet_id=? AND author_rule_version=1 AND hundred_reached=0 AND ${count}>=100`).bind(id)]
 if(!free){
  const desired=`MIN(p.escalation_cap_cents,CAST(${count}/p.escalation_every AS INTEGER)*p.escalation_step_cents)`
  statements.push(db.prepare(`UPDATE ldc_packets AS p SET added_reward_cents=${desired},total_cents=base_total_cents+${desired},room_revision=room_revision+1
   WHERE packet_id=? AND escalation_every>0 AND reward_finalized=0 AND added_reward_cents<${desired}
   AND ((${store.open}) OR (${wonUnsent} AND ${noPending(cache)}))
   AND NOT EXISTS(SELECT 1 FROM ldc_awards a WHERE a.packet_id=p.packet_id AND (a.attempts>0 OR a.sent_at IS NOT NULL))`).bind(id,at))
  statements.push(db.prepare(`UPDATE ldc_packets AS p SET reward_finalized=1 WHERE packet_id=? AND escalation_every>0 AND reward_finalized=0 AND ${wonUnsent} AND ${noPending(cache)}`).bind(id))
 }
 await db.batch(statements)
}
export async function finalizeEscalation(env:Env,id:string){
 await settleGuessProgress(env,id)
 return !!(await env.DB.prepare('SELECT reward_finalized FROM ldc_packets WHERE packet_id=?').bind(id).first<{reward_finalized:number}>())?.reward_finalized
}
export async function settleAuthorRounds(env:Env,uid?:number){
 const db=env.DB,at=now(),rows:{packet_id:string;owner_id:number;hundred_reached:number;early_win:number;created_at:number}[]=[]
 for(const store of gameStores){
  const free=store.reward==='none',won=free?'p.winner_id IS NOT NULL':"EXISTS(SELECT 1 FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.recipient_id IS NOT NULL AND a.purpose='winner')"
  const cache=free?'guess_free_cache':'ldc_question_cache'
  const current=await db.prepare(`SELECT p.packet_id,p.owner_id,MAX(p.hundred_reached,CASE WHEN p.ai_count>=100 THEN 1 ELSE 0 END) AS hundred_reached,p.created_at,CASE WHEN (${won}) AND p.hundred_reached=0 AND p.ai_count<100 THEN 1 ELSE 0 END AS early_win
   FROM ${store.rounds} p WHERE p.author_rule_version=1 AND p.author_result_saved=0 ${uid===undefined?'':'AND p.owner_id=?'}
   AND ${noPending(cache)} AND (p.state<>'open' OR p.ends_at<=? OR ${won}) ORDER BY p.created_at,p.packet_id LIMIT 20`).bind(...uid===undefined?[]:[uid],at).all<typeof rows[number]>()
  rows.push(...current.results)
 }
 rows.sort((a,b)=>a.created_at-b.created_at||a.packet_id.localeCompare(b.packet_id))
 if(rows.length)await db.batch(rows.map(p=>db.prepare('INSERT OR IGNORE INTO guess_author_results(packet_id,owner_id,hundred_reached,early_win,created_at) VALUES(?,?,?,?,?)').bind(p.packet_id,p.owner_id,p.hundred_reached,p.early_win,at)))
}
export async function runGuessEscalation(env:Env){
 for(const store of gameStores){
  const rows=await env.DB.prepare(`SELECT p.packet_id FROM ${store.rounds} p WHERE p.author_rule_version=1 AND ${store.open} AND p.mode IN('guess','clues') AND p.ai_count>0 AND (p.hundred_reached=0${store.reward==='ldc'?' OR p.escalation_every>0 AND p.added_reward_cents<p.escalation_cap_cents':''}) ORDER BY p.ends_at LIMIT 20`).bind(now()).all<{packet_id:string}>()
  for(const p of rows.results)await settleGuessProgress(env,p.packet_id,store.reward)
 }
 await settleAuthorRounds(env)
}
