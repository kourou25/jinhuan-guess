import {guessAdmissionSql,rejectPendingGuess} from './submission-guard'
import {guessMembersSql,guessBansSql} from '../services/guess-access'
import type {C,User} from '../types'
import {now} from '../lib/time'
import {fail} from '../lib/http'
import {unseal} from './core'
import {ready,type NativePacket} from './packets'
import {AI_BOT_ID} from '../ai/images'
import {beginAiBoost,finishAiBoost,sourceTable,type AiSource} from '../ai/chat-boost'
import {SIMILARITY_VERSION} from './similarity'
import {scoreGuess,judgeQuestion} from './scoring'
import {YESNO_VERSION,normalizeYesNoQuestion} from './yesno'
import {AiError,aiFailureText} from '../ai/errors'
import {gameTables} from './game-store'
import {openJudgeContext} from './author-options'
import {openAnswerReference} from './answer-reference'
import {settleGuessProgress} from './escalation'
import {judgeLiteralQuestion} from './substring'
import {queueReviewStatements,runGuessReviews} from './review'
import {expireGuessGames} from './expiry'
export {gameOpen} from './game-store'

export type GameTurn={id:string;packet_id:string;user_id:number;question:string;verdict:string;score:number|null;kind:'question'|'guess';cache_key:string;source_message_id:number;source_room_id:number|null;source_body:string;created:boolean;source:AiSource;guess_number?:number;turn_number?:number}
const normalizedQuestion=(s:string)=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ')
const verdictText=(verdict:string,score:number|null)=>score!==null?`相关度 ${score}%`:
 ({yes:'是。',no:'不是。',unknown:'无法判断，请补充或明确问题。',not_question:'这不是可回答是非的问题，请换成明确的是非提问。',unavailable:'暂时无法回答，仍可在分屏窗口切换“猜答案”参与。',pending:'正在回答…'} as Record<string,string>)[verdict]||'本轮已结束。'

