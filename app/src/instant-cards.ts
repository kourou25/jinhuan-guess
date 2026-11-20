import {ensureCoinWallet} from './farm/coin-packets'
import {raffleRoll,titleLevelSql} from './title-growth'
import {raffleTitleEnabled} from './shared/raffle-policy'
export class CardRuleError extends Error {}

export const fingerPrice=(level:number)=>Number.isInteger(level)&&level>=0&&level<5?1000+level*2000:null
export {titleChance as cardChance} from './shared/title-collection'
import {titleChance as cardChance} from './shared/title-collection'
export type CardInput={uid:number;id:string;title:string;kind:'draw'|'finger';level:number;revision:number;owner:boolean;t:number}
export type CardReceipt={id:number;user_id:number;owner_id:number;request_id:string;kind:string;title:string;price:number;finger_level:number;chance:number;won:number|null;created_at:number}
export const receiptColumns='id,user_id,owner_id,request_id,kind,title,price,finger_level,chance,won,created_at,reward_kind,reward_id,reward_amount,guaranteed'
export async function cardReceipt(db:D1Database,uid:number,id:string){return db.prepare(`SELECT ${receiptColumns} FROM instant_card_receipts WHERE user_id=? AND request_id=?`).bind(uid,id).first<CardReceipt>()}
export async function settleCard(db:D1Database,p:CardInput,roll=raffleRoll){
 if(!/^[0-9a-f-]{36}$/.test(p.id)||!['draw','finger'].includes(p.kind)||!Number.isInteger(p.level)||p.level<0||p.level>5||!Number.isInteger(p.revision)||!raffleTitleEnabled(p.title))throw new CardRuleError('抽卡参数无效')
 const compatible=(r:CardReceipt)=>{if(r.kind!==p.kind||r.title!==p.title||r.finger_level!==(p.kind==='finger'?p.level+1:p.level))throw new CardRuleError('请求标识已用于其他操作，请刷新');return r}
 const old=await cardReceipt(db,p.uid,p.id);if(old)return compatible(old)
 if(await db.prepare('SELECT 1 FROM instant_card_batches WHERE user_id=? AND request_id=?').bind(p.uid,p.id).first())throw new CardRuleError('请求标识已用于抽卡，请查看原结果')
 const pool=await db.prepare('SELECT owner_id FROM instant_card_pools WHERE title=?').bind(p.title).first<{owner_id:number}>()
 if(!pool)throw new CardRuleError('奖池不存在')
 const price=p.kind==='draw'?100:fingerPrice(p.level)
 if(price===null||p.kind==='finger'&&p.owner)throw new CardRuleError('金手指已满级')
 await ensureCoinWallet(db,p.uid,p.t);await ensureCoinWallet(db,pool.owner_id,p.t)
 const attempt=crypto.randomUUID(),level=p.kind==='finger'?p.level+1:p.level,chance=cardChance(level),won=p.kind==='draw'?(roll()<chance?1:0):null
 const effective=p.owner?'5':'COALESCE((SELECT level FROM instant_card_fingers WHERE user_id=?1),0)'
 const gate='EXISTS(SELECT 1 FROM instant_card_receipts WHERE attempt=?1)'
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO instant_card_receipts(user_id,owner_id,request_id,attempt,kind,title,price,finger_level,chance,won,created_at)
   SELECT ?1,p.owner_id,?2,?3,?4,p.title,?5,?6,?7,?8,?9 FROM instant_card_pools p JOIN coin52_wallets w ON w.user_id=?1
   JOIN users receiver ON receiver.id=p.owner_id AND receiver.disabled=0 AND receiver.kind='user'
   WHERE p.title=?10 AND p.active=1 AND p.revision=?11 AND p.owner_id=?12 AND w.balance>=?5
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=p.owner_id)
   AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN (?1,p.owner_id))
   AND EXISTS(SELECT 1 FROM users u JOIN chat_members m ON m.user_id=u.id AND m.group_id=1 WHERE u.id=?1 AND u.disabled=0 AND u.kind='user')
   AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE group_id=1 AND user_id=?1)
   AND ${effective}=?13

   AND (SELECT COUNT(*) FROM instant_card_receipts WHERE user_id=?1 AND created_at>?9-60)<30`).bind(p.uid,p.id,attempt,p.kind,price,level,chance,won,p.t,p.title,p.revision,pool.owner_id,p.level),
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT r.user_id,'card-pay',CAST(r.id AS TEXT),r.attempt||':pay',-r.price,w.balance-r.price,r.created_at FROM instant_card_receipts r JOIN coin52_wallets w ON w.user_id=r.user_id WHERE r.attempt=?`).bind(attempt),
  db.prepare(`UPDATE coin52_wallets SET balance=balance-?2,revision=revision+1,updated_at=?3 WHERE user_id=?4 AND ${gate}`).bind(attempt,price,p.t,p.uid),
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT r.owner_id,'card-income',CAST(r.id AS TEXT),r.attempt||':income',r.price,w.balance+r.price,r.created_at FROM instant_card_receipts r JOIN coin52_wallets w ON w.user_id=r.owner_id WHERE r.attempt=?`).bind(attempt),
  db.prepare(`UPDATE coin52_wallets SET balance=balance+?2,revision=revision+1,updated_at=?3 WHERE user_id=?4 AND ${gate}`).bind(attempt,price,p.t,pool.owner_id),
  db.prepare(`INSERT INTO instant_card_fingers(user_id,level,updated_at) SELECT user_id,finger_level,created_at FROM instant_card_receipts WHERE attempt=? AND kind='finger' ON CONFLICT(user_id) DO UPDATE SET level=excluded.level,updated_at=excluded.updated_at`).bind(attempt),
  db.prepare(`INSERT INTO title_awards(user_id,title,source,created_at) SELECT user_id,title,'card:'||id,created_at FROM instant_card_receipts WHERE attempt=? AND kind='draw' AND won=1`).bind(attempt),
  db.prepare(`UPDATE users SET deco=json_set(deco,'$.fn',${titleLevelSql('users.id','?2')}),updated_at=?3 WHERE id=?4 AND json_extract(deco,'$.ft')=?2 AND EXISTS(SELECT 1 FROM instant_card_receipts WHERE attempt=?1 AND kind='draw' AND won=1)`).bind(attempt,p.title,p.t,p.uid),
 ])
 const result=await cardReceipt(db,p.uid,p.id)
 if(!result)throw new CardRuleError('余额不足、奖池或金手指状态已变化、称号已满级，或操作过快；请刷新后重试')
 return compatible(result)
}
