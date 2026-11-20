// 只读已闭合日聚合；总榜也从截止日前的日桶汇总，避免延迟cron混入新一天。
const boards={
 guess:{table:'guess_group_player_stats',column:'wins',at:'last_at',offset:28800,direction:'DESC'},
 guess_winrate:{table:'guess_rate_stats',column:'wins',at:null,offset:28800,direction:'DESC'},
 sender_count:{table:'packet_sender_stats',column:'packets',at:'created_at',offset:28800,direction:'DESC'},
 sender_paid:{table:'packet_sender_stats',column:'paid_cents',at:'paid_at',offset:28800,direction:'DESC'},
 chat_count:{table:'chat_activity_stats',column:'messages',at:null,offset:14400,direction:'DESC'},
 chat_early:{table:'chat_activity_stats',column:'first_at',at:null,offset:14400,direction:'ASC'},
 chat_late:{table:'chat_activity_stats',column:'last_at',at:null,offset:14400,direction:'DESC'},
} as const
type Job={group_id:number;board:keyof typeof boards;period:'day'|'all';next_at:number}
export async function settleRankJob(db:D1Database,job:Job,at:number){
 if(!Number.isSafeInteger(job.group_id)||job.group_id<=0||!Number.isSafeInteger(job.next_at)||!Object.prototype.hasOwnProperty.call(boards,job.board)||!['day','all'].includes(job.period)||!Number.isSafeInteger(at)||at<job.next_at)throw new Error('invalid_rank_job')
 const spec=boards[job.board],{table,column,direction,offset}=spec
 const podiumTotal=job.period==='all'&&['chat_early','chat_late'].includes(job.board)
 if((job.next_at+offset)%86400!==0)throw new Error('invalid_rank_boundary')
 const day=new Date((job.next_at+offset-1)*1000).toISOString().slice(0,10),token=crypto.randomUUID()
 const score=job.period==='all'?`SUM(s.${column})`:`s.${column}`
 const tie=spec.at?(job.period==='all'?`MAX(s.${spec.at})`:`s.${spec.at}`):'0'
 const candidates=job.board==='guess_winrate'?`SELECT s.user_id,10000.0*SUM(s.wins)/SUM(s.rounds) score,-SUM(s.rounds) tie,COALESCE(u.nick,u.name,u.username) name
  FROM guess_rate_stats s JOIN users u ON u.id=s.user_id WHERE s.group_id=? AND s.day<>'*' AND s.day${job.period==='all'?'<=':'='}?
  AND u.kind='user' AND u.disabled=0 AND NOT EXISTS(SELECT 1 FROM account_retirements r WHERE r.source_id=s.user_id)
  GROUP BY s.user_id HAVING SUM(s.rounds)>=${job.period==='all'?10:3}`:podiumTotal?`SELECT s.user_id,COUNT(*) score,0 tie,COALESCE(u.nick,u.name,u.username) name
  FROM rank_placements s JOIN users u ON u.id=s.user_id WHERE s.group_id=? AND s.day<=? AND s.board='${job.board}' AND s.period='day'
  AND u.kind='user' AND u.disabled=0 AND NOT EXISTS(SELECT 1 FROM account_retirements r WHERE r.source_id=s.user_id)
  GROUP BY s.user_id`:`SELECT s.user_id,${score} score,${tie} tie,COALESCE(u.nick,u.name,u.username) name
  FROM ${table} s JOIN users u ON u.id=s.user_id WHERE s.group_id=? AND s.day<>'*' AND s.day${job.period==='all'?'<=':'='}?
  AND u.kind='user' AND u.disabled=0 AND NOT EXISTS(SELECT 1 FROM account_retirements r WHERE r.source_id=s.user_id)
  ${job.period==='all'?'GROUP BY s.user_id':''} ${job.period==='all'?'HAVING':'AND'} ${score}>0`
 const order=podiumTotal?'DESC':direction
 // 总榜等待同日的日榜快照（包括空榜），否则既不发奖也不推进游标。
 const ready=podiumTotal?` WHERE EXISTS(SELECT 1 FROM rank_settlements WHERE group_id=${job.group_id} AND board='${job.board}' AND period='day' AND day='${day}')`:''
 // 同一batch内锁、快照、推进游标；只有本次成功插入的token能写名次。
 await db.batch([
  db.prepare('INSERT OR IGNORE INTO rank_settlements(group_id,board,period,day,cutoff,settled_at,token) SELECT ?,?,?,?,?,?,?'+ready)
   .bind(job.group_id,job.board,job.period,day,job.next_at,at,token),
  db.prepare(`INSERT INTO rank_placements(group_id,board,period,day,place,user_id,score,name,created_at)
   SELECT ?,?,?,?,ROW_NUMBER() OVER(ORDER BY score ${order},tie,user_id),user_id,score,name,?
   FROM (${candidates}) WHERE EXISTS(SELECT 1 FROM rank_settlements WHERE group_id=? AND board=? AND period=? AND day=? AND token=?)
   ORDER BY score ${order},tie,user_id LIMIT 3`)
   .bind(job.group_id,job.board,job.period,day,at,job.group_id,day,job.group_id,job.board,job.period,day,token),
  db.prepare(`INSERT OR IGNORE INTO rank_digest_queue(group_id,day,next_at)
   SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM rank_settlements WHERE group_id=? AND board=? AND period=? AND day=? AND token=?)`)
   .bind(job.group_id,day,Date.parse(day+'T00:00:00+08:00')/1000+100800,job.group_id,job.board,job.period,day,token),
  db.prepare('UPDATE rank_settlement_jobs SET next_at=? WHERE group_id=? AND board=? AND period=? AND next_at=? AND EXISTS(SELECT 1 FROM rank_settlements WHERE group_id=? AND board=? AND period=? AND day=?)')
   .bind(job.next_at+86400,job.group_id,job.board,job.period,job.next_at,job.group_id,job.board,job.period,day),
 ])
}
export async function settleDailyRanks(db:D1Database,at:number){
 const jobs=await db.prepare("SELECT group_id,board,period,next_at FROM rank_settlement_jobs WHERE next_at<=? ORDER BY next_at,group_id,board,CASE period WHEN 'day' THEN 0 ELSE 1 END LIMIT 8").bind(at).all<Job>()
 for(const job of jobs.results)await settleRankJob(db,job,at)
 await publishRankDigests(db,at)
 return jobs.results.length
}

