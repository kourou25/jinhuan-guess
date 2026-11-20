import type {Env} from '../env';
import type {C,User} from '../types';
import type {NativePacket} from './packets';
import {fail} from '../lib/http';
import {now} from '../lib/time';
import {unseal} from './core';
import {queryFish,transferFish,type FishAward} from './fish';
import {gameTables} from './game-store';
import {poolReturns,type Bet} from './standalone-rules';
import {predictionWinnerSql as winnerSql,predictionEligible as eligible,predictionOutcome} from './prediction-access';

type Account={user_id:number;client_id:string;subject:string;username:string;secret_box:string;enabled:number};
type Custody={packet_id:string;custodian_id:number;client_id:string;subject:string;username:string;allocated_at:number|null;refund:number|null};
type Order=FishAward&{bet_id:string;kind:'collect'|'return';payer_id:number;client_id:string;payer_subject:string;payer_username:string;state:string;lease_token:string};
export type FishWorkBudget={remaining:number;deadline:number};
const canRequest=(b:FishWorkBudget)=>b.remaining>0&&Date.now()<b.deadline;
const budget=():FishWorkBudget=>({remaining:3,deadline:Date.now()+15000});
export function fishPredictionConfigured(env:Env){const id=Number(env.GUESS_FISH_CUSTODIAN_ID);return env.GUESS_FISH_ENABLED==='1'&&!!env.LDC_ENCRYPTION_KEY&&Number.isSafeInteger(id)&&id!==0&&(env.ADMIN_USER_IDS||'').split(',').some(v=>/^-?\d+$/.test(v.trim())&&Number(v)===id)}
async function account(env:Env,uid:number){return env.DB.prepare('SELECT * FROM fish_accounts WHERE user_id=?').bind(uid).first<Account>()}
export async function fishPredictionReady(env:Env,id:string){
 if(!fishPredictionConfigured(env))return false;
 const pool=await env.DB.prepare('SELECT * FROM guess_fish_pools WHERE packet_id=?').bind(id).first<Custody>();
 if(pool&&pool.custodian_id!==Number(env.GUESS_FISH_CUSTODIAN_ID))return false;
 const a=await account(env,pool?.custodian_id??Number(env.GUESS_FISH_CUSTODIAN_ID));
 return !!a?.enabled&&(!pool||a.client_id===pool.client_id);
}

// Reserve an immutable intent under the same database gate as local predictions.
// No external request runs until the reservation and source snapshots are durable.
export async function reserveFishPrediction(c:C,p:NativePacket,u:User,id:string,target:number,amount:number){
 const env=c.env,db=env.DB;
 if(!await fishPredictionReady(env,p.packet_id))fail(503,'站长 Fish 积分托管尚未配置或已停用');
 const existing=await db.prepare('SELECT * FROM guess_fish_pools WHERE packet_id=?').bind(p.packet_id).first<Custody>();
 const owner=await account(env,existing?.custodian_id??Number(env.GUESS_FISH_CUSTODIAN_ID)),payer=await account(env,u.id);
 if(!payer?.enabled)fail(409,'请先在支付渠道绑定并启用本人的 Fish 账户');
 if(payer!.subject===owner!.subject)fail(409,'托管账户无法向自己转账，不能参与本局 LDC 下注');
 const table=gameTables(p).rounds,t=now(),gate='EXISTS(SELECT 1 FROM guess_prediction_bets WHERE id=?)';
 try{await db.batch([
  db.prepare(`UPDATE guess_prediction_pools SET ldc_mode='fish' WHERE packet_id=? AND (ldc_mode IS NULL OR ldc_mode='fish') AND NOT EXISTS(SELECT 1 FROM guess_prediction_bets WHERE packet_id=? AND NOT EXISTS(SELECT 1 FROM guess_fish_pools WHERE packet_id=?))`).bind(p.packet_id,p.packet_id,p.packet_id),
  db.prepare(`INSERT INTO guess_fish_pools(packet_id,custodian_id,client_id,subject,username) SELECT packet_id,?,?,?,? FROM guess_prediction_pools WHERE packet_id=? AND ldc_mode='fish' ON CONFLICT(packet_id) DO NOTHING`).bind(owner!.user_id,owner!.client_id,owner!.subject,owner!.username,p.packet_id),
  db.prepare(`INSERT INTO guess_prediction_bets(id,packet_id,user_id,target_id,amount,created_at)
   SELECT ?1,p.packet_id,?2,?3,?4,unixepoch() FROM ${table} p JOIN guess_prediction_pools pool ON pool.packet_id=p.packet_id
   JOIN guess_fish_pools f ON f.packet_id=p.packet_id
   WHERE p.packet_id=?5 AND p.state='open' AND pool.state='open' AND pool.ldc_mode='fish' AND f.allocated_at IS NULL
   AND p.ends_at>unixepoch() AND unixepoch()<p.created_at+(p.ends_at-p.created_at)/2.0 AND ${winnerSql} IS NULL
   AND p.owner_id<>?2 AND p.owner_id<>?3 AND ${eligible('?2')} AND ${eligible('?3')}
   AND EXISTS(SELECT 1 FROM fish_accounts a WHERE a.user_id=?2 AND a.enabled=1 AND a.client_id=?6 AND a.subject=?7)
   AND EXISTS(SELECT 1 FROM fish_accounts a WHERE a.user_id=f.custodian_id AND a.enabled=1 AND a.client_id=f.client_id)
   AND EXISTS(SELECT 1 FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id WHERE r.id=p.packet_id AND m.deleted=0)
   AND NOT EXISTS(SELECT 1 FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.recipient_id=?2)`).bind(id,u.id,target,amount,p.packet_id,payer!.client_id,payer!.subject),
  db.prepare(`SELECT CASE WHEN ${gate} THEN 1 ELSE json('prediction_closed_or_access') END`).bind(id),
  db.prepare(`INSERT INTO guess_fish_orders(order_no,bet_id,kind,payer_id,client_id,payer_subject,payer_username,recipient_subject,recipient_username,amount_cents,created_at,updated_at)
   SELECT ?,?,'collect',?,?,?,?,subject,username,?,?,? FROM guess_fish_pools WHERE packet_id=?`).bind('gp-c-'+id,id,u.id,payer!.client_id,payer!.subject,payer!.username,amount,t,t,p.packet_id),
  db.prepare(`UPDATE ${table} SET room_revision=room_revision+1 WHERE packet_id=?`).bind(p.packet_id),
 ])}catch{
  const retry=await db.prepare('SELECT id,target_id,amount FROM guess_prediction_bets WHERE packet_id=? AND user_id=?').bind(p.packet_id,u.id).first<Bet>();
  if(!retry||retry.id!==id||retry.target_id!==target||retry.amount!==amount)fail(409,'下注未提交：已封盘、身份无效、账本模式冲突或已经下注');
 }
}

