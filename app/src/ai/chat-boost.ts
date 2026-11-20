import {guessMembersSql,guessBansSql} from '../services/guess-access'
import type {C,User} from '../types'
import {now} from '../lib/time'
import {AI_BOT_ID,ensureAiBot} from './images'

export type AiSource={id:number;group_id:number;reply_to:number;body:string;stream?:'guess'}
export const sourceTable=(s?:AiSource)=>s?.stream==='guess'?'guess_room_messages':'chat_messages'
// A message-local receipt prevents duplicate waitUntil/model calls. No extra poller.
export const sourceLive=`m.deleted=0 AND m.body=? AND m.group_id=? AND m.user_id=?
 AND EXISTS(SELECT 1 FROM users u WHERE u.id=m.user_id AND u.disabled=0 AND u.silenced=0 AND u.kind='user')
 AND EXISTS(SELECT 1 FROM chat_members cm WHERE cm.group_id=m.group_id AND cm.user_id=m.user_id)
 AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.group_id=m.group_id AND b.user_id=m.user_id)
 AND NOT EXISTS(SELECT 1 FROM user_limits l JOIN users u ON u.id=l.user_id WHERE l.user_id=m.user_id AND u.is_admin=0 AND l.kind='chat' AND (l.until=0 OR l.until>unixepoch()))
 AND EXISTS(SELECT 1 FROM users WHERE id=${AI_BOT_ID} AND kind='bot' AND disabled=0 AND username='jinhuan_ai')`
const guessSourceLive=sourceLive.replace('chat_members',guessMembersSql).replace('chat_bans',guessBansSql)
export async function beginAiBoost(c:C,s:AiSource,u:User){
 const live=s.stream==='guess'?guessSourceLive:sourceLive
 if(!await ensureAiBot(c.env.DB,now()))return false
 if(s.stream==='guess'){
  const r=await c.env.DB.prepare(`UPDATE guess_room_messages AS m SET ai_text='正在回答…',ai_status='pending',updated_at=? WHERE m.id=? AND m.ai_status IS NULL AND ${live}`)
   .bind(now(),s.id,s.body,s.group_id,u.id).run()
  return r.meta.changes>0
 }
 const r=await c.env.DB.prepare(`INSERT OR IGNORE INTO chat_boosts(message_id,user_id,text,created_at,ai_status)
   SELECT m.id,?,'正在回答…',?,'pending' FROM chat_messages m WHERE m.id=? AND ${live}`)
   .bind(AI_BOT_ID,now(),s.id,s.body,s.group_id,u.id).run()
 return r.meta.changes>0
}
export async function finishAiBoost(c:C,s:AiSource,u:User,text:string,score:number|null=null,status='done'){
 const live=s.stream==='guess'?guessSourceLive:sourceLive
 const db=c.env.DB,t=now()
 if(s.stream==='guess'){
  await db.batch([
   db.prepare(`UPDATE guess_room_messages AS m SET ai_text=?,ai_score=?,ai_status=?,updated_at=? WHERE m.id=? AND ai_status='pending' AND ${live}`).bind(text,score,status,t,s.id,s.body,s.group_id,u.id),
   db.prepare(`UPDATE guess_room_messages AS m SET ai_text=NULL,ai_score=NULL,ai_status=NULL,updated_at=? WHERE m.id=? AND ai_status='pending' AND NOT (${live})`).bind(t,s.id,s.body,s.group_id,u.id),
  ]);return
 }
 await db.batch([
  db.prepare(`UPDATE chat_boosts SET text=?,ai_score=?,ai_status=?,created_at=? WHERE message_id=? AND user_id=? AND ai_status='pending'
   AND EXISTS(SELECT 1 FROM chat_messages m WHERE m.id=? AND ${live})`).bind(text,score,status,t,s.id,AI_BOT_ID,s.id,s.body,s.group_id,u.id),
  db.prepare(`DELETE FROM chat_boosts WHERE message_id=? AND user_id=? AND ai_status='pending'
   AND NOT EXISTS(SELECT 1 FROM chat_messages m WHERE m.id=? AND ${live})`).bind(s.id,AI_BOT_ID,s.id,s.body,s.group_id,u.id),
  db.prepare('UPDATE chat_messages SET updated_at=? WHERE id=? AND deleted=0').bind(t,s.id),
 ])
}
