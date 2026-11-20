import type {Env} from '../env'
import {refundCoinPool} from './coin-funding'
import {unseal} from './core'
import {gameStores,gameTables} from './game-store'
import type {NativePacket} from './packets'
import {AI_BOT_ID} from '../ai/images'
import {exhaustedHonorStatements} from './activity-honors'

// Existing minute cron. Partial due indexes bound each branch; no scan of chat history.
export async function expireGuessGames(env:Env,at:number,packetId?:string){
 if(!env.LDC_ENCRYPTION_KEY)return
 for(const store of gameStores){
  const free=store.reward==='none',cache=free?'guess_free_cache':'ldc_question_cache',index=free?'idx_free_guess_due':'idx_ldc_guess_due'
  const unwon=free?'p.winner_id IS NULL':'NOT EXISTS(SELECT 1 FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.recipient_id IS NOT NULL)'
  const incomplete=free?unwon:'(SELECT count(*) FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.recipient_id IS NOT NULL)<p.count'
  // ai_count includes reserved calls. Do not reveal while a judge/hint can still
  // complete or return its unused budget. Stale leases cannot hold a room forever.
  const exhausted=`p.ai_count>=300 AND ${incomplete} AND NOT EXISTS(SELECT 1 FROM ${cache} c WHERE c.packet_id=p.packet_id AND c.state='pending' AND c.budget_reserved=1 AND c.expires_at>unixepoch())`
  const ended=`(p.ends_at<=? OR (${exhausted}))`
  const due=await env.DB.prepare(`SELECT p.*,'${store.reward}' AS reward_type FROM ${store.rounds} p ${packetId?'':`INDEXED BY ${index}`}
   WHERE p.state='open' AND p.mode IN ('guess','clues') AND ${ended} ${packetId?'AND p.packet_id=?':''} ORDER BY p.ends_at,p.packet_id LIMIT 8`).bind(at,...packetId?[packetId]:[]).all<NativePacket>()
  for(const p of due.results){
   try{
    let answer=''
    try{const answers=p.answer_box?JSON.parse(await unseal(env.LDC_ENCRYPTION_KEY,'ldc-answer:'+p.packet_id,p.answer_box)):null
     if(Array.isArray(answers)&&typeof answers[0]==='string')answer=answers[0]
    }catch{console.error('guess_expiry_answer_unavailable',{packet_id:p.packet_id})}
    // A damaged legacy answer must not keep occupying the bounded due queue forever.
    const result=answer?'正确答案：'+answer+'。':'答案数据异常，暂时无法公布。'
    const tables=gameTables(p),reason=p.ends_at<=at?'本轮猜词已到期流局':'本轮 AI 调用已达300次，自动流局'
    const announcement=reason+(p.count>1?'，剩余中奖名额关闭，已锁定的奖励继续发放，未用预留退回。':'，无人猜中。'+(free?'':p.payment_provider==='coin52'?'未发放 D币奖励，预留余额将退回。':'未发放 LDC 奖励。'))+result
    await env.DB.batch([
     ...exhaustedHonorStatements(env.DB,p,`(${exhausted}) AND ${unwon}`,at),
     env.DB.prepare(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
      SELECT p.group_id,p.owner_id,?||'本轮猜测 '||p.guess_count||' 次，提问 '||p.question_count||' 次。',?,?,'ldc_expired',CAST(m.id AS TEXT)
      FROM ${tables.rounds} p JOIN chat_redpacks r ON r.id=p.packet_id JOIN chat_messages m ON m.id=r.message_id
      WHERE p.packet_id=? AND p.state='open' AND ${ended} AND m.deleted=0 AND ${incomplete}`).bind(announcement,at,at,p.packet_id,at),
     env.DB.prepare(`UPDATE ${tables.rounds} AS p SET state='closed',room_revision=room_revision+1 WHERE packet_id=? AND state='open' AND ${ended}`).bind(p.packet_id,at),
     env.DB.prepare('UPDATE chat_messages SET updated_at=MAX(updated_at,?) WHERE id=(SELECT message_id FROM chat_redpacks WHERE id=?)').bind(at,p.packet_id),
     env.DB.prepare(`UPDATE guess_room_messages SET ai_text=?,ai_score=NULL,ai_status='done',updated_at=? WHERE packet_id=? AND ai_status='pending'
      AND EXISTS(SELECT 1 FROM ${tables.rounds} p WHERE p.packet_id=guess_room_messages.packet_id AND p.state='closed')`).bind(reason+(answer?'，答案已在群内公布。':'，答案数据异常，暂时无法公布。'),at,p.packet_id),
     env.DB.prepare(`UPDATE chat_boosts SET text='本轮已结束。',ai_score=NULL,ai_status='done',created_at=? WHERE user_id=? AND ai_status='pending'
      AND message_id IN (SELECT q.source_message_id FROM ${tables.questions} q JOIN ${tables.rounds} p ON p.packet_id=q.packet_id WHERE q.packet_id=? AND p.state='closed')`).bind(at,AI_BOT_ID,p.packet_id),
    ])
    if(p.payment_provider==='coin52')await refundCoinPool(env.DB,p.packet_id,at)
   }catch{console.error('guess_expiry_failed',{packet_id:p.packet_id})}
  }
 }
}
