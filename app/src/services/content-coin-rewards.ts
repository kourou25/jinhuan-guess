import {ensureCoinWallet} from '../farm/coin-packets'
type Reward={source:'post'|'road';content_id:number;user_id:number;amount:number;eligible:number}
const eligible=`EXISTS(SELECT 1 FROM users u WHERE u.id=q.user_id AND u.kind='user' AND u.disabled=0)
 AND NOT EXISTS(SELECT 1 FROM account_retirements a WHERE a.source_id=q.user_id)
 AND ((q.source='post' AND EXISTS(SELECT 1 FROM memes m WHERE m.id=q.content_id AND m.author_id=q.user_id AND m.hidden=0))
 OR (q.source='road' AND EXISTS(SELECT 1 FROM road_items r WHERE r.id=q.content_id AND r.user_id=q.user_id AND r.hidden=0 AND r.source_hidden=0)))`

// Contents commit first, including NSFW tag triggers. The durable queue also
// covers chat imports and an interrupted response without rescanning all posts.
export async function settleContentRewards(db:D1Database,t:number,only?:{source:'post'|'road';id:number}){
 const rows=(await db.prepare(`SELECT q.source,q.content_id,q.user_id,q.amount,(${eligible}) eligible
  FROM content_coin_rewards q WHERE q.state='pending' AND ${only?'q.source=?1 AND q.content_id=?2':'q.available_at<=?1'}
  ORDER BY q.available_at,q.source,q.content_id LIMIT 100`).bind(...(only?[only.source,only.id]:[t])).all<Reward>()).results
 if(!rows.length)return {selected:0,paid:0,skipped:0}
 const ready=new Set<number>()
 for(const uid of new Set(rows.filter(r=>r.eligible).map(r=>r.user_id))){
  try{await ensureCoinWallet(db,uid,t);ready.add(uid)}catch{console.warn('content_reward_wallet_retry')}
 }
 const ids=JSON.stringify(rows.map(r=>[r.source,r.content_id])),users=JSON.stringify([...ready]),batch=crypto.randomUUID()
 const selected=`(q.source,q.content_id) IN (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?1))`
 const amount=`CASE WHEN q.amount>0 THEN q.amount WHEN q.source='road' THEN 100
   WHEN EXISTS(SELECT 1 FROM memes m WHERE m.id=q.content_id AND m.nsfw=1) THEN 52 ELSE 20 END`
 const result=await db.batch([
  db.prepare(`UPDATE content_coin_rewards AS q SET state='skipped' WHERE state='pending' AND ${selected} AND NOT (${eligible}) RETURNING content_id`).bind(ids),
  db.prepare(`UPDATE content_coin_rewards AS q SET batch_key=?2,amount=${amount},available_at=?3+60
   WHERE state='pending' AND ${selected} AND (${eligible}) AND user_id IN(SELECT value FROM json_each(?4))
   AND EXISTS(SELECT 1 FROM coin52_wallets w WHERE w.user_id=q.user_id)`).bind(ids,batch,t,users),
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT q.user_id,'content-'||q.source,CAST(q.content_id AS TEXT),?1||':'||q.source||':'||q.content_id,q.amount,
    w.balance+SUM(q.amount) OVER(PARTITION BY q.user_id ORDER BY q.source,q.content_id ROWS UNBOUNDED PRECEDING),?2
   FROM content_coin_rewards q JOIN coin52_wallets w ON w.user_id=q.user_id WHERE q.batch_key=?1 AND q.state='pending'`).bind(batch,t),
  db.prepare(`UPDATE coin52_wallets SET balance=balance+(SELECT SUM(amount) FROM content_coin_rewards q WHERE q.batch_key=?1 AND q.user_id=coin52_wallets.user_id AND q.state='pending'),revision=revision+1,updated_at=?2
   WHERE user_id IN(SELECT user_id FROM content_coin_rewards WHERE batch_key=?1 AND state='pending')`).bind(batch,t),
  db.prepare(`UPDATE content_coin_rewards SET state='paid',granted_at=?2 WHERE batch_key=?1 AND state='pending' RETURNING content_id`).bind(batch,t),
  db.prepare(`UPDATE content_coin_rewards AS q SET available_at=?2+60 WHERE state='pending' AND ${selected}`).bind(ids,t),
 ]).catch(async error=>{
  await db.prepare(`UPDATE content_coin_rewards AS q SET available_at=?2+60 WHERE state='pending' AND ${selected}`).bind(ids,t).run()
  throw error
 })
 return {selected:rows.length,paid:result[4].results.length,skipped:result[0].results.length}
}
