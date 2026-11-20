import {openAnswerReference,REFERENCE_INSTRUCTION} from './answer-reference'
import type {Env} from '../env'
import type {NativePacket} from './packets'
import {gameTables} from './game-store'
import {unseal} from './core'
import {openJudgeContext} from './author-options'
import {chat,type AiResult} from '../ai/gateway'
import {AiError} from '../ai/errors'
import {AI_BOT_ID} from '../ai/images'
import {REVIEW_PROMPT,parseReviewResult,type ReviewItem,type ReviewDecision} from './review-rules'

type Item=ReviewItem&{packet_id:string;reward_type:'ldc'|'none';cache_key:string;question_id:string;question:string}
type Batch={id:string;packet_id:string;reward_type:'ldc'|'none';lease:string;attempts:number}
const at=()=>Math.floor(Date.now()/1000)
const enabled="COALESCE((SELECT v FROM site_settings WHERE k='ai.guess.review.enabled'),'on')='on'"
export function queueReviewStatements(db:D1Database,p:NativePacket,questionId:string,key:string,lease:string,t:number){
 const tables=gameTables(p),reward=p.reward_type==='none'?'none':'ldc',id=crypto.randomUUID()
 return [
  db.prepare(`INSERT OR IGNORE INTO guess_review_items(packet_id,reward_type,cache_key,question_id,question,kind,original_verdict,original_score,created_at)
   SELECT q.packet_id,?,q.cache_key,q.id,q.question,q.kind,c.verdict,c.score,? FROM ${tables.questions} q JOIN ${tables.cache} c ON c.packet_id=q.packet_id AND c.cache_key=q.cache_key
   WHERE q.id=? AND q.cache_key=? AND c.lease=? AND c.state='done' AND c.verdict IN ('yes','no','unknown','not_question','similarity') AND (c.score IS NULL OR c.score<100) AND ${enabled}`)
   .bind(reward,t,questionId,key,lease),
  db.prepare(`INSERT INTO guess_review_batches(id,packet_id,reward_type,next_at,created_at)
   SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM (SELECT id FROM guess_review_items WHERE packet_id=? AND reward_type=? AND batch_id IS NULL LIMIT 5))=5 AND ${enabled}`)
   .bind(id,p.packet_id,reward,t,t,p.packet_id,reward),
  db.prepare(`UPDATE guess_review_items SET batch_id=? WHERE id IN (SELECT id FROM guess_review_items WHERE packet_id=? AND reward_type=? AND batch_id IS NULL ORDER BY id LIMIT 5)
   AND EXISTS(SELECT 1 FROM guess_review_batches WHERE id=?)`).bind(id,p.packet_id,reward,id),
 ]
}

const resultText=(verdict:string,score:number|null)=>score!==null?`相关度 ${score}%`:({yes:'是。',no:'不是。',unknown:'无法判断，请补充或明确问题。',not_question:'这不是可回答是非的问题。'} as Record<string,string>)[verdict]
export function applyReviewStatements(db:D1Database,batch:Batch,items:Item[],decisions:ReviewDecision[],model:string,t:number){
 const tables=gameTables({reward_type:batch.reward_type} as NativePacket)
 const guard=`EXISTS(SELECT 1 FROM guess_review_batches WHERE id=? AND state='running' AND lease=? AND locked_until>?) AND ${enabled}`
 const statements:D1PreparedStatement[]=[]
 for(const decision of decisions){
  const item=items.find(i=>i.id===decision.id)!
  // Capture stale state before touching the cache. All writes run in one guarded transaction.
  statements.push(db.prepare(`UPDATE guess_review_items SET state=CASE WHEN EXISTS(SELECT 1 FROM ${tables.cache} c WHERE c.packet_id=guess_review_items.packet_id AND c.cache_key=guess_review_items.cache_key AND c.state='done' AND c.verdict=? AND c.score IS ?) THEN ? ELSE 'stale' END,verdict=?,score=?,reviewed_at=? WHERE id=? AND batch_id=? AND state='pending' AND ${guard}`)
   .bind(item.original_verdict,item.original_score,decision.state,decision.verdict,decision.score,t,item.id,batch.id,batch.id,batch.lease,t))
  const applied="EXISTS(SELECT 1 FROM guess_review_items WHERE id=? AND batch_id=? AND state IN ('verified','corrected','uncertain') AND reviewed_at=?)"
  statements.push(db.prepare(`UPDATE ${tables.cache} SET verdict=?,score=? WHERE packet_id=? AND cache_key=? AND state='done' AND verdict=? AND score IS ? AND ${applied} AND ${guard}`)
   .bind(decision.verdict,decision.score,item.packet_id,item.cache_key,item.original_verdict,item.original_score,item.id,batch.id,t,batch.id,batch.lease,t))
  statements.push(db.prepare(`UPDATE ${tables.questions} SET verdict=?,score=? WHERE packet_id=? AND cache_key=? AND ((verdict=? AND score IS ?) OR verdict='pending') AND ${applied} AND ${guard}`)
   .bind(decision.verdict,decision.score,item.packet_id,item.cache_key,item.original_verdict,item.original_score,item.id,batch.id,t,batch.id,batch.lease,t))
  const suffix=decision.state==='corrected'?'GPT 已更正':decision.state==='uncertain'?'GPT 待核实，保留原判定':'GPT 已审核'
  const text=resultText(decision.verdict,decision.score)+' · '+suffix
  // Existing visible receipts only; neither deleted messages nor exact-match winners are recreated.
  const source=(room:boolean)=>`SELECT q.${room?'source_room_id':'source_message_id'} FROM ${tables.questions} q JOIN ${room?'guess_room_messages':'chat_messages'} m ON m.id=q.${room?'source_room_id':'source_message_id'} WHERE q.packet_id=? AND q.cache_key=? AND q.verdict=? AND q.score IS ? AND m.deleted=0 AND m.body=q.source_body AND m.user_id=q.user_id AND ${applied} AND ${guard}`
  const binds=[item.packet_id,item.cache_key,decision.verdict,decision.score,item.id,batch.id,t,batch.id,batch.lease,t]
  statements.push(db.prepare(`UPDATE guess_room_messages SET ai_text=?,ai_score=?,ai_status='done',updated_at=? WHERE ai_status IN ('done','pending') AND id IN (${source(true)})`).bind(text,decision.score,t,...binds))
  statements.push(db.prepare(`UPDATE chat_boosts SET text=?,ai_score=?,ai_status='done',created_at=? WHERE ai_status IN ('done','pending') AND user_id=? AND message_id IN (${source(false)})`).bind(text,decision.score,t,AI_BOT_ID,...binds))
  statements.push(db.prepare(`UPDATE chat_messages SET updated_at=? WHERE id IN (${source(false)})`).bind(t,...binds))
 }
 statements.push(db.prepare(`UPDATE guess_review_batches SET state='done',completed_at=?,model=?,error_code=NULL,locked_until=0 WHERE id=? AND lease=? AND state='running' AND locked_until>? AND ${enabled}`).bind(t,model,batch.id,batch.lease,t))
 statements.push(db.prepare(`UPDATE guess_review_batches SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,error_code='review_disabled_after_response',locked_until=0 WHERE id=? AND lease=? AND state='running' AND NOT (${enabled})`).bind(batch.id,batch.lease))
 return statements
}