async function processOrder(env:Env,orderNo:string,work:FishWorkBudget){
 if(!canRequest(work))return;
 const db=env.DB,t=now(),token=crypto.randomUUID();
 const o=await db.prepare(`UPDATE guess_fish_orders SET lease_token=?,lease_until=? WHERE order_no=? AND state<>'accepted' AND NOT(kind='collect' AND state='rejected') AND next_at<=? AND lease_until<=? RETURNING *`).bind(token,t+45,orderNo,t,t).first<Order>();
 if(!o)return;
 const a=await account(env,o.payer_id);
 let result:{state:string;receipt:string|null;error:string|null};
 if(!a||a.client_id!==o.client_id){result={state:o.state,receipt:null,error:'ACCOUNT_CHANGED'}}
 else{
  try{
   const key=await unseal(env.LDC_ENCRYPTION_KEY!,'fish-account:'+a.user_id+':'+a.client_id,a.secret_box),owner={userId:o.payer_subject,username:o.payer_username};
   // Unknown/sending orders are queried even after the user disables new transfers.
   if(o.state==='ready'){
    if(!a.enabled){result={state:o.kind==='collect'?'rejected':'ready',receipt:null,error:'ACCOUNT_DISABLED'}}
    else{
     await db.prepare("UPDATE guess_fish_orders SET state='unknown' WHERE order_no=? AND lease_token=?").bind(orderNo,token).run();
     work.remaining--;
     result=await transferFish(key,o,owner,'猜词积分'+(o.kind==='collect'?'下注':'结算'));
    }
   }else{
    work.remaining--;result=await queryFish(key,o,owner);
    if(result.state==='not_found'){
     // An unconfirmed collection is never blindly resubmitted. Keep the pool pending.
     if(o.kind==='return'&&a.enabled&&canRequest(work)){work.remaining--;result=await transferFish(key,o,owner,'猜词积分结算')}
     else result={state:'unknown',receipt:null,error:'TRANSFER_NOT_FOUND'};
    }
   }
  }catch{result={state:o.state==='ready'?'ready':'unknown',receipt:null,error:'CREDENTIAL_UNAVAILABLE'}}
 }
 const state=result.state==='sent'?'sending':result.state;
 const accepted=state==='accepted',guard="EXISTS(SELECT 1 FROM guess_fish_orders WHERE order_no=? AND lease_token=? AND state='accepted')";
 await db.batch([
  db.prepare('UPDATE guess_fish_orders SET state=?,receipt=COALESCE(?,receipt),error=?,next_at=?,lease_until=0,updated_at=? WHERE order_no=? AND lease_token=?').bind(state,result.receipt,result.error,t+30,t,orderNo,token),
  ...(accepted?[
   db.prepare(`INSERT OR IGNORE INTO guess_prediction_ledger(ref,user_id,currency,delta,created_at) SELECT ?,b.user_id,'ldc',?,? FROM guess_prediction_bets b WHERE b.id=? AND ${guard}`).bind((o.kind==='collect'?'stake:':'return:')+o.bet_id,o.kind==='collect'?-o.amount_cents:o.amount_cents,t,o.bet_id,orderNo,token),
   ...(o.kind==='return'?[db.prepare(`UPDATE guess_prediction_bets SET settled_at=? WHERE id=? AND ${guard}`).bind(t,o.bet_id,orderNo,token)]:[]),
  ]:[]),
 ]);
}

