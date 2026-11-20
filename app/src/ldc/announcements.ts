import type {C} from '../types'
import {now} from '../lib/time'

type Player={id:number;name:string;avatar:string|null}
type Event={id:number;kind:string;created_at:number;updated_at:number;packet_id:string|null;actor_id:number;name:string;avatar:string|null}

// Use the original event ledger, but never expose its body: result events may contain a sealed round's answer.
export async function guessAnnouncements(c:C,gid:number,joinedAt:number){
 const rows=await c.env.DB.prepare(`SELECT m.id,COALESCE(m.system_kind,'start') AS kind,m.created_at,m.updated_at,
  r.id AS packet_id,u.id AS actor_id,COALESCE(u.nick,u.name,u.username) AS name,u.avatar
  FROM chat_messages m
  LEFT JOIN chat_redpacks r ON r.message_id=CASE WHEN m.system_kind IS NULL THEN m.id WHEN m.system_kind IN ('ldc_winner','ldc_cancel','ldc_expired') THEN CAST(m.system_ref AS INTEGER) END
  LEFT JOIN ldc_packets p ON p.packet_id=r.id AND p.mode IN ('guess','clues')
  LEFT JOIN guess_free_rounds f ON f.packet_id=r.id
  JOIN users u ON u.id=COALESCE(p.owner_id,f.owner_id,m.user_id)
  WHERE m.group_id=? AND m.deleted=0 AND m.created_at>=?
   AND (m.system_kind IN ('join','guess_level') OR
    ((m.system_kind IS NULL OR m.system_kind IN ('ldc_winner','ldc_cancel','ldc_expired'))
     AND (p.packet_id IS NOT NULL OR f.packet_id IS NOT NULL)
     AND EXISTS(SELECT 1 FROM chat_messages origin WHERE origin.id=r.message_id AND origin.group_id=m.group_id AND origin.deleted=0)))
  ORDER BY m.created_at DESC,m.id DESC LIMIT 20`).bind(gid,joinedAt).all<Event>()
 const items=await Promise.all(rows.results.map(async row=>{
  let players:Player[]=[{id:row.actor_id,name:row.name,avatar:row.avatar}]
  if(row.kind==='ldc_winner'&&row.packet_id){
   const winners=await c.env.DB.prepare(`SELECT u.id,COALESCE(u.nick,u.name,u.username) AS name,u.avatar FROM (
    SELECT recipient_id AS uid,slot FROM ldc_awards WHERE packet_id=? AND recipient_id IS NOT NULL AND purpose='winner'
    UNION ALL SELECT winner_id AS uid,0 AS slot FROM guess_free_rounds WHERE packet_id=? AND winner_id IS NOT NULL
   ) w JOIN users u ON u.id=w.uid ORDER BY w.slot,u.id`).bind(row.packet_id,row.packet_id).all<Player>()
   players=winners.results
  }
  const text=({start:'发起了一轮猜词',join:'加入了游戏',guess_level:'解锁了新的猜词称号、徽章和气泡',ldc_winner:'已猜中本轮，奖励和答案公开进度请查看本轮信息',ldc_cancel:'本轮已流局',ldc_expired:'本轮已到期'})[row.kind]||'本轮状态已更新'
  return {id:row.id,kind:row.kind,created_at:row.created_at,updated_at:row.updated_at,text,players}
 }))
 return {items,now:now()}
}
