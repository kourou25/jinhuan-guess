import type {C} from '../types'
import {fail} from '../lib/http'
import {now} from '../lib/time'
const metrics={count:{column:'packets',at:'created_at',index:'idx_packet_sender_count',label:'发包次数',unit:'次'},declared:{column:'declared_cents',at:'created_at',index:'idx_packet_sender_declared',label:'创建奖池额度',unit:'LDC'},paid:{column:'paid_cents',at:'paid_at',index:'idx_packet_sender_paid',label:'已确认发放额度',unit:'LDC'}} as const
export async function senderStatsView(c:C,gid:number,uid:number){
 const metric=c.req.query('metric')
 if(!metric||!(metric in metrics))fail(400,'请选择发包统计口径')
 const selected=metrics[metric as keyof typeof metrics]
 if(!selected?.column)fail(400,'发包统计口径无效')
 const {column,at,index,label,unit}=selected,period=c.req.query('period')==='all'?'all':'today'
 const today=new Date((now()+28800)*1000).toISOString().slice(0,10),day=period==='all'?'*':today
 const [top,mine]=await Promise.all([
  c.env.DB.prepare(`SELECT s.user_id,s.${column} AS value,COALESCE(u.nick,u.name,u.username) AS name,u.avatar FROM packet_sender_stats s INDEXED BY ${index}
   JOIN users u ON u.id=s.user_id WHERE s.group_id=? AND s.day=? AND s.${column}>0 AND u.kind='user' AND u.disabled=0
   ORDER BY s.${column} DESC,s.${at},s.user_id LIMIT 20`).bind(gid,day).all<{user_id:number;value:number;name:string;avatar:string|null}>(),
  c.env.DB.prepare(`SELECT ${column} AS value,${at} AS at,packets,declared_cents,paid_cents FROM packet_sender_stats WHERE group_id=? AND day=? AND user_id=?`).bind(gid,day,uid).first<{value:number;at:number;packets:number;declared_cents:number;paid_cents:number}>(),
 ])
 let mineRank=mine?.value?top.results.findIndex(row=>row.user_id===uid)+1:0
 if(mine?.value&&!mineRank){
  const row=await c.env.DB.prepare(`SELECT COUNT(*) n FROM packet_sender_stats s INDEXED BY ${index} JOIN users u ON u.id=s.user_id
   WHERE s.group_id=? AND s.day=? AND u.kind='user' AND u.disabled=0 AND (s.${column}>? OR (s.${column}=? AND (s.${at}<? OR (s.${at}=? AND s.user_id<?))))`)
   .bind(gid,day,mine.value,mine.value,mine.at,mine.at,uid).first<{n:number}>()
  mineRank=(row?.n||0)+1
 }
 return {metric,label,unit,period,today,source:'native_ldc',leaders:top.results,mine:mine||{value:0,packets:0,declared_cents:0,paid_cents:0},mineRank}
}
