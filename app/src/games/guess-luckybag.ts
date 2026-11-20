import {coinPacketSplit,ensureCoinWallet} from '../farm/coin-packets'

type Rule={probability_bps:number;min_total:number;max_total:number}
type Bag=Rule&{packet_id:string;sponsor_id:number;state:string;total:number;remaining:number;due_at:number|null;funded_at:number|null;ended_at:number|null;settled_at:number|null;created_at:number;ends_at:number;round_state:string;count:number;claimed:number}
const activeRound=`EXISTS(SELECT 1 FROM ldc_packets p WHERE p.packet_id=?1 AND p.state='open' AND p.ends_at>?2 AND (SELECT COUNT(*) FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.recipient_id IS NOT NULL)<p.count)`
function randomInt(max:number){const limit=Math.floor(4294967296/max)*max;let n:number;do{n=crypto.getRandomValues(new Uint32Array(1))[0]}while(n>=limit);return n%max}
export function planLuckybag(rule:Rule,start:number,end:number){
 if(![rule.probability_bps,rule.min_total,rule.max_total,start,end].every(Number.isSafeInteger)||rule.probability_bps<0||rule.probability_bps>10000||rule.min_total<1||rule.max_total>1000||rule.min_total>rule.max_total||end<=start+2)throw Error('福袋随机参数无效')
 if(randomInt(10000)>=rule.probability_bps)return null
 const duration=end-start,first=start+Math.max(1,Math.floor(duration*.1)),last=Math.min(end-1,start+Math.floor(duration*.8))
 return {total:rule.min_total+randomInt(rule.max_total-rule.min_total+1),due_at:first+randomInt(Math.max(1,last-first+1))}
}
async function load(db:D1Database,id:string){return db.prepare(`SELECT b.*,p.ends_at,p.state AS round_state,p.count,(SELECT COUNT(*) FROM ldc_awards WHERE packet_id=b.packet_id AND recipient_id IS NOT NULL) AS claimed FROM guess_luckybags b JOIN ldc_packets p ON p.packet_id=b.packet_id WHERE b.packet_id=?`).bind(id).first<Bag>()}

