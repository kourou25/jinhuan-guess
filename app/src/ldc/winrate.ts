import type {C} from '../types'

export async function winrateView(c:C,gid:number,uid:number,day:string){
 const minimum=day==='*'?10:3
 const eligible=`u.kind='user' AND u.disabled=0 AND NOT EXISTS(SELECT 1 FROM account_retirements r WHERE r.source_id=u.id)`
 const [ranks,mine,coverage]=await Promise.all([
  c.env.DB.prepare(`SELECT s.user_id,s.rounds,s.wins,s.rate,COALESCE(u.nick,u.name,u.username) name,u.avatar
   FROM guess_rate_stats s INDEXED BY idx_guess_rate_rank JOIN users u ON u.id=s.user_id
   WHERE s.group_id=? AND s.day=? AND s.rounds>=? AND ${eligible} ORDER BY s.rate DESC,s.rounds DESC,s.user_id LIMIT 20`).bind(gid,day,minimum).all(),
  c.env.DB.prepare('SELECT rounds,wins,rate FROM guess_rate_stats WHERE group_id=? AND day=? AND user_id=?').bind(gid,day,uid).first<{rounds:number;wins:number;rate:number}>(),
  c.env.DB.prepare('SELECT since,rounds,excluded FROM guess_rate_coverage WHERE group_id=?').bind(gid).first<{since:number|null;rounds:number;excluded:number}>(),
 ])
 let rank=0
 if(mine&&mine.rounds>=minimum){
  const before=await c.env.DB.prepare(`SELECT COUNT(*) n FROM guess_rate_stats s JOIN users u ON u.id=s.user_id
   WHERE s.group_id=? AND s.day=? AND s.rounds>=? AND ${eligible}
   AND (s.rate>? OR (s.rate=? AND (s.rounds>? OR (s.rounds=? AND s.user_id<?))))`)
   .bind(gid,day,minimum,mine.rate,mine.rate,mine.rounds,mine.rounds,uid).first<number>('n')
  rank=(before||0)+1
 }
 return {minimum,leaders:ranks.results,mine:mine||{rounds:0,wins:0,rate:0},mineRank:rank,coverage,excluded:coverage?.excluded||0}
}
