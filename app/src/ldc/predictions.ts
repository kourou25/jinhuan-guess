import type {C,User} from '../types';
import type {Env} from '../env';
import type {NativePacket} from './packets';
import {fail} from '../lib/http';
import {now} from '../lib/time';
import {gameTables} from './game-store';
import {predictionCurrency,stakeMinor,poolReturns,type Bet} from './standalone-rules';
import {predictionWinnerSql as winnerSql,predictionOutcome as outcome,predictionEligible as eligible} from './prediction-access';
import {fishPredictionConfigured,fishPredictionReady,reserveFishPrediction,settleFishPrediction,type FishWorkBudget} from './fish-predictions';

type Pool={packet_id:string;currency:'coin52'|'ldc';state:string;winner_id:number|null;settled_at:number|null;ldc_mode:'simulated'|'fish'|null};
const available=async(env:Env,pool:Pool)=>pool.currency==='coin52'||(pool.ldc_mode!=='fish'&&env.GUESS_SIMULATED_LDC==='1')||(pool.ldc_mode!=='simulated'&&env.GUESS_SIMULATED_LDC!=='1'&&await fishPredictionReady(env,pool.packet_id));
export function predictionStatements(db:D1Database,id:string,value:unknown,t:number){
 const currency=predictionCurrency(value);return currency?[db.prepare(`INSERT OR IGNORE INTO guess_prediction_pools(packet_id,currency,created_at) VALUES(?,?,?)`).bind(id,currency,t)]:[];
}
export async function settlePrediction(env:Env,id:string,work?:FishWorkBudget){
 const db=env.DB,pool=await db.prepare('SELECT * FROM guess_prediction_pools WHERE packet_id=?').bind(id).first<Pool>();if(!pool||pool.state!=='open')return;
 if(pool.ldc_mode==='fish')return settleFishPrediction(env,id,work);
 if(!await available(env,pool)&&await db.prepare('SELECT 1 FROM guess_prediction_bets WHERE packet_id=? LIMIT 1').bind(id).first())return;
 const p=await outcome(db,id),t=now();if(!p||!p.winner_id&&p.state==='open'&&p.ends_at>t)return;
 const bets=(await db.prepare('SELECT id,user_id,target_id,amount FROM guess_prediction_bets WHERE packet_id=? ORDER BY id').bind(id).all<Bet>()).results;
 const returns=poolReturns(bets,p.winner_id),token=crypto.randomUUID(),gate=`EXISTS(SELECT 1 FROM guess_prediction_pools WHERE packet_id=? AND settlement_token=?)`,wallet=pool.currency==='coin52'?'coin52_wallets':'guess_simulated_ldc_wallets';
 const list=[db.prepare("UPDATE guess_prediction_pools SET state=?,winner_id=?,settled_at=?,settlement_token=?,revision=revision+1 WHERE packet_id=? AND state='open'").bind(returns.some(r=>r.refund)?'refunded':'settled',p.winner_id,t,token,id)];
 for(const r of returns){
  list.push(db.prepare(`SELECT CASE WHEN NOT ${gate} OR EXISTS(SELECT 1 FROM ${wallet} WHERE user_id=? AND balance<=9007199254740991-?) THEN 1 ELSE json('prediction_balance_overflow') END`).bind(id,token,r.user_id,r.amount));
  list.push(db.prepare(`INSERT INTO guess_prediction_ledger(ref,user_id,currency,delta,created_at) SELECT ?,?,?,?,? WHERE ${gate}`).bind('return:'+r.id,r.user_id,pool.currency,r.amount,t,id,token));
  if(pool.currency==='coin52')list.push(db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT user_id,'prediction-return',?,?,?,balance+?,? FROM coin52_wallets WHERE user_id=? AND ${gate}`).bind(r.id,'pr-'+r.id,r.amount,r.amount,t,r.user_id,id,token));
  list.push(db.prepare(`UPDATE ${wallet} SET balance=balance+?${pool.currency==='coin52'?',revision=revision+1,updated_at='+t:''} WHERE user_id=? AND ${gate}`).bind(r.amount,r.user_id,id,token));
  list.push(db.prepare(`UPDATE guess_prediction_bets SET result_amount=?,result_kind=?,settled_at=? WHERE id=? AND ${gate}`).bind(r.amount,r.refund?'refund':r.amount?'win':'loss',t,r.id,id,token));
 }
 await db.batch(list);
}
export async function settlePredictions(env:Env){
 const work={remaining:6,deadline:Date.now()+15000};
 const rows=await env.DB.prepare(`SELECT p.packet_id FROM guess_prediction_pools p WHERE p.state='open' AND p.next_check_at<=unixepoch() AND (
 EXISTS(SELECT 1 FROM guess_prediction_bets b JOIN guess_fish_orders o ON o.bet_id=b.id WHERE b.packet_id=p.packet_id AND o.next_at<=unixepoch() AND o.lease_until<=unixepoch() AND o.state<>'accepted' AND NOT(o.kind='collect' AND o.state='rejected'))
 OR EXISTS(SELECT 1 FROM ldc_packets r WHERE r.packet_id=p.packet_id AND (r.state<>'open' OR r.ends_at<=unixepoch()))
 OR EXISTS(SELECT 1 FROM guess_free_rounds r WHERE r.packet_id=p.packet_id AND (r.state<>'open' OR r.ends_at<=unixepoch())) OR ${winnerSql} IS NOT NULL)
 ORDER BY p.next_check_at,p.created_at LIMIT 50`).all<{packet_id:string}>();
 for(const row of rows.results){if(Date.now()>=work.deadline||work.remaining<=0)break;
  await env.DB.prepare('UPDATE guess_prediction_pools SET next_check_at=? WHERE packet_id=?').bind(now()+60,row.packet_id).run();
  await settlePrediction(env,row.packet_id,work).catch(()=>console.error('guess_prediction_reconcile_failed'));
 }
}
export async function predictionView(c:C,p:NativePacket,uid:number){
 const db=c.env.DB;await settlePrediction(c.env,p.packet_id);
 const pool=await db.prepare('SELECT * FROM guess_prediction_pools WHERE packet_id=?').bind(p.packet_id).first<Pool>();if(!pool)return {enabled:false};
 const current=await outcome(db,p.packet_id),half=p.created_at+(p.ends_at-p.created_at)/2,t=now();
 const closed=!!current?.winner_id||current?.state!=='open'||t>=half||t>=p.ends_at;
 const mine=await db.prepare(`SELECT b.id,b.target_id,b.amount,b.result_amount,b.result_kind,b.created_at,b.settled_at,c.state collection_state,r.state payout_state FROM guess_prediction_bets b LEFT JOIN guess_fish_orders c ON c.bet_id=b.id AND c.kind='collect' LEFT JOIN guess_fish_orders r ON r.bet_id=b.id AND r.kind='return' WHERE b.packet_id=? AND b.user_id=?`).bind(p.packet_id,uid).first();
 const sums=await db.prepare(`SELECT COUNT(*) n,COALESCE(SUM(b.amount),0) total FROM guess_prediction_bets b LEFT JOIN guess_fish_orders c ON c.bet_id=b.id AND c.kind='collect' WHERE b.packet_id=? AND (c.state IS NULL OR c.state='accepted')`).bind(p.packet_id).first<{n:number;total:number}>();
 const currency=pool.currency,ready=await available(c.env,pool),simulated=currency==='ldc'&&pool.ldc_mode!=='fish'&&c.env.GUESS_SIMULATED_LDC==='1';
 const custody=await db.prepare('SELECT custodian_id FROM guess_fish_pools WHERE packet_id=?').bind(p.packet_id).first<{custodian_id:number}>();
 const custodian=currency==='ldc'&&!simulated&&(custody?.custodian_id??Number(c.env.GUESS_FISH_CUSTODIAN_ID));
 return {enabled:true,currency,label:currency==='coin52'?'D币':'LDC',simulated,available:ready,state:pool.state,closed,closes_at:half,winner_id:current?.winner_id||null,can_bet:ready&&!closed&&!mine&&uid!==p.owner_id&&uid!==custodian,total:sums?.total||0,count:sums?.n||0,mine,min:currency==='ldc'?0.1:100,max:currency==='ldc'?100:100000,unavailable_reason:ready?null:'站长 Fish 积分托管尚未配置、已停用或本局账本模式不匹配'};
}
export async function placePrediction(c:C,p:NativePacket,u:User,b:Record<string,unknown>){
 const db=c.env.DB,pool=await db.prepare('SELECT * FROM guess_prediction_pools WHERE packet_id=?').bind(p.packet_id).first<Pool>();if(!pool)fail(409,'本局未开启下注');
 if(!await available(c.env,pool!))fail(503,'站长 Fish 积分托管尚未配置、已停用或本局账本模式不匹配');
 const target=Number(b.target_id),id=String(b.nonce||'');if(!Number.isSafeInteger(target)||!/^[-a-f0-9]{36}$/i.test(id))fail(400,'下注对象或请求编号无效');
 if(target===u.id||u.id===p.owner_id||target===p.owner_id)fail(403,'不可押自己；出题人或已知谜底者不可参与下注');
 let amount:number;try{amount=stakeMinor(pool!.currency,b.amount)}catch(e){fail(400,(e as Error).message)}
 const prior=await db.prepare('SELECT * FROM guess_prediction_bets WHERE packet_id=? AND user_id=?').bind(p.packet_id,u.id).first<Bet>();
 if(prior){if(prior.id!==id||prior.target_id!==target||prior.amount!==amount!)fail(409,'每人每局仅可下注一次，不可追加、改押或撤回');return predictionView(c,p,u.id)}
 if(pool!.currency==='ldc'&&c.env.GUESS_SIMULATED_LDC!=='1'&&fishPredictionConfigured(c.env)){await reserveFishPrediction(c,p,u,id,target,amount!);return predictionView(c,p,u.id)}
 const wallet=pool!.currency==='coin52'?'coin52_wallets':'guess_simulated_ldc_wallets',table=gameTables(p).rounds,t=now();
 const gate='EXISTS(SELECT 1 FROM guess_prediction_bets WHERE id=?)';
 try{await db.batch([
  ...(pool!.currency==='ldc'?[db.prepare("UPDATE guess_prediction_pools SET ldc_mode='simulated' WHERE packet_id=? AND (ldc_mode IS NULL OR ldc_mode='simulated')").bind(p.packet_id),db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM guess_prediction_pools WHERE packet_id=? AND ldc_mode='simulated') THEN 1 ELSE json('prediction_mode_conflict') END").bind(p.packet_id)]:[]),
  db.prepare(`INSERT INTO guess_prediction_bets(id,packet_id,user_id,target_id,amount,created_at)
   SELECT ?1,p.packet_id,?2,?3,?4,unixepoch() FROM ${table} p JOIN guess_prediction_pools pool ON pool.packet_id=p.packet_id JOIN ${wallet} w ON w.user_id=?2
   WHERE p.packet_id=?5 AND p.state='open' AND pool.state='open' AND p.ends_at>unixepoch() AND unixepoch()<p.created_at+(p.ends_at-p.created_at)/2.0
   AND ${winnerSql} IS NULL AND p.owner_id<>?2 AND p.owner_id<>?3 AND w.balance>=?4 AND ${eligible('?2')} AND ${eligible('?3')}
   AND EXISTS(SELECT 1 FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id WHERE r.id=p.packet_id AND m.deleted=0)
   AND NOT EXISTS(SELECT 1 FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.recipient_id=?2)`).bind(id,u.id,target,amount!,p.packet_id),
  db.prepare(`SELECT CASE WHEN ${gate} THEN 1 ELSE json('prediction_closed_or_balance_or_access') END`).bind(id),
  db.prepare(`INSERT INTO guess_prediction_ledger(ref,user_id,currency,delta,created_at) VALUES(?,?,?,?,?)`).bind('stake:'+id,u.id,pool!.currency,-amount!,t),
  ...(pool!.currency==='coin52'?[db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT user_id,'prediction-stake',?,?,?,balance-?,? FROM coin52_wallets WHERE user_id=?`).bind(id,'ps-'+id,-amount!,amount!,t,u.id)]:[]),
  db.prepare(`UPDATE ${wallet} SET balance=balance-?${pool!.currency==='coin52'?',revision=revision+1,updated_at='+t:''} WHERE user_id=?`).bind(amount!,u.id),
  db.prepare(`UPDATE ${table} SET room_revision=room_revision+1 WHERE packet_id=?`).bind(p.packet_id),
  db.prepare('UPDATE chat_messages SET updated_at=? WHERE id=(SELECT message_id FROM chat_redpacks WHERE id=?)').bind(t,p.packet_id),
 ])}catch{
  const retry=await db.prepare('SELECT id,target_id,amount FROM guess_prediction_bets WHERE packet_id=? AND user_id=?').bind(p.packet_id,u.id).first<Bet>();
  if(!retry||retry.id!==id||retry.target_id!==target||retry.amount!==amount!)fail(409,'下注未扣款：已封盘、余额不足、身份无效或已经下注');
 }
 return predictionView(c,p,u.id);
}
