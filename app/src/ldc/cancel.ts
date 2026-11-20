import {guessMembersSql,guessBansSql} from '../services/guess-access'
import {refundCoinPool} from './coin-funding'
import type {C,User} from '../types'
import {ready,type NativePacket} from './packets'
import {sourceTable,type AiSource} from '../ai/chat-boost'
import {AI_BOT_ID} from '../ai/images'
import {fail} from '../lib/http'
import {now} from '../lib/time'
import {gameTables} from './game-store'
import {unseal,money} from './core'
import {settleGuessProgress} from './escalation'
import {closeEligible,closeUnclaimed,closeNoPending,highAnswer,closeCandidates,compensationShares} from './cancel-policy'
import {Context} from 'hono'
import type {Ctx} from '../types'
import type {Env} from '../env'
const majority=`(SELECT count(*) FROM guess_close_electors e WHERE e.packet_id=p.packet_id AND choice=1)>(SELECT count(*) FROM guess_close_electors e WHERE e.packet_id=p.packet_id)/2`
const ownerAllowed=`EXISTS(SELECT 1 FROM users u JOIN ${guessMembersSql} m ON m.user_id=u.id AND m.group_id=p.group_id WHERE u.id=p.owner_id AND u.disabled=0 AND u.silenced=0 AND u.kind='user'
 AND NOT EXISTS(SELECT 1 FROM ${guessBansSql} b WHERE b.group_id=p.group_id AND b.user_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM account_retirements a WHERE a.source_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM user_limits l WHERE l.user_id=u.id AND u.is_admin=0 AND l.kind='chat' AND (l.until=0 OR l.until>unixepoch())))`
