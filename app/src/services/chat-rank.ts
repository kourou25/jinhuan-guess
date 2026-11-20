import type {C} from '../types'
import {fail} from '../lib/http'
import {now} from '../lib/time'

const metrics={count:{column:'messages',direction:'DESC',index:'idx_chat_activity_count'},early:{column:'first_at',direction:'ASC',index:'idx_chat_activity_first'},late:{column:'last_at',direction:'DESC',index:'idx_chat_activity_last'}} as const
export async function chatRankView(c:C,gid:number,uid:number){
 const metric=c.req.query('metric')||'count',period=c.req.query('period')==='all'?'all':'today'
 if(!Object.prototype.hasOwnProperty.call(metrics,metric))fail(400,'水群榜类型无效')
 if(period==='all'&&metric!=='count')return chatPodiumView(c,gid,uid,metric as 'early'|'late')
 const {column,direction,index}=metrics[metric as keyof typeof metrics]
 const today=new Date((now()+14400)*1000).toISOString().slice(0,10),day=period==='all'?'*':today
 const [top,mine]=await Promise.all([
  c.env.DB.prepare(`SELECT s.user_id,s.${column} value,s.messages,s.first_at,s.last_at,COALESCE(u.nick,u.name,u.username) name,u.avatar
   FROM chat_activity_stats s INDEXED BY ${index} JOIN users u ON u.id=s.user_id
   WHERE s.group_id=? AND s.day=? AND s.messages>0 AND u.kind='user' AND u.disabled=0
   ORDER BY s.${column} ${direction},s.user_id LIMIT 20`).bind(gid,day).all<{user_id:number;value:number;messages:number;first_at:number|null;last_at:number|null;name:string;avatar:string|null}>(),
  c.env.DB.prepare(`SELECT ${column} value,messages,first_at,last_at FROM chat_activity_stats WHERE group_id=? AND day=? AND user_id=?`).bind(gid,day,uid).first<{value:number;messages:number;first_at:number|null;last_at:number|null}>(),
 ])
 let mineRank=mine?.messages?top.results.findIndex(row=>row.user_id===uid)+1:0
 if(mine?.messages&&!mineRank){
  const row=await c.env.DB.prepare(`SELECT COUNT(*) n FROM chat_activity_stats s INDEXED BY ${index} JOIN users u ON u.id=s.user_id
   WHERE s.group_id=? AND s.day=? AND s.messages>0 AND u.kind='user' AND u.disabled=0 AND (s.${column}${direction==='ASC'?'<':'>'}? OR (s.${column}=? AND s.user_id<?))`)
   .bind(gid,day,mine.value,mine.value,uid).first<{n:number}>()
  mineRank=(row?.n||0)+1
 }
 return {metric,period,today,leaders:top.results,mine:mine||{value:0,messages:0,first_at:null,last_at:null},mineRank}
}

async function chatPodiumView(c:C,gid:number,uid:number,metric:'early'|'late'){
 const board='chat_'+metric
 const [top,mine]=await Promise.all([
  c.env.DB.prepare(`SELECT s.user_id,s.n value,COALESCE(u.nick,u.name,u.username) name,u.avatar
   FROM chat_podium_totals s INDEXED BY idx_chat_podium_rank JOIN users u ON u.id=s.user_id
   WHERE s.group_id=? AND s.board=? AND u.kind='user' AND u.disabled=0 ORDER BY s.n DESC,s.user_id LIMIT 20`).bind(gid,board).all(),
  c.env.DB.prepare('SELECT n value FROM chat_podium_totals WHERE group_id=? AND board=? AND user_id=?').bind(gid,board,uid).first<{value:number}>(),
 ])
 let mineRank=mine?.value?top.results.findIndex(row=>row.user_id===uid)+1:0
 if(mine?.value&&!mineRank){
  const ahead=await c.env.DB.prepare(`SELECT COUNT(*) n FROM chat_podium_totals s INDEXED BY idx_chat_podium_rank JOIN users u ON u.id=s.user_id
   WHERE s.group_id=? AND s.board=? AND u.kind='user' AND u.disabled=0 AND (s.n>? OR (s.n=? AND s.user_id<?))`).bind(gid,board,mine.value,mine.value,uid).first<{n:number}>()
  mineRank=(ahead?.n||0)+1
 }
 return {metric,period:'all',unit:'podiums',leaders:top.results,mine:mine||{value:0},mineRank}
}
