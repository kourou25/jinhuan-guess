import {ensureCoinWallet} from '../farm/coin-packets'

// Shared game/award tables identify the winner; this adapter alone moves D coins.
// Reserve base + the full optional escalation cap so future additions are funded.
export function reserveCoinPool(db:D1Database,id:string,uid:number,coins:number,t:number){
 const attempt=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM coin52_ledger WHERE attempt=?)'
 return [
  db.prepare(`INSERT OR IGNORE INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT ?1,'game-reserve',?2,?3,-?4,balance-?4,?5 FROM coin52_wallets WHERE user_id=?1 AND balance>=?4
   AND EXISTS(SELECT 1 FROM ldc_packets WHERE packet_id=?2 AND owner_id=?1 AND payment_provider='coin52')`).bind(uid,id,attempt,coins,t),
  db.prepare(`UPDATE coin52_wallets SET balance=balance-?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate}`).bind(coins,t,uid,attempt),
  db.prepare(`INSERT OR IGNORE INTO packet_coin_escrows(packet_id,owner_id,reserved,remaining,created_at) SELECT ?,?,?,?,? WHERE ${gate}`).bind(id,uid,coins,coins,t,attempt),
  db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM packet_coin_escrows WHERE packet_id=?) THEN 1 ELSE json('dcoin_balance_insufficient') END").bind(id),
 ]
}
export async function settleCoinAward(db:D1Database,awardId:string,uid:number,t:number){
 await ensureCoinWallet(db,uid,t)
 const attempt=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM coin52_ledger WHERE attempt=?)'
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT a.recipient_id,'game-claim',a.id,?,a.amount_cents/100,w.balance+a.amount_cents/100,?
   FROM ldc_awards a JOIN packet_coin_escrows e ON e.packet_id=a.packet_id JOIN coin52_wallets w ON w.user_id=a.recipient_id
   WHERE a.id=? AND a.recipient_id=? AND a.state='reserved' AND a.attempts=0 AND a.amount_cents%100=0
   AND e.refunded_at IS NULL AND e.remaining>=a.amount_cents/100 AND w.balance<=9007199254740991-a.amount_cents/100`).bind(attempt,t,awardId,uid),
  db.prepare(`UPDATE coin52_wallets SET balance=balance+(SELECT delta FROM coin52_ledger WHERE attempt=?),revision=revision+1,updated_at=? WHERE user_id=? AND ${gate}`).bind(attempt,t,uid,attempt),
  db.prepare(`UPDATE packet_coin_escrows SET remaining=remaining-(SELECT delta FROM coin52_ledger WHERE attempt=?) WHERE packet_id=(SELECT packet_id FROM ldc_awards WHERE id=?) AND ${gate}`).bind(attempt,awardId,attempt),
  db.prepare(`UPDATE ldc_awards SET state='accepted',receipt_no=?,sent_at=?,attempts=1 WHERE id=? AND state='reserved' AND ${gate}`).bind('dcoin-'+attempt,t,awardId,attempt),
 ])
}
export async function refundCoinPool(db:D1Database,id:string,t:number){
 const attempt=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM coin52_ledger WHERE attempt=?)'
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT e.owner_id,'game-refund',e.packet_id,?,e.remaining,w.balance+e.remaining,? FROM packet_coin_escrows e JOIN ldc_packets p ON p.packet_id=e.packet_id JOIN coin52_wallets w ON w.user_id=e.owner_id
   WHERE e.packet_id=? AND e.refunded_at IS NULL AND e.remaining>0 AND w.balance<=9007199254740991-e.remaining
   AND (p.state='closed' OR p.ends_at<=? OR NOT EXISTS(SELECT 1 FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.recipient_id IS NULL))
   AND NOT EXISTS(SELECT 1 FROM packet_draws d WHERE d.packet_id=e.packet_id AND d.settled_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.recipient_id IS NOT NULL AND a.state<>'accepted')`).bind(attempt,t,id,t),
  db.prepare(`UPDATE coin52_wallets SET balance=balance+(SELECT delta FROM coin52_ledger WHERE attempt=?),revision=revision+1,updated_at=? WHERE user_id=(SELECT user_id FROM coin52_ledger WHERE attempt=?)`).bind(attempt,t,attempt),
  db.prepare(`UPDATE packet_coin_escrows SET remaining=0,refunded_at=? WHERE packet_id=? AND ${gate}`).bind(t,id,attempt),
 ]);
}
export async function settleCoinPools(db:D1Database,t:number){
 const rows=await db.prepare(`SELECT e.packet_id FROM packet_coin_escrows e JOIN ldc_packets p ON p.packet_id=e.packet_id WHERE e.refunded_at IS NULL AND e.remaining>0
  AND (p.state='closed' OR p.ends_at<=? OR EXISTS(SELECT 1 FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.state='reserved') OR NOT EXISTS(SELECT 1 FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.recipient_id IS NULL)) ORDER BY p.ends_at LIMIT 20`).bind(t).all<{packet_id:string}>()
 for(const row of rows.results){
  const awards=await db.prepare(`SELECT a.id,a.recipient_id FROM ldc_awards a JOIN ldc_packets p ON p.packet_id=a.packet_id WHERE a.packet_id=? AND a.state='reserved' AND (p.escalation_every=0 OR p.reward_finalized=1)`).bind(row.packet_id).all<{id:string;recipient_id:number}>()
  for(const a of awards.results)await settleCoinAward(db,a.id,a.recipient_id,t)
  await refundCoinPool(db,row.packet_id,t)
 }
}