async function freshGame(c:C,p:NativePacket){const r=await c.env.DB.prepare(`SELECT * FROM ${gameTables(p).rounds} WHERE packet_id=?`).bind(p.packet_id).first<NativePacket>();if(!r)fail(404,'本轮不存在');return {...r!,reward_type:p.reward_type}}
export async function closeVoteView(c:C,p:NativePacket,uid:number){
 const row=await c.env.DB.prepare(`SELECT v.*,(SELECT count(*) FROM guess_close_electors WHERE packet_id=v.packet_id) voters,
 (SELECT count(*) FROM guess_close_electors WHERE packet_id=v.packet_id AND choice=1) yes,
 (SELECT count(*) FROM guess_close_electors WHERE packet_id=v.packet_id AND choice=0) no,
 (SELECT choice FROM guess_close_electors WHERE packet_id=v.packet_id AND user_id=?2) choice,
 EXISTS(SELECT 1 FROM guess_close_electors WHERE packet_id=v.packet_id AND user_id=?2) eligible
 FROM guess_close_votes v WHERE packet_id=?1`).bind(p.packet_id,uid).first<{status:string;ends_at:number;voters:number;yes:number;no:number;choice:number|null;eligible:number}>()
 if(!row)return null
 const unclaimed=p.reward_type==='none'?!p.winner_id:!await c.env.DB.prepare('SELECT 1 FROM ldc_awards WHERE packet_id=? AND recipient_id IS NOT NULL LIMIT 1').bind(p.packet_id).first()
 return {...row,status:row.status!=='open'?row.status:p.state!=='open'||!unclaimed?'superseded':row.ends_at<=now()?'expired':'open',needed:Math.floor(row.voters/2)+1,eligible:!!row.eligible}
}
export async function cancelPreview(c:C,p:NativePacket,u:User){
 if(u.id!==p.owner_id)fail(403,'仅出题人可管理流局')
 p=await freshGame(c,p)
 const flags=await c.env.DB.prepare(`SELECT p.*,${closeUnclaimed(p)} unclaimed,${closeNoPending(p)} settled,${highAnswer(p)} high FROM ${gameTables(p).rounds} p WHERE packet_id=?`).bind(p.packet_id).first<NativePacket&{room_revision:number;unclaimed:number;settled:number;high:number}>()
 p={...flags!,reward_type:p.reward_type}
 const candidates=p.reward_type==='none'?[]:await closeCandidates(c.env.DB,p),amounts=compensationShares(p.total_cents,p.payment_provider==='coin52'?100:1,candidates.length)
 return {revision:flags!.room_revision,available:!!flags!.unclaimed&&p.state==='open'&&p.ends_at>now(),pending:!flags!.settled,needs_vote:!!flags!.high,vote:await closeVoteView(c,p,u.id),currency:p.payment_provider==='coin52'?'D币':'LDC',force_available:p.reward_type!=='none'&&candidates.length>0&&amounts.some(Boolean),total:money(p.total_cents||0),compensation:money(amounts.reduce((a,b)=>a+b,0)),recipients:candidates.map((r,i)=>({name:r.name,user_id:r.user_id,question:r.question,score:r.score,amount:money(amounts[i])}))}
}
async function finishClose(c:C,p:NativePacket,kind:'cancel'|'vote'|'force',revision?:number,source?:AiSource){
 const db=c.env.DB,t=now(),tables=gameTables(p),token=crypto.randomUUID(),free=p.reward_type==='none'
 const answers=p.answer_box?JSON.parse(await unseal(ready(c),'ldc-answer:'+p.packet_id,p.answer_box)) as string[]:[]
 const candidates=kind==='force'?await closeCandidates(db,p):[],amounts=compensationShares(p.total_cents,p.payment_provider==='coin52'?100:1,candidates.length)
 const merged=new Map<number,{id:string;slot:number;amount:number;uid:number;subject:string|null;username:string|null;order:string}>()
 if(kind==='force'){
  if(free||!candidates.length||!amounts.some(Boolean))fail(409,'没有可分配的有效答案，请选择普通流局')
  for(const [i,r] of candidates.entries()){
   if(!amounts[i])continue
   if(p.payment_provider!=='coin52'&&(!r.subject||!/^\d+$/.test(r.subject)||!r.username))fail(409,'补偿对象尚未绑定 Linux.DO，暂不能通过此渠道强制流局')
   const existing=merged.get(r.user_id);if(existing)existing.amount+=amounts[i]
   else{const id=crypto.randomUUID();merged.set(r.user_id,{id,slot:100+i,amount:amounts[i],uid:r.user_id,subject:r.subject,username:r.username,order:'jh-'+id})}
  }
 }
 const authorization=kind==='vote'?`EXISTS(SELECT 1 FROM guess_close_votes v WHERE v.packet_id=p.packet_id AND v.status='open' AND v.ends_at>unixepoch()) AND ${majority}`:kind==='cancel'?`NOT (${highAnswer(p)})`:'p.room_revision=?4'
 const update=db.prepare(`UPDATE ${tables.rounds} AS p SET state='closed',close_kind='${kind}',close_token=?3,room_revision=room_revision+1${free?'':',reward_finalized=1,reward_freeze_ai_count=ai_count'}
 WHERE p.packet_id=?1 AND p.state='open' AND p.ends_at>?2 AND ${closeUnclaimed(p)} AND ${closeNoPending(p)} AND ${ownerAllowed} AND ${authorization}
 AND (${source?.id?`EXISTS(SELECT 1 FROM ${sourceTable(source)} s WHERE s.id=?${kind==='force'?5:4} AND s.body=?${kind==='force'?6:5} AND s.deleted=0 AND s.group_id=p.group_id AND s.user_id=p.owner_id)`:'1'}) RETURNING packet_id`)
 .bind(p.packet_id,t,token,...kind==='force'?[revision!]:[],...source?.id?[source.id,source.body]:[])
 const gate=`EXISTS(SELECT 1 FROM ${tables.rounds} WHERE packet_id=?1 AND close_token=?2)`
 const body=(kind==='force'?`出题人强制结束本轮，${money(amounts.reduce((a,b)=>a+b,0))} ${p.payment_provider==='coin52'?'D币':'LDC'} 分配给高相关答案首答者。补偿不计猜中。`:kind==='vote'?'参与者表决通过，本轮已流局。未发放中奖奖励。':'出题人主动流局，本轮未发放中奖奖励。')+(answers[0]?'\n正确答案：'+answers[0]:'')
 const statements=[update]
 if(kind==='force')statements.push(
  db.prepare(`DELETE FROM ldc_awards WHERE packet_id=?1 AND recipient_id IS NULL AND state='ready' AND ${gate}`).bind(p.packet_id,token),
  db.prepare(`INSERT INTO ldc_awards(id,packet_id,slot,amount_cents,recipient_id,recipient_subject,recipient_username,state,order_no,purpose)
   SELECT json_extract(j.value,'$.id'),?1,json_extract(j.value,'$.slot'),json_extract(j.value,'$.amount'),json_extract(j.value,'$.uid'),json_extract(j.value,'$.subject'),json_extract(j.value,'$.username'),'reserved',json_extract(j.value,'$.order'),'compensation'
   FROM json_each(?3) j WHERE ${gate}`).bind(p.packet_id,token,JSON.stringify([...merged.values()])),
 )
 statements.push(
  db.prepare(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
   SELECT m.group_id,m.user_id,?3,?4,?4,'ldc_cancel',CAST(m.id AS TEXT) FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id WHERE r.id=?1 AND m.deleted=0 AND ${gate}`).bind(p.packet_id,token,body,t),
  db.prepare(`UPDATE guess_close_votes SET status=?3 WHERE packet_id=?1 AND status='open' AND ${gate}`).bind(p.packet_id,token,kind==='vote'?'passed':'superseded'),
 )
 const results=await db.batch(statements)
 if(!results[0].results.length)fail(409,'轮次已变化、奖励已锁定或判题尚未完成，请刷新后操作')
 await finishClosedReplies(c,p,t)
 if(p.payment_provider==='coin52')await refundCoinPool(db,p.packet_id,t)
 return kind==='force'?'本轮已强制流局，补偿进入发放队列，可在领取记录核对。':'本轮已流局，答案已公开。'
}
export async function cancelNativeGame(c:C,p:NativePacket,u:User,source?:AiSource){
 if(u.id!==p.owner_id)fail(403,'仅本轮发起人可以主动流局')
 if(!['guess','clues'].includes(p.mode))fail(400,'只有猜词游戏可以主动流局')
 const tables=gameTables(p),db=c.env.DB;p=await freshGame(c,p)
 if(p.state!=='open'||p.ends_at<=now())fail(409,'本轮已结束')
 const high=await db.prepare(`SELECT 1 FROM ${tables.rounds} p WHERE packet_id=? AND ${highAnswer(p)}`).bind(p.packet_id).first()
 if(!high)return finishClose(c,p,'cancel',undefined,source)
 const t=now()
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO guess_close_votes(packet_id,created_at,ends_at) SELECT packet_id,?2,MIN(ends_at,?2+300) FROM ${tables.rounds} p WHERE packet_id=?1 AND state='open' AND ends_at>?2 AND ${closeUnclaimed(p)} AND ${ownerAllowed}`).bind(p.packet_id,t),
  db.prepare(`INSERT OR IGNORE INTO guess_close_electors(packet_id,user_id) SELECT DISTINCT p.packet_id,q.user_id FROM ${tables.rounds} p JOIN ${tables.questions} q ON q.packet_id=p.packet_id
   WHERE p.packet_id=?1 AND ${closeEligible} AND EXISTS(SELECT 1 FROM guess_close_votes v WHERE v.packet_id=p.packet_id AND v.created_at=?2 AND v.status='open')
   AND NOT EXISTS(SELECT 1 FROM guess_close_electors WHERE packet_id=p.packet_id)`).bind(p.packet_id,t),
  db.prepare('UPDATE chat_messages SET updated_at=? WHERE id=(SELECT message_id FROM chat_redpacks WHERE id=?)').bind(t,p.packet_id),
 ])
 const vote=await closeVoteView(c,p,u.id)
 if(!vote||vote.status!=='open')fail(409,'本轮无法再次发起表决；可继续游戏或使用强制流局')
 return `已发起流局表决：${vote!.voters} 位参与者，需 ${vote!.needed} 票同意，5分钟内有效。请在猜词专区投票。`
}
export async function voteNativeClose(c:C,p:NativePacket,u:User,choice:unknown){
 if(typeof choice!=='boolean')fail(400,'请选择同意或反对')
 if(u.silenced||u.id===p.owner_id)fail(403,'当前账号不能参与本轮表决')
 const tables=gameTables(p),t=now()
 await c.env.DB.prepare(`UPDATE guess_close_electors SET choice=?3,voted_at=?4 WHERE packet_id=?1 AND user_id=?2 AND choice IS NULL
 AND EXISTS(SELECT 1 FROM guess_close_votes v JOIN ${tables.rounds} p ON p.packet_id=v.packet_id WHERE v.packet_id=?1 AND v.status='open' AND v.ends_at>?4 AND p.state='open' AND p.ends_at>?4 AND ${closeUnclaimed(p)})`).bind(p.packet_id,u.id,choice?1:0,t).run()
 const vote=await closeVoteView(c,p,u.id)
 if(!vote?.eligible)fail(403,'仅发起表决时已有有效参与记录的成员可以投票')
 if(vote!.status!=='open')return {vote}
 if(vote!.yes>=vote!.needed){try{await finishClose(c,await freshGame(c,p),'vote')}catch(e){if(!(e instanceof Error)||!e.message.includes('轮次已变化'))throw e}}
 return {vote:await closeVoteView(c,await freshGame(c,p),u.id)}
}
export async function forceNativeClose(c:C,p:NativePacket,u:User,b:Record<string,unknown>){
 if(u.id!==p.owner_id)fail(403,'仅出题人可以强制流局')
 if(b.confirm!==true||!Number.isSafeInteger(b.revision))fail(400,'请先预览补偿金额并明确确认')
 if(!['guess','clues'].includes(p.mode)||p.reward_type==='none')fail(400,'此轮不支持扣奖流局')
 await settleGuessProgress(c.env,p.packet_id)
 return finishClose(c,await freshGame(c,p),'force',Number(b.revision))
}
async function finishClosedReplies(c:C,p:NativePacket,t:number){
 const tables=gameTables(p),db=c.env.DB
 await db.batch([
  db.prepare(`UPDATE chat_boosts SET text='本轮已结束。',ai_score=NULL,ai_status='done',created_at=? WHERE user_id=? AND ai_status='pending' AND message_id IN(SELECT source_message_id FROM ${tables.questions} WHERE packet_id=?)`).bind(t,AI_BOT_ID,p.packet_id),
  db.prepare('UPDATE chat_messages SET updated_at=? WHERE id=(SELECT message_id FROM chat_redpacks WHERE id=?)').bind(t,p.packet_id),
  db.prepare("UPDATE guess_room_messages SET ai_text='本轮已结束。',ai_score=NULL,ai_status='done',updated_at=? WHERE ai_status='pending' AND packet_id=?").bind(t,p.packet_id),
 ])
}
export async function settleCloseVotes(env:Env){
 const c=new Context<Ctx>(new Request('https://close-votes.internal/'),{env})
 for(const table of ['ldc_packets','guess_free_rounds']){
  const rows=await env.DB.prepare(`SELECT p.* FROM guess_close_votes v JOIN ${table} p ON p.packet_id=v.packet_id
   WHERE v.status='open' AND v.ends_at>unixepoch() AND p.state='open' AND ${majority} ORDER BY v.ends_at LIMIT 10`).all<NativePacket>()
  for(const row of rows.results){const p={...row,...table==='guess_free_rounds'?{reward_type:'none' as const}:{}};if(await env.DB.prepare(`SELECT 1 FROM ${table} p WHERE packet_id=? AND ${closeUnclaimed(p)} AND ${closeNoPending(p)}`).bind(p.packet_id).first())await finishClose(c,p,'vote').catch(()=>console.error('guess_close_vote_retry'))}
 }
}
