import type {C,User} from '../types'
import {fail} from '../lib/http'
import {now} from '../lib/time'
import {identity,type NativePacket} from './packets'

// Priority is assigned once on registration and never exposed before the draw.
export async function enterPacketDraw(c:C,p:NativePacket,u:User){
 const db=c.env.DB,t=now(),who=p.payment_provider==='coin52'?{subject:'site:'+u.id,username:u.username}:await identity(c,u.id)
 const bytes=crypto.getRandomValues(new Uint8Array(16)),priority=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('')
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO packet_draw_entries(packet_id,user_id,subject,username,priority,entered_at)
   SELECT p.packet_id,?1,?2,?3,?4,?5 FROM ldc_packets p JOIN packet_draws d ON d.packet_id=p.packet_id JOIN chat_redpacks r ON r.id=p.packet_id JOIN chat_messages m ON m.id=r.message_id
   JOIN chat_members cm ON cm.group_id=p.group_id AND cm.user_id=?1 JOIN users u ON u.id=?1
   WHERE p.packet_id=?6 AND p.owner_id<>?1 AND p.state='open' AND d.settled_at IS NULL AND d.draw_at>?5 AND m.deleted=0 AND m.created_at>=cm.joined_at
   AND u.kind='user' AND u.disabled=0 AND u.silenced=0 AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE group_id=p.group_id AND user_id=?1)
   AND NOT EXISTS(SELECT 1 FROM user_limits WHERE user_id=?1 AND u.is_admin=0 AND kind='chat' AND (until=0 OR until>?5))
   AND (p.payment_provider='coin52' OR EXISTS(SELECT 1 FROM identities i WHERE i.user_id=?1 AND i.provider='linuxdo' AND i.subject=?2 AND i.username=?3 AND i.verified_at IS NOT NULL))
   AND (SELECT COUNT(*) FROM packet_draw_entries WHERE packet_id=p.packet_id)<1000`).bind(u.id,who.subject,who.username,priority,t,p.packet_id),
  db.prepare(`INSERT OR IGNORE INTO packet_events(packet_id,user_id,kind,body,created_at) SELECT packet_id,user_id,'joined','已参与红包抽奖，开奖后会收到结果通知。',entered_at FROM packet_draw_entries WHERE packet_id=? AND user_id=?`).bind(p.packet_id,u.id),
 ])
 if(!await db.prepare('SELECT 1 FROM packet_draw_entries WHERE packet_id=? AND user_id=?').bind(p.packet_id,u.id).first())fail(409,'报名已截止、人数已满，或当前账号不能参与')
}
export async function packetDrawView(db:D1Database,id:string,uid:number){
 const d=await db.prepare('SELECT draw_at,settled_at FROM packet_draws WHERE packet_id=?').bind(id).first<{draw_at:number;settled_at:number|null}>();if(!d)return null
 const [size,mine,people]=await Promise.all([
  db.prepare('SELECT COUNT(*) AS n FROM packet_draw_entries WHERE packet_id=?').bind(id).first<{n:number}>(),
  db.prepare('SELECT 1 FROM packet_draw_entries WHERE packet_id=? AND user_id=?').bind(id,uid).first(),
  db.prepare(`SELECT e.user_id,u.avatar,COALESCE(u.nick,u.name,u.username) name,a.amount_cents,a.state FROM packet_draw_entries e JOIN users u ON u.id=e.user_id LEFT JOIN ldc_awards a ON a.packet_id=e.packet_id AND a.recipient_id=e.user_id WHERE e.packet_id=? ORDER BY e.entered_at,e.user_id LIMIT 100`).bind(id).all(),
 ])
 return {...d,joined:!!mine,participant_count:size?.n||0,participants:people.results,more:(size?.n||0)>100}
}
export async function allocateDueDraws(db:D1Database,t:number){
 const rows=await db.prepare('SELECT packet_id FROM packet_draws WHERE settled_at IS NULL AND draw_at<=? ORDER BY draw_at LIMIT 10').bind(t).all<{packet_id:string}>()
 for(const {packet_id:id} of rows.results){
  await db.batch([
   db.prepare(`WITH ranked AS (SELECT e.user_id,e.subject,CASE WHEN p.payment_provider='coin52' THEN u.username ELSE (SELECT username FROM identities WHERE user_id=u.id AND provider='linuxdo' AND subject=e.subject) END username,ROW_NUMBER() OVER(ORDER BY e.priority,e.user_id)-1 slot FROM packet_draw_entries e
    JOIN ldc_packets p ON p.packet_id=e.packet_id JOIN packet_draws d ON d.packet_id=e.packet_id JOIN users u ON u.id=e.user_id
    JOIN chat_members cm ON cm.group_id=p.group_id AND cm.user_id=e.user_id JOIN chat_redpacks r ON r.id=p.packet_id JOIN chat_messages m ON m.id=r.message_id
    WHERE e.packet_id=?1 AND d.settled_at IS NULL AND d.draw_at<=?2 AND p.state='open' AND m.deleted=0 AND m.created_at>=cm.joined_at
    AND u.disabled=0 AND u.silenced=0 AND u.kind='user' AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id)
    AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE user_id=u.id AND group_id=p.group_id)
    AND NOT EXISTS(SELECT 1 FROM user_limits WHERE user_id=u.id AND u.is_admin=0 AND kind='chat' AND (until=0 OR until>?2))
    AND (p.payment_provider='coin52' OR EXISTS(SELECT 1 FROM identities WHERE user_id=u.id AND provider='linuxdo' AND subject=e.subject AND verified_at IS NOT NULL)))
    UPDATE ldc_awards SET recipient_id=(SELECT user_id FROM ranked WHERE ranked.slot=ldc_awards.slot),recipient_subject=(SELECT subject FROM ranked WHERE ranked.slot=ldc_awards.slot),recipient_username=(SELECT username FROM ranked WHERE ranked.slot=ldc_awards.slot),state='reserved'
    WHERE packet_id=?1 AND state='ready' AND EXISTS(SELECT 1 FROM ranked WHERE ranked.slot=ldc_awards.slot)`).bind(id,t),
   db.prepare("UPDATE ldc_packets SET state='closed' WHERE packet_id=? AND EXISTS(SELECT 1 FROM packet_draws WHERE packet_id=? AND settled_at IS NULL AND draw_at<=?)").bind(id,id,t),
   db.prepare('UPDATE packet_draws SET settled_at=? WHERE packet_id=? AND settled_at IS NULL AND draw_at<=?').bind(t,id,t),
  ])
 }
 return rows.results.map(r=>r.packet_id)
}
