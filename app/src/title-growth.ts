import {ensureCoinWallet} from './farm/coin-packets'
import {enabledRaffleSql} from './shared/raffle-policy'
export const whalePrice=(_level:number):number|null=>null
// Callers pass trusted SQL expressions, never user input.
export const titleLevelSql=(uid:string,title:string,closing=false)=>`MIN(5200,
 (SELECT COUNT(*) FROM chat_title_raffles r WHERE r.winner_id=${uid} AND r.title=${title} AND r.status IN (${closing?"'drawn','closing'":"'drawn'"}))
 +EXISTS(SELECT 1 FROM user_unlocks x WHERE x.user_id=${uid} AND x.item='raffle:'||${title})
 +(SELECT COALESCE(SUM(levels),0) FROM title_awards a WHERE a.user_id=${uid} AND a.title=${title}))`
export async function whaleView(db:D1Database,uid:number,owner:boolean,t:number){
 await ensureCoinWallet(db,uid,t)
 const row=await db.prepare(`SELECT ${titleLevelSql('?1',"'whalebuddy'")} AS level,(SELECT balance FROM coin52_wallets WHERE user_id=?1) AS balance`).bind(uid).first<{level:number;balance:number}>()
 const level=owner?5200:row!.level
 return {level,balance:row!.balance,next_price:whalePrice(level),max_level:5200,owner}
}
export async function buyWhale(_db:D1Database,_uid:number,_level:number,_id:string,_t:number){throw Error('称号D币直购已停用；通过抽卡或成长奖励升级')}
export const raffleChance=(boosts:number)=>5+Math.max(0,Math.min(20,boosts))
export function raffleRoll(){const limit=Math.floor(4294967296/100)*100;let n:number;do{n=crypto.getRandomValues(new Uint32Array(1))[0]}while(n>=limit);return n%100}
export async function payTitleEntry(db:D1Database,uid:number,id:string,target:number,t:number){
 if(!Number.isInteger(target)||target<0||target>20)throw Error('追加次数须为0至20')
 await ensureCoinWallet(db,uid,t)
 const total=(target+1)*100,attempt=crypto.randomUUID(),ref=id+':'+target,gate=`EXISTS(SELECT 1 FROM coin52_ledger WHERE user_id=?1 AND attempt=?2)`
 const result=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT ?1,'title-entry',?2,?3,-(?4-COALESCE(e.paid,0)),w.balance-(?4-COALESCE(e.paid,0)),?5
   FROM coin52_wallets w JOIN chat_title_raffles r ON r.id=?6 LEFT JOIN chat_title_raffle_entries e ON e.raffle_id=r.id AND e.user_id=w.user_id
   WHERE w.user_id=?1 AND r.paid_version=1 AND r.status='open' AND r.closes_at>?5 AND ${enabledRaffleSql('r.title')} AND ?4>COALESCE(e.paid,0)
   AND w.balance>=?4-COALESCE(e.paid,0) AND EXISTS(SELECT 1 FROM chat_members WHERE group_id=1 AND user_id=?1)
   AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND kind='user' AND disabled=0)
   AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE group_id=1 AND user_id=?1)
   AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1) RETURNING id`).bind(uid,ref,attempt,total,t,id),
  db.prepare(`UPDATE coin52_wallets SET balance=balance+(SELECT delta FROM coin52_ledger WHERE user_id=?1 AND attempt=?2),revision=revision+1,updated_at=?3 WHERE user_id=?1 AND ${gate}`).bind(uid,attempt,t),
  db.prepare(`INSERT INTO chat_title_raffle_entries(raffle_id,user_id,joined_at,boosts,paid) SELECT ?3,?1,?4,?5,?6 WHERE ${gate}
   ON CONFLICT(raffle_id,user_id) DO UPDATE SET boosts=excluded.boosts,paid=excluded.paid`).bind(uid,attempt,id,t,target,total),
 ])
 if(!result[0].meta.changes&&!await db.prepare('SELECT 1 FROM chat_title_raffle_entries WHERE raffle_id=? AND user_id=? AND paid>=?').bind(id,uid,total).first())throw Error('余额不足、报名已截止或参与资格已变化')
}

export async function drawPaidTitle(db:D1Database,id:string,t:number,roll=raffleRoll):Promise<'drawn'|'retry'>{
 await db.prepare("UPDATE chat_title_raffles SET status='closing' WHERE id=? AND paid_version=1 AND status='open' AND closes_at<=?").bind(id,t).run()
 const rows=(await db.prepare(`SELECT e.user_id,e.boosts,r.title FROM chat_title_raffle_entries e JOIN chat_title_raffles r ON r.id=e.raffle_id WHERE r.id=? AND r.paid_version=1 AND r.status='closing' AND e.result IS NULL ORDER BY e.user_id LIMIT 20`).bind(id).all<{user_id:number;boosts:number;title:string}>()).results
 for(const row of rows){
  const token=crypto.randomUUID(),win=roll()<raffleChance(row.boosts)?1:0
  await db.batch([
   db.prepare(`UPDATE chat_title_raffle_entries SET result=CASE WHEN EXISTS(SELECT 1 FROM users u JOIN chat_members cm ON cm.user_id=u.id AND cm.group_id=1 WHERE u.id=?2 AND u.kind='user' AND u.disabled=0)
    AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE group_id=1 AND user_id=?2) AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?2) THEN ?3 ELSE 2 END,result_token=?4
    WHERE raffle_id=?1 AND user_id=?2 AND result IS NULL AND EXISTS(SELECT 1 FROM chat_title_raffles WHERE id=?1 AND paid_version=1 AND status='closing')`).bind(id,row.user_id,win,token),
   db.prepare(`INSERT OR IGNORE INTO title_awards(user_id,title,source,created_at) SELECT user_id,?,raffle_id,? FROM chat_title_raffle_entries WHERE raffle_id=? AND user_id=? AND result=1 AND result_token=?`).bind(row.title,t,id,row.user_id,token),
   db.prepare(`UPDATE users SET deco=json_set(deco,'$.fn',${titleLevelSql('users.id','?1')}),updated_at=?2 WHERE id=?3 AND json_extract(deco,'$.ft')=?1 AND EXISTS(SELECT 1 FROM chat_title_raffle_entries WHERE raffle_id=?4 AND user_id=?3 AND result=1 AND result_token=?5)`).bind(row.title,t,row.user_id,id,token),
  ])
 }
 const token=crypto.randomUUID()
 const [result]=await db.batch([
  db.prepare(`UPDATE chat_title_raffles SET status='drawn',drawn_at=?,claim_token=? WHERE id=? AND paid_version=1 AND status='closing' AND NOT EXISTS(SELECT 1 FROM chat_title_raffle_entries WHERE raffle_id=? AND result IS NULL)`).bind(t,token,id,id),
  db.prepare(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
   SELECT 1,creator_id,'称号抽奖已开奖 · '||(SELECT COUNT(*) FROM chat_title_raffle_entries WHERE raffle_id=r.id AND result=1)||' 人中奖，点击查看个人结果',?,?,'title_raffle',id FROM chat_title_raffles r WHERE id=? AND claim_token=?`).bind(t,t,id,token),
 ])
 return result.meta.changes?'drawn':'retry'
}