const labels={guess:'猜中',guess_winrate:'胜率',sender_count:'发包次数',sender_paid:'发放额度',chat_count:'发言',chat_early:'早安',chat_late:'晚安'}
type Placement={board:keyof typeof boards;period:'day'|'all';place:number;user_id:number;score:number;name:string;n:number;level:number;reward:string;threshold:number}
export async function publishRankDigests(db:D1Database,at:number){
 const due=await db.prepare("SELECT group_id,day,next_at FROM rank_digest_queue WHERE state='pending' AND next_at<=? ORDER BY next_at,group_id LIMIT 4").bind(at).all<{group_id:number;day:string;next_at:number}>()
 for(const job of due.results){
  const pending=await db.prepare(`SELECT 1 FROM rank_settlement_jobs WHERE group_id=? AND next_at<=? - CASE WHEN board LIKE 'chat_%' THEN 0 ELSE 14400 END LIMIT 1`).bind(job.group_id,job.next_at).first()
  if(pending)continue
  const placements=await db.prepare(`SELECT p.board,p.period,p.place,p.user_id,p.score,p.name,b.n,z.level,z.name reward,z.threshold
   FROM rank_placements p JOIN user_badges b ON b.user_id=p.user_id AND b.badge='rank_'||p.board||'_'||p.period
   JOIN rank_reward_catalog z ON z.series=b.badge AND z.level=(SELECT MAX(level) FROM rank_reward_catalog WHERE series=b.badge AND threshold<=b.n)
   WHERE p.group_id=? AND p.day=? ORDER BY p.period,p.board,p.place LIMIT 42`).bind(job.group_id,job.day).all<Placement>()
  const rows=placements.results,lines=[`每日榜单 · ${job.day}`]
  const clean=(s:string)=>s.replace(/[\r\n\p{Cf}]/gu,' ').slice(0,40)
  const score=(r:Placement)=>r.board==='guess_winrate'?(r.score/100).toFixed(1)+'%':r.board==='sender_paid'?(r.score/100).toFixed(2)+' LDC':r.board==='chat_count'?r.score+'条':r.board==='chat_early'||r.board==='chat_late'?r.period==='all'?r.score+'次':new Date((r.score+28800)*1000).toISOString().slice(11,16):r.score+'次'
  for(const period of ['day','all'] as const){
   lines.push(period==='day'?'日榜':'总榜')
   for(const board of Object.keys(boards) as (keyof typeof boards)[]){
    const list=rows.filter(r=>r.period===period&&r.board===board)
    if(list.length)lines.push(labels[board]+'｜'+list.map(r=>['①','②','③'][r.place-1]+clean(r.name)+' '+score(r)).join(' · '))
   }
  }
  lines.push('称号','日榜、总榜每天独立结算：第一 +3、第二 +2、第三 +1 经验。称号可在装扮中选择。')
  for(const r of rows)lines.push(`${clean(r.name)} · ${labels[r.board]}${r.period==='day'?'日榜':'总榜'} · +${4-r.place}经验 · 累计${r.n}经验 · Lv.${r.level} ${clean(r.reward)}${r.n-(4-r.place)<r.threshold?'（新解锁）':''}`)
  const statements=[]
  if(rows.length)statements.push(db.prepare(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
   SELECT ?,?,?,?,?,'rank_award',? WHERE EXISTS(SELECT 1 FROM rank_digest_queue WHERE group_id=? AND day=? AND state='pending')`).bind(job.group_id,rows[0].user_id,lines.join('\n'),at,at,'rank:daily:'+job.group_id+':'+job.day,job.group_id,job.day))
  statements.push(db.prepare("UPDATE rank_digest_queue SET state='done' WHERE group_id=? AND day=? AND state='pending'").bind(job.group_id,job.day))
  await db.batch(statements)
 }
}
