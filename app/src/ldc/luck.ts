// 无任务时仅一次 due 索引读取。每包最多100份，状态变化唤醒，无额外平台轮询。
export async function settlePacketLuck(db:D1Database,at:number){
 const jobs=await db.prepare('SELECT packet_id FROM packet_luck_jobs WHERE due_at<=? ORDER BY due_at,packet_id LIMIT 10').bind(at).all<{packet_id:string}>()
 for(const {packet_id:id} of jobs.results){
  await db.batch([
   db.prepare(`INSERT OR IGNORE INTO packet_luck_settlements(packet_id,settled_at)
    SELECT p.packet_id,? FROM ldc_packets p JOIN packet_luck_jobs j ON j.packet_id=p.packet_id
    WHERE p.packet_id=? AND p.mode='random'
    AND (SELECT COUNT(*) FROM ldc_awards WHERE packet_id=p.packet_id)=p.count
    AND (p.ends_at<=? OR p.state='closed' OR NOT EXISTS(SELECT 1 FROM ldc_awards WHERE packet_id=p.packet_id AND recipient_id IS NULL))
    AND NOT EXISTS(SELECT 1 FROM ldc_awards WHERE packet_id=p.packet_id AND recipient_id IS NOT NULL AND state<>'accepted')`).bind(at,id,at),
   db.prepare('DELETE FROM packet_luck_jobs WHERE packet_id=? AND EXISTS(SELECT 1 FROM packet_luck_settlements WHERE packet_id=?)').bind(id,id),
   // 未完成包等到期；有待核对订单的包退避一小时，订单变化会立即唤醒。
   db.prepare('UPDATE packet_luck_jobs SET due_at=MAX(?,COALESCE((SELECT ends_at FROM ldc_packets WHERE packet_id=?),?)) WHERE packet_id=?').bind(at+3600,id,at+3600,id),
  ])
 }
 return jobs.results.length
}
import type {C} from '../types'
import {now} from '../lib/time'
export async function packetLuckStats(c:C,gid:number,uid:number){
 const badge=c.req.query('badge')==='luck_last'?'luck_last':'luck_king',period=c.req.query('period')==='all'?'all':'today',start=period==='all'?0:Math.floor((now()+28800)/86400)*86400-28800
 const rows=(await c.env.DB.prepare(`WITH scores AS (SELECT w.user_id,COUNT(*) wins,MIN(w.created_at) first_at FROM packet_luck_wins w JOIN ldc_packets p ON p.packet_id=w.packet_id JOIN users u ON u.id=w.user_id WHERE p.group_id=? AND w.badge=? AND w.created_at>=? AND u.disabled=0 AND u.kind='user' GROUP BY w.user_id),ranked AS (SELECT *,ROW_NUMBER() OVER(ORDER BY wins DESC,first_at,user_id) position FROM scores) SELECT r.*,COALESCE(u.nick,u.name,u.username) name,u.avatar FROM ranked r JOIN users u ON u.id=r.user_id WHERE r.position<=20 OR r.user_id=? ORDER BY r.position`).bind(gid,badge,start,uid).all<{user_id:number;wins:number;position:number;name:string;avatar:string|null}>()).results
 const mine=rows.find(r=>r.user_id===uid)
 return {badge,period,leaders:rows.filter(r=>r.position<=20),mine:mine?.wins||0,mineRank:mine?.position||0,scope:'本站已确认到账的拼手气红包；并列金额共同获标，至少两人且金额有差异。'}
}