async function fund(db:D1Database,b:Bag,t:number){
 await ensureCoinWallet(db,b.sponsor_id,t)
 const attempt=crypto.randomUUID(),gate=`EXISTS(SELECT 1 FROM coin52_ledger WHERE attempt=?3)`
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT b.sponsor_id,'guess-bag-reserve',b.packet_id,?3,-b.total,w.balance-b.total,?2 FROM guess_luckybags b JOIN coin52_wallets w ON w.user_id=b.sponsor_id JOIN users u ON u.id=w.user_id
   WHERE b.packet_id=?1 AND b.state='scheduled' AND b.due_at<=?2 AND w.balance>=b.total AND u.disabled=0 AND u.kind='user'
   AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id) AND ${activeRound}`).bind(b.packet_id,t,attempt),
  db.prepare(`UPDATE coin52_wallets SET balance=balance+(SELECT delta FROM coin52_ledger WHERE attempt=?3),revision=revision+1,updated_at=?2 WHERE user_id=(SELECT sponsor_id FROM guess_luckybags WHERE packet_id=?1) AND ${gate}`).bind(b.packet_id,t,attempt),
  db.prepare(`UPDATE guess_luckybags SET state='open',remaining=total,funded_at=?2 WHERE packet_id=?1 AND ${gate}`).bind(b.packet_id,t,attempt),
  db.prepare(`UPDATE guess_luckybags SET state='skipped',reason='funding_unavailable' WHERE packet_id=?1 AND state='scheduled' AND due_at<=?2 AND NOT ${gate}`).bind(b.packet_id,t,attempt),
 ])
}
async function refund(db:D1Database,b:Bag,t:number){
 const attempt=crypto.randomUUID()
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT b.sponsor_id,'guess-bag-refund',b.packet_id,?3,b.remaining,w.balance+b.remaining,?2 FROM guess_luckybags b JOIN coin52_wallets w ON w.user_id=b.sponsor_id
   WHERE b.packet_id=?1 AND b.state='allocating' AND b.remaining>0 AND w.balance<=9007199254740991-b.remaining AND NOT EXISTS(SELECT 1 FROM guess_luckybag_allocations WHERE packet_id=b.packet_id) AND NOT EXISTS(SELECT 1 FROM guess_luckybag_candidates WHERE packet_id=b.packet_id)`).bind(b.packet_id,t,attempt),
  db.prepare(`UPDATE coin52_wallets SET balance=balance+(SELECT delta FROM coin52_ledger WHERE attempt=?),revision=revision+1,updated_at=? WHERE user_id=(SELECT user_id FROM coin52_ledger WHERE attempt=?)`).bind(attempt,t,attempt),
  db.prepare(`UPDATE guess_luckybags SET remaining=0,state='refunded',settled_at=? WHERE packet_id=? AND EXISTS(SELECT 1 FROM coin52_ledger WHERE attempt=?)`).bind(t,b.packet_id,attempt),
 ])
}
async function settle(db:D1Database,b:Bag,t:number){
 await db.prepare("UPDATE guess_luckybags SET state='allocating' WHERE packet_id=? AND state='closing'").bind(b.packet_id).run()
 const people=(await db.prepare('SELECT user_id FROM guess_luckybag_candidates WHERE packet_id=? ORDER BY seq LIMIT ?').bind(b.packet_id,b.total).all<{user_id:number}>()).results
 if(!people.length){await refund(db,b,t);return}
 const amounts=coinPacketSplit(b.total,people.length,'random')
 for(let i=amounts.length-1;i>0;i--){const j=randomInt(i+1);[amounts[i],amounts[j]]=[amounts[j],amounts[i]]}
 // One INSERT selects the complete immutable allocation. Competing retries cannot
 // mix allocations or reroll a partially paid bag.
 await db.prepare(`INSERT INTO guess_luckybag_allocations(packet_id,user_id,amount)
  SELECT ?1,json_extract(value,'$.user_id'),json_extract(value,'$.amount') FROM json_each(?2)
  WHERE EXISTS(SELECT 1 FROM guess_luckybags WHERE packet_id=?1 AND state='allocating') AND NOT EXISTS(SELECT 1 FROM guess_luckybag_allocations WHERE packet_id=?1)`)
  .bind(b.packet_id,JSON.stringify(people.map((p,i)=>({...p,amount:amounts[i]})))).run()
 // Most users already have wallets. Migrate missing legacy wallets in bounded
 // batches; unpayable allocations stay pending and keep their original amount.
 const missing=(await db.prepare(`SELECT a.user_id FROM guess_luckybag_allocations a LEFT JOIN coin52_wallets w ON w.user_id=a.user_id WHERE a.packet_id=? AND a.paid_at IS NULL AND w.user_id IS NULL LIMIT 20`).bind(b.packet_id).all<{user_id:number}>()).results
 for(const p of missing)await ensureCoinWallet(db,p.user_id,t)
 const attempt=crypto.randomUUID()
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT a.user_id,'guess-bag-award',a.packet_id,?3||':'||a.user_id,a.amount,w.balance+a.amount,?2 FROM guess_luckybag_allocations a JOIN coin52_wallets w ON w.user_id=a.user_id
   WHERE a.packet_id=?1 AND a.paid_at IS NULL AND w.balance<=9007199254740991-a.amount
   AND EXISTS(SELECT 1 FROM guess_luckybags WHERE packet_id=?1 AND state='allocating')`).bind(b.packet_id,t,attempt),
  db.prepare(`UPDATE coin52_wallets SET balance=balance+(SELECT delta FROM coin52_ledger l WHERE l.user_id=coin52_wallets.user_id AND l.attempt=?3||':'||l.user_id),revision=revision+1,updated_at=?2
   WHERE user_id IN(SELECT user_id FROM coin52_ledger WHERE ref=?1 AND kind='guess-bag-award' AND attempt=?3||':'||user_id)`).bind(b.packet_id,t,attempt),
  db.prepare(`UPDATE guess_luckybag_allocations SET paid_at=?2 WHERE packet_id=?1 AND paid_at IS NULL AND EXISTS(SELECT 1 FROM coin52_ledger l WHERE l.ref=?1 AND l.kind='guess-bag-award' AND l.user_id=guess_luckybag_allocations.user_id)`).bind(b.packet_id,t),
  db.prepare(`UPDATE guess_luckybags SET remaining=total-COALESCE((SELECT SUM(amount) FROM guess_luckybag_allocations WHERE packet_id=?1 AND paid_at IS NOT NULL),0) WHERE packet_id=?1 AND state='allocating'`).bind(b.packet_id),
  db.prepare(`UPDATE guess_luckybags SET state='settled',settled_at=?2 WHERE packet_id=?1 AND state='allocating' AND remaining=0`).bind(b.packet_id,t),
 ])
}
export async function advanceLuckybag(db:D1Database,id:string,t=Math.floor(Date.now()/1000)){
 let b=await load(db,id);if(!b||['skipped','settled','refunded'].includes(b.state))return
 if(b.round_state!=='open'||b.ends_at<=t||b.claimed>=b.count){
  await db.prepare(`UPDATE guess_luckybags SET state=CASE WHEN state='open' THEN 'closing' ELSE 'skipped' END,ended_at=COALESCE(ended_at,?),reason=CASE WHEN state='open' THEN NULL ELSE 'ended_before_appearance' END WHERE packet_id=? AND state IN('pending','scheduled','open')`).bind(t,id).run()
  b=(await load(db,id))!
 }
 if(b.state==='pending'){
  const plan=planLuckybag(b,b.created_at,b.ends_at)
  await db.prepare(`UPDATE guess_luckybags SET state=?,total=?,due_at=?,reason=? WHERE packet_id=? AND state='pending'`).bind(plan?'scheduled':'skipped',plan?.total??0,plan?.due_at??null,plan?null:'random_skip',id).run()
  b=(await load(db,id))!
 }
 if(b.state==='scheduled'&&b.due_at!<=t){await fund(db,b,t);b=(await load(db,id))!}
 if(['closing','allocating'].includes(b.state))await settle(db,b,t)
}
export async function luckybagView(db:D1Database,id:string,uid:number){
 const b=await load(db,id);if(!b||b.funded_at===null)return null
 const people=(await db.prepare(`SELECT c.user_id,COALESCE(u.nick,u.name,u.username) AS name,u.avatar,a.amount,a.paid_at FROM (SELECT user_id FROM guess_luckybag_candidates WHERE packet_id=? ORDER BY seq LIMIT ?) c JOIN users u ON u.id=c.user_id LEFT JOIN guess_luckybag_allocations a ON a.packet_id=? AND a.user_id=c.user_id`).bind(id,b.total,id).all<{user_id:number;name:string;avatar:string|null;amount:number|null;paid_at:number|null}>()).results
 const mine=people.find(p=>p.user_id===uid),sponsor=await db.prepare('SELECT id,COALESCE(nick,name,username) AS name,avatar FROM users WHERE id=?').bind(b.sponsor_id).first()
 return {id,state:b.state,total:b.total,capacity:b.total,participants:people.length,funded_at:b.funded_at,settled_at:b.settled_at,sponsor,mine:{joined:!!mine,amount:mine?.paid_at?mine.amount:null,pending:!!mine&&b.state!=='open'&&!mine.paid_at},leaders:people.filter(p=>p.paid_at!==null).sort((a,b)=>b.amount!-a.amount!||a.user_id-b.user_id).slice(0,20)}
}
export async function runLuckybags(env:{DB:D1Database},t=Math.floor(Date.now()/1000)){
 const rows=(await env.DB.prepare(`SELECT b.packet_id FROM guess_luckybags b JOIN ldc_packets p ON p.packet_id=b.packet_id WHERE b.state IN('pending','closing','allocating') OR (b.state='scheduled' AND b.due_at<=?1) OR (b.state='open' AND p.ends_at<=?1) ORDER BY CASE b.state WHEN 'closing' THEN 0 WHEN 'allocating' THEN 1 ELSE 2 END,b.created_at LIMIT 30`).bind(t).all<{packet_id:string}>()).results
 for(const b of rows)try{await advanceLuckybag(env.DB,b.packet_id,t)}catch{console.error('guess_luckybag_retry',b.packet_id)}
}
export async function attachLuckybag(c:any,data:any,uid:number){
 if(!data?.round)return data
 const id=data.round.id||await c.env.DB.prepare('SELECT id FROM chat_redpacks WHERE message_id=?').bind(data.round.message_id).first<string>('id')
 if(!id)return data
 try{await advanceLuckybag(c.env.DB,id);return {...data,luckybag:await luckybagView(c.env.DB,id,uid)}}
 catch{console.error('guess_luckybag_view_retry',id);return {...data,luckybag_unavailable:true}}
}