export async function recordGameTurn(c:C,p:NativePacket,u:User,kind:'question'|'guess',text:string,nonce:string,source?:AiSource):Promise<GameTurn>{
 if(p.reward_type!=='none'&&p.count>1&&source?.stream!=='guess')fail(409,'多人猜词请在分屏猜词窗口参与，答案会按本轮规则保密')
 const tables=gameTables(p)
 const version=kind==='guess'&&p.response_mode==='similarity'?SIMILARITY_VERSION:YESNO_VERSION
 // Separate new decisions from pre-policy cache entries without rewriting historical replies.
 const db=c.env.DB,t=now(),qid=crypto.randomUUID(),key=version+':decision2:'+kind+':'+p.response_mode+':'+normalizedQuestion(kind==='question'?normalizeYesNoQuestion(text):text)
 const body=source?.body||(kind==='guess'?'猜：':'问：')+text
 const rows=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO ${tables.questions}(id,packet_id,user_id,nonce,question,created_at,kind,cache_key,source_message_id,source_body,source_room_id)
   SELECT ?1,p.packet_id,?2,?3,?4,?5,?6,?7,?8,?9,?10 FROM ${tables.rounds} p WHERE p.packet_id=?11 AND ${tables.open.replaceAll('?','?5')} AND p.question_count+p.guess_count<5000
   AND EXISTS(SELECT 1 FROM users u JOIN ${guessMembersSql} cm ON cm.user_id=u.id WHERE u.id=?2 AND u.kind='user' AND u.disabled=0 AND u.silenced=0 AND cm.group_id=p.group_id)
   AND NOT EXISTS(SELECT 1 FROM ${guessBansSql} WHERE group_id=p.group_id AND user_id=?2)
   AND NOT EXISTS(SELECT 1 FROM user_limits l JOIN users u ON u.id=l.user_id WHERE l.user_id=?2 AND u.is_admin=0 AND l.kind='chat' AND (l.until=0 OR l.until>?5))
   AND (?12=0 OR EXISTS(SELECT 1 FROM ${sourceTable(source)} m WHERE m.id=?12 AND m.deleted=0 AND m.body=?9 AND m.user_id=?2 AND m.group_id=p.group_id))
   AND ${guessAdmissionSql(tables.questions,'?2','?5','COALESCE(?10,0)')} RETURNING *`)
   .bind(qid,u.id,nonce,text,t,kind,key,source?.stream==='guess'?null:source?.id??null,body,source?.stream==='guess'?source.id:null,p.packet_id,source?.id??0),
  db.prepare(`UPDATE ${tables.rounds} SET question_count=question_count+?,guess_count=guess_count+? WHERE packet_id=? AND EXISTS(SELECT 1 FROM ${tables.questions} WHERE id=?) RETURNING guess_count,question_count`)
   .bind(kind==='question'?1:0,kind==='guess'?1:0,p.packet_id,qid),
  // The old detail API also publishes the question. It never needs last_insert_rowid.
  ...source?[]:[db.prepare(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
   SELECT p.group_id,q.user_id,q.source_body,?,?, 'ldc_question',q.id FROM ${tables.questions} q JOIN ${tables.rounds} p ON p.packet_id=q.packet_id
   WHERE q.id=? AND q.source_message_id IS NULL`).bind(t,t,qid),
  db.prepare(`UPDATE ${tables.questions} SET source_message_id=(SELECT id FROM chat_messages WHERE system_kind='ldc_question' AND system_ref=?) WHERE id=? AND source_message_id IS NULL`).bind(qid,qid)],
 ])
 const row=(rows[0].results[0]||await db.prepare(`SELECT * FROM ${tables.questions} WHERE packet_id=? AND user_id=? AND nonce=?`).bind(p.packet_id,u.id,nonce).first()) as unknown as GameTurn|undefined
 if(!row){await rejectPendingGuess(c,p,u,source?.stream==='guess'?source.id:0);fail(409,'本轮已结束、次数已满或这条消息已处理')}
 if(row!.question!==text||row!.kind!==kind||(source&&(source.stream==='guess'?row!.source_room_id:row!.source_message_id)!==source.id))fail(409,'请求编号已用于另一条问题，请重新提交')
 // The legacy API creates its source message in the same batch after RETURNING.
 if(!source&&rows[0].meta.changes>0)row!.source_message_id=(await db.prepare(`SELECT source_message_id FROM ${tables.questions} WHERE id=?`).bind(row!.id).first<{source_message_id:number}>())!.source_message_id
 const counts=rows[1].results[0] as {guess_count:number;question_count:number}|undefined
 const result={...row!,turn_number:counts?counts.guess_count+counts.question_count:undefined,created:rows[0].meta.changes>0,guess_number:Number((rows[1].results[0] as {guess_count:number}|undefined)?.guess_count)||undefined,source:{id:row!.source_room_id||row!.source_message_id,group_id:p.group_id,reply_to:0,body:row!.source_body,...row!.source_room_id?{stream:'guess' as const}:{}}}
 if(!source&&result.created)await beginAiBoost(c,result.source,u)
 return result
}

export async function finishGameTurn(c:C,p:NativePacket,u:User,turn:GameTurn,text:string,score:number|null,verdict:string,fromCache=false){
 const tables=gameTables(p)
 await settleGuessProgress(c.env,p.packet_id,p.reward_type)
 if(fromCache)await c.env.DB.prepare(`UPDATE ${tables.questions} SET (verdict,score)=(SELECT verdict,score FROM ${tables.cache} WHERE packet_id=? AND cache_key=? AND state='done') WHERE id=? AND verdict='pending'`).bind(p.packet_id,turn.cache_key,turn.id).run()
 else await c.env.DB.prepare(`UPDATE ${tables.questions} SET verdict=?,score=? WHERE id=? AND verdict='pending'`).bind(verdict,score,turn.id).run()
 if(score===100){await finishAiBoost(c,turn.source,u,text,score);return}
 await publishTurns(c,p,turn.cache_key,text,score,turn.id,null,verdict==='unavailable'?'error':'done')
}