export async function settleFishPrediction(env:Env,id:string,work:FishWorkBudget=budget()){
 if(env.GUESS_FISH_ENABLED!=='1'||env.GUESS_SIMULATED_LDC==='1'||!env.LDC_ENCRYPTION_KEY)return;
 const db=env.DB,t=now();
 const collections=(await db.prepare(`SELECT o.order_no FROM guess_fish_orders o JOIN guess_prediction_bets b ON b.id=o.bet_id WHERE b.packet_id=? AND o.kind='collect' AND o.state NOT IN('accepted','rejected') AND o.next_at<=? AND o.lease_until<=? ORDER BY o.next_at LIMIT 10`).bind(id,t,t).all<{order_no:string}>()).results;
 for(const o of collections){if(!canRequest(work))break;await processOrder(env,o.order_no,work)}
 const p=await predictionOutcome(db,id),pool=await db.prepare('SELECT * FROM guess_fish_pools WHERE packet_id=?').bind(id).first<Custody>();
 if(!p||!pool||!p.winner_id&&p.state==='open'&&p.ends_at>t)return;
 if(await db.prepare(`SELECT 1 FROM guess_fish_orders o JOIN guess_prediction_bets b ON b.id=o.bet_id WHERE b.packet_id=? AND o.kind='collect' AND o.state NOT IN('accepted','rejected') LIMIT 1`).bind(id).first())return;
 if(pool.allocated_at===null){
  const bets=(await db.prepare(`SELECT b.* FROM guess_prediction_bets b JOIN guess_fish_orders o ON o.bet_id=b.id AND o.kind='collect' AND o.state='accepted' WHERE b.packet_id=? ORDER BY b.id`).bind(id).all<Bet>()).results;
  const returns=poolReturns(bets,p.winner_id),token=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM guess_prediction_pools WHERE packet_id=? AND settlement_token=?)';
  const list=[db.prepare(`UPDATE guess_prediction_pools SET settlement_token=?,winner_id=? WHERE packet_id=? AND settlement_token IS NULL AND state='open'`).bind(token,p.winner_id,id),
   db.prepare(`UPDATE guess_fish_pools SET allocated_at=?,refund=? WHERE packet_id=? AND ${gate}`).bind(t,returns.some(r=>r.refund)?1:0,id,id,token)];
  for(const r of returns){
   list.push(db.prepare(`UPDATE guess_prediction_bets SET result_amount=?,result_kind=?,settled_at=? WHERE id=? AND ${gate}`).bind(r.amount,r.refund?'refund':r.amount?'win':'loss',r.amount?null:t,r.id,id,token));
   if(r.amount)list.push(db.prepare(`INSERT INTO guess_fish_orders(order_no,bet_id,kind,payer_id,client_id,payer_subject,payer_username,recipient_subject,recipient_username,amount_cents,created_at,updated_at)
    SELECT ?,?,'return',?,?,?,?,payer_subject,payer_username,?,?,? FROM guess_fish_orders WHERE bet_id=? AND kind='collect' AND ${gate}`).bind('gp-r-'+r.id,r.id,pool.custodian_id,pool.client_id,pool.subject,pool.username,r.amount,t,t,r.id,id,token));
  }
  await db.batch(list);
 }
 const payouts=(await db.prepare(`SELECT o.order_no FROM guess_fish_orders o JOIN guess_prediction_bets b ON b.id=o.bet_id WHERE b.packet_id=? AND o.kind='return' AND o.state<>'accepted' AND o.next_at<=? AND o.lease_until<=? ORDER BY o.next_at LIMIT 10`).bind(id,t,t).all<{order_no:string}>()).results;
 for(const o of payouts){if(!canRequest(work))break;await processOrder(env,o.order_no,work)}
 await db.prepare(`UPDATE guess_prediction_pools SET state=CASE WHEN (SELECT refund FROM guess_fish_pools WHERE packet_id=?1)=1 THEN 'refunded' ELSE 'settled' END,settled_at=?2,revision=revision+1 WHERE packet_id=?1 AND state='open' AND EXISTS(SELECT 1 FROM guess_fish_pools WHERE packet_id=?1 AND allocated_at IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM guess_fish_orders o JOIN guess_prediction_bets b ON b.id=o.bet_id WHERE b.packet_id=?1 AND (o.kind='return' AND o.state<>'accepted' OR o.kind='collect' AND o.state NOT IN('accepted','rejected')))` ).bind(id,t).run();
}