export async function claimReviewBatch(db:D1Database,t:number,packetId?:string){
 const lease=crypto.randomUUID()
 await db.prepare("UPDATE guess_review_batches SET state='failed',error_code='lease_expired',locked_until=0 WHERE state='running' AND next_at<=? AND locked_until<=? AND attempts>=3").bind(t,t).run()
 return db.prepare(`UPDATE guess_review_batches SET state='running',lease=?,locked_until=?,attempts=attempts+1
  WHERE id=(SELECT id FROM guess_review_batches WHERE state IN ('pending','running') AND next_at<=? AND locked_until<=? AND attempts<3 ${packetId?'AND packet_id=?':''} ORDER BY next_at,created_at LIMIT 1) AND ${enabled}
  RETURNING id,packet_id,reward_type,lease,attempts`).bind(lease,t+90,t,t,...packetId?[packetId]:[]).first<Batch>()
}

export async function runGuessReviews(env:Env,packetId?:string){
 const db=env.DB,batch=await claimReviewBatch(env.DB,at(),packetId)
 if(!batch)return
 try{
  const items=(await db.prepare('SELECT * FROM guess_review_items WHERE batch_id=? ORDER BY id').bind(batch.id).all<Item>()).results
  if(items.length!==5)throw Error('guess_review_batch_size')
  const tables=gameTables({reward_type:batch.reward_type} as NativePacket)
  const p=await db.prepare(`SELECT answer_box,judge_context_box,answer_reference_box FROM ${tables.rounds} WHERE packet_id=?`).bind(batch.packet_id).first<{answer_box:string;judge_context_box:string|null;answer_reference_box:string|null}>()
  if(!p||!env.LDC_ENCRYPTION_KEY)throw Error('guess_review_source_missing')
  const answers=JSON.parse(await unseal(env.LDC_ENCRYPTION_KEY,'ldc-answer:'+batch.packet_id,p.answer_box)) as string[]
  const context=await openJudgeContext(env.LDC_ENCRYPTION_KEY,batch.packet_id,p.judge_context_box)
  const reference=await openAnswerReference(env.LDC_ENCRYPTION_KEY,batch.packet_id,p.answer_reference_box)
  const result=await chat(env,{feature:'assistant',uid:0,guessReview:true,json:true,temperature:0,maxTokens:1600,timeoutMs:25000,totalTimeoutMs:25000,
   messages:[{role:'system',content:REVIEW_PROMPT+'\n'+REFERENCE_INSTRUCTION},{role:'user',content:JSON.stringify({secret_answers:answers,author_context:context,semantic_reference:reference,items:items.map(i=>({id:i.id,task:i.original_verdict==='similarity'?'similarity':'yesno',question:i.question,original:{verdict:i.original_verdict,score:i.original_score}}))})}]}) as AiResult
  const decisions=parseReviewResult(result.text,items)
  await db.batch(applyReviewStatements(db,batch,items,decisions,result.model,at()))
 }catch(error){
  // No upstream text, answers, or participant identity in logs or public diagnostics.
  const code=error instanceof AiError?error.code:error instanceof SyntaxError?'invalid_json':'review_invalid'
  await db.prepare("UPDATE guess_review_batches SET state=?,next_at=?,locked_until=0,error_code=? WHERE id=? AND lease=? AND state='running'").bind(batch.attempts>=3?'failed':'pending',at()+60*batch.attempts,code,batch.id,batch.lease).run()
  console.warn('guess_review_failed',JSON.stringify({code,attempt:batch.attempts}))
 }
}