// Only already-created receipts are updated. Removed/edited messages cannot be resurrected.
async function publishTurns(c:C,p:NativePacket,key:string,text:string,score:number|null,onlyId:string|null=null,lease:string|null=null,status='done'){
 const tables=gameTables(p)
 const db=c.env.DB,t=now(),active=`EXISTS(SELECT 1 FROM ${tables.rounds} p WHERE p.packet_id=? AND ${tables.open})`
 const sourcesFor=(room=false)=>`SELECT q.${room?'source_room_id':'source_message_id'} FROM ${tables.questions} q JOIN ${room?'guess_room_messages':'chat_messages'} m ON m.id=q.${room?'source_room_id':'source_message_id'}
  JOIN users u ON u.id=q.user_id JOIN ${guessMembersSql} cm ON cm.user_id=q.user_id AND cm.group_id=m.group_id
  WHERE q.packet_id=? AND q.cache_key=? AND (? IS NULL OR q.id=?) AND m.deleted=0 AND m.body=q.source_body AND m.group_id=? AND m.user_id=q.user_id
  AND u.disabled=0 AND u.silenced=0 AND u.kind='user'
  AND NOT EXISTS(SELECT 1 FROM ${guessBansSql} WHERE group_id=m.group_id AND user_id=q.user_id)
  AND NOT EXISTS(SELECT 1 FROM user_limits l WHERE l.user_id=q.user_id AND u.is_admin=0 AND l.kind='chat' AND (l.until=0 OR l.until>unixepoch()))
  AND (? IS NULL OR EXISTS(SELECT 1 FROM ${tables.cache} WHERE packet_id=q.packet_id AND cache_key=q.cache_key AND lease=?))`
 const sources=sourcesFor(),roomSources=sourcesFor(true)
 const reviewed=(room:boolean,field:string)=>`SELECT ${field} FROM guess_review_items r JOIN ${tables.questions} q ON q.packet_id=r.packet_id AND q.cache_key=r.cache_key
  WHERE q.${room?'source_room_id=guess_room_messages.id':'source_message_id=chat_boosts.message_id'} AND r.reward_type='${p.reward_type==='none'?'none':'ldc'}'
  AND r.state IN ('verified','corrected','uncertain') AND q.verdict=r.verdict AND q.score IS r.score LIMIT 1`
 const reviewText="(CASE WHEN r.score IS NOT NULL THEN '相关度 '||r.score||'%' ELSE CASE r.verdict WHEN 'yes' THEN '是。' WHEN 'no' THEN '不是。' WHEN 'unknown' THEN '无法判断，请补充或明确问题。' ELSE '这不是可回答是非的问题。' END END)||' · '||CASE r.state WHEN 'corrected' THEN 'GPT 已更正' WHEN 'uncertain' THEN 'GPT 待核实，保留原判定' ELSE 'GPT 已审核' END"
 await db.batch([
  db.prepare(`UPDATE chat_boosts SET text=CASE WHEN ${active} THEN COALESCE((${reviewed(false,reviewText)}),?) ELSE '本轮已结束。' END,
   ai_score=CASE WHEN ${active} THEN CASE WHEN EXISTS(${reviewed(false,'1')}) THEN (${reviewed(false,'r.score')}) ELSE ? END ELSE NULL END,ai_status=?,created_at=?
   WHERE user_id=? AND ai_status='pending' AND message_id IN (${sources})
   AND EXISTS(SELECT 1 FROM users WHERE id=? AND kind='bot' AND disabled=0 AND username='jinhuan_ai')`)
   .bind(p.packet_id,t,text,p.packet_id,t,score,status,t,AI_BOT_ID,p.packet_id,key,onlyId,onlyId,p.group_id,lease,lease,AI_BOT_ID),
  db.prepare(`DELETE FROM chat_boosts WHERE user_id=? AND ai_status='pending' AND message_id IN
   (SELECT source_message_id FROM ${tables.questions} WHERE packet_id=? AND cache_key=? AND (? IS NULL OR id=?)) AND message_id NOT IN (${sources})`)
   .bind(AI_BOT_ID,p.packet_id,key,onlyId,onlyId,p.packet_id,key,onlyId,onlyId,p.group_id,null,null),
  db.prepare(`UPDATE chat_messages SET updated_at=? WHERE id IN (SELECT source_message_id FROM ${tables.questions} WHERE packet_id=? AND cache_key=? AND (? IS NULL OR id=?)) AND deleted=0`)
   .bind(t,p.packet_id,key,onlyId,onlyId),
  db.prepare(`UPDATE guess_room_messages SET ai_text=CASE WHEN ${active} THEN COALESCE((${reviewed(true,reviewText)}),?) ELSE '本轮已结束。' END,
   ai_score=CASE WHEN ${active} THEN CASE WHEN EXISTS(${reviewed(true,'1')}) THEN (${reviewed(true,'r.score')}) ELSE ? END ELSE NULL END,ai_status=?,updated_at=? WHERE ai_status='pending' AND id IN (${roomSources})
   AND EXISTS(SELECT 1 FROM users WHERE id=? AND kind='bot' AND disabled=0 AND username='jinhuan_ai')`)
   .bind(p.packet_id,t,text,p.packet_id,t,score,status,t,p.packet_id,key,onlyId,onlyId,p.group_id,lease,lease,AI_BOT_ID),
  db.prepare(`UPDATE guess_room_messages SET ai_text=NULL,ai_status=NULL,ai_score=NULL,updated_at=? WHERE ai_status='pending' AND id IN
   (SELECT source_room_id FROM ${tables.questions} WHERE packet_id=? AND cache_key=? AND (? IS NULL OR id=?)) AND id NOT IN (${roomSources})`)
   .bind(t,p.packet_id,key,onlyId,onlyId,p.packet_id,key,onlyId,onlyId,p.group_id,null,null),
 ])
}

