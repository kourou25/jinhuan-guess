// Campaign activation is explicit and immutable across redeployments.
export const STARTER_KEY = 'guess.starter.202610.starts_at';
export const STARTER_REF = 'guess-starter-202610';
export const STARTER_AMOUNT = 10000;
export const STARTER_END = Date.parse('2026-11-01T00:00:00+08:00') / 1000;

export async function starterGiftState(db:D1Database, uid:number, at=Math.floor(Date.now()/1000)) {
 const row=await db.prepare(`SELECT u.created_at,u.disabled,u.kind,
  EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id) retired,
  (SELECT v FROM site_settings WHERE k=?) starts,
  (SELECT created_at FROM coin52_ledger WHERE user_id=u.id AND kind='guess-starter' AND ref=?) claimed_at,
  COALESCE((SELECT balance FROM coin52_wallets WHERE user_id=u.id),0) balance
  FROM users u WHERE u.id=?`).bind(STARTER_KEY,STARTER_REF,uid).first<any>();
 const starts=String(row?.starts||''),start=/^[1-9]\d{9}$/.test(starts)?Number(starts):0;
 let state='ineligible';
 if(row&&!row.disabled&&row.kind==='user'&&!row.retired){
  if(row.claimed_at!=null)state='claimed';
  else if(!start||start>=STARTER_END)state='inactive';
  else if(at>=STARTER_END)state='ended';
  else if(at>=start&&row.created_at<=at)
   state=row.balance>Number.MAX_SAFE_INTEGER-STARTER_AMOUNT?'unavailable':'eligible';
 }
 return {state,amount:STARTER_AMOUNT,starts_at:start||null,ends_at:STARTER_END,balance:row?.balance??0,claimed_at:row?.claimed_at??null};
}

export async function claimStarterGift(db:D1Database, uid:number, at=Math.floor(Date.now()/1000)) {
 const before=await starterGiftState(db,uid,at);
 if(before.state!=='eligible')return before;
 // A new server-only attempt gates the wallet update. A losing concurrent request
 // cannot reuse the winning ledger row to increment the wallet a second time.
 const attempt='starter:'+crypto.randomUUID();
 const eligible=`SELECT 1 FROM users u JOIN site_settings s ON s.k=?
  WHERE u.id=? AND u.disabled=0 AND u.kind='user' AND s.v=?
  AND ?>=? AND u.created_at<=? AND ?<?
  AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id)`;
 const args=[STARTER_KEY,uid,String(before.starts_at),at,before.starts_at,at,at,STARTER_END];
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO coin52_wallets(user_id,balance,updated_at)
   SELECT ?,0,? WHERE EXISTS(${eligible})`).bind(uid,at,...args),
  db.prepare(`INSERT OR IGNORE INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT ?,'guess-starter',?,?,?,balance+?,? FROM coin52_wallets
   WHERE user_id=? AND balance<=? AND EXISTS(${eligible})`)
   .bind(uid,STARTER_REF,attempt,STARTER_AMOUNT,STARTER_AMOUNT,at,uid,Number.MAX_SAFE_INTEGER-STARTER_AMOUNT,...args),
  db.prepare(`UPDATE coin52_wallets SET balance=balance+?,revision=revision+1,updated_at=?
   WHERE user_id=? AND EXISTS(SELECT 1 FROM coin52_ledger WHERE user_id=? AND kind='guess-starter' AND ref=? AND attempt=?)`)
   .bind(STARTER_AMOUNT,at,uid,uid,STARTER_REF,attempt),
 ]);
 return starterGiftState(db,uid,at);
}