export async function answerGameQuestion(c:C,p:NativePacket,u:User,turn:GameTurn){
 const tables=gameTables(p)
 if(turn.verdict!=='pending')return turn.verdict
 if(turn.kind==='question'){
  const answers=JSON.parse(await unseal(ready(c),'ldc-answer:'+p.packet_id,p.answer_box!)) as string[]
  const literal=judgeLiteralQuestion(answers,turn.kind,turn.question)
  if(literal!==null){
   await finishGameTurn(c,p,u,turn,literal.text,null,literal.verdict)
   return literal.verdict
  }
 }
 const db=c.env.DB,t=now(),lease=crypto.randomUUID()
 const reserved=await db.batch([
  db.prepare(`INSERT INTO ${tables.cache}(packet_id,cache_key,lease,expires_at,budget_reserved)
   SELECT p.packet_id,?,?,?,1 FROM ${tables.rounds} p WHERE p.packet_id=? AND ${tables.open} AND p.ai_count<300
   ON CONFLICT(packet_id,cache_key) DO UPDATE SET lease=excluded.lease,expires_at=excluded.expires_at,state='pending',budget_reserved=1
   WHERE ${tables.cache}.state<>'done' AND ${tables.cache}.expires_at<=? RETURNING *`)
   .bind(turn.cache_key,lease,t+30,p.packet_id,t,t),
  db.prepare(`UPDATE ${tables.rounds} SET ai_count=ai_count+1 WHERE packet_id=? AND EXISTS(SELECT 1 FROM ${tables.cache} WHERE packet_id=? AND cache_key=? AND lease=?)`).bind(p.packet_id,p.packet_id,turn.cache_key,lease),
 ])
 const cached=(reserved[0].results[0]||await db.prepare(`SELECT * FROM ${tables.cache} WHERE packet_id=? AND cache_key=?`).bind(p.packet_id,turn.cache_key).first()) as {state:string;verdict:string;score:number|null;lease:string;expires_at:number}|undefined
 if(cached?.state==='done'){
  await finishGameTurn(c,p,u,turn,verdictText(cached.verdict,cached.score),cached.score,cached.verdict,true);return cached.verdict
 }
 if(!reserved[0].results.length){
  if(cached?.state==='pending'&&cached.expires_at>t)return 'pending'
  await finishGameTurn(c,p,u,turn,'本轮最多300次AI调用；用完后等待在途回答结束，随后自动流局并公布答案。',null,'unavailable');return 'unavailable'
 }
 let verdict='unavailable',score:number|null=null,failure:unknown
 try{
  // A member/message/game may change while waiting for the cache lease.
  const live=await db.prepare(`SELECT 1 FROM ${tables.rounds} p JOIN ${tables.questions} q ON q.packet_id=p.packet_id JOIN ${sourceTable(turn.source)} m ON m.id=q.${turn.source.stream==='guess'?'source_room_id':'source_message_id'}
   JOIN users u ON u.id=q.user_id JOIN ${guessMembersSql} cm ON cm.user_id=u.id AND cm.group_id=p.group_id
   WHERE q.id=? AND ${tables.open} AND m.deleted=0 AND m.body=q.source_body AND m.user_id=u.id AND m.group_id=p.group_id AND u.disabled=0 AND u.silenced=0 AND u.kind='user'
   AND NOT EXISTS(SELECT 1 FROM ${guessBansSql} WHERE group_id=p.group_id AND user_id=u.id)
   AND NOT EXISTS(SELECT 1 FROM user_limits l WHERE l.user_id=u.id AND u.is_admin=0 AND l.kind='chat' AND (l.until=0 OR l.until>unixepoch()))`)
   .bind(turn.id,now()).first()
  if(!live)throw Error('game_source_changed')
  const answers=JSON.parse(await unseal(ready(c),'ldc-answer:'+p.packet_id,p.answer_box!)) as string[]
  const context=await openJudgeContext(ready(c),p.packet_id,p.judge_context_box)
  const reference=await openAnswerReference(ready(c),p.packet_id,p.answer_reference_box)
  const similarity=turn.kind==='guess'&&p.response_mode==='similarity'
  if(similarity){score=(await scoreGuess(c.env,u.id,answers,turn.question,undefined,context,reference))?.score??null;verdict=score===null?'unavailable':'similarity'}
  else verdict=await judgeQuestion(c.env,u.id,answers,turn.question,undefined,context,reference)
 }catch(error){verdict='unavailable';failure=error}
 const saved=await db.batch([
  // A quota/circuit rejection never reached the model; do not consume the round budget.
  ...failure instanceof AiError&&failure.attempts===0?[db.prepare(`UPDATE ${tables.rounds} SET ai_count=MAX(0,ai_count-1) WHERE packet_id=? AND EXISTS(SELECT 1 FROM ${tables.cache} WHERE packet_id=? AND cache_key=? AND lease=? AND state='pending' AND expires_at>unixepoch())`).bind(p.packet_id,p.packet_id,turn.cache_key,lease)]:[],
  db.prepare(`UPDATE ${tables.cache} SET budget_reserved=0,state=?,verdict=?,score=?,expires_at=CASE WHEN ?=1 THEN ? ELSE expires_at END WHERE packet_id=? AND cache_key=? AND lease=?`).bind(verdict==='unavailable'?'error':'done',verdict,score,verdict==='unavailable'?1:0,now(),p.packet_id,turn.cache_key,lease),
  db.prepare(`UPDATE ${tables.questions} SET verdict=?,score=? WHERE packet_id=? AND cache_key=? AND verdict='pending'
   AND EXISTS(SELECT 1 FROM ${tables.cache} WHERE packet_id=? AND cache_key=? AND lease=?)`).bind(verdict,score,p.packet_id,turn.cache_key,p.packet_id,turn.cache_key,lease),
  ...verdict!=='unavailable'?queueReviewStatements(db,p,turn.id,turn.cache_key,lease,now()):[],
 ])
 await settleGuessProgress(c.env,p.packet_id,p.reward_type)
 await publishTurns(c,p,turn.cache_key,failure?aiFailureText(failure):verdictText(verdict,score),score,null,lease,verdict==='unavailable'?'error':'done')
 await expireGuessGames(c.env,now(),p.packet_id)
 if(verdict!=='unavailable'&&saved.at(-1)?.meta.changes===5)c.executionCtx.waitUntil(runGuessReviews(c.env,p.packet_id).catch(()=>console.error('guess_review_schedule_failed')))
 return verdict
}

export async function revealGameHint(c:C,p:NativePacket){
 const tables=gameTables(p)
 const hints=(p.hints_box?JSON.parse(await unseal(ready(c),'ldc-hints:'+p.packet_id,p.hints_box)):JSON.parse(p.hints_json)) as string[]
 if(!hints.length)return '题主没有提供阶段线索，可以继续提问或猜答案。'
 const updated=await c.env.DB.prepare(`UPDATE ${tables.rounds} AS p SET hints_revealed=hints_revealed+1,hint_at=? WHERE packet_id=? AND ${tables.open}
  AND hint_at<=? AND hints_revealed<? RETURNING hints_revealed`).bind(now(),p.packet_id,now(),now()-30,hints.length).first<{hints_revealed:number}>()
 if(updated)return `线索 ${updated.hints_revealed}：${hints[updated.hints_revealed-1]}`
 const current=await c.env.DB.prepare(`SELECT hints_revealed,hint_at,(${tables.open}) AS active FROM ${tables.rounds} p WHERE packet_id=?`).bind(now(),p.packet_id).first<{hints_revealed:number;hint_at:number;active:number}>()
 if(!current?.active)return '本轮已结束。'
 if(current.hints_revealed>=hints.length)return '本轮线索已经全部公布。'
 return `线索冷却中，请 ${Math.max(1,current.hint_at+30-now())} 秒后再问。`
}
