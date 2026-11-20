import {guessMembersSql,guessBansSql} from '../services/guess-access'
import type {C,User} from '../types'
import type {NativePacket} from './packets'
import {fail} from '../lib/http'
import {sha256} from '../lib/crypto'
import {now} from '../lib/time'
import {ensureCoinWallet} from '../farm/coin-packets'

// All predicates are repeated inside the transfer transaction, including the source message.
const eligible=`EXISTS(SELECT 1 FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id
 JOIN ${guessMembersSql} cm ON cm.group_id=m.group_id AND cm.user_id=?2
 JOIN users s ON s.id=?2 JOIN users o ON o.id=?3
 WHERE r.id=?1 AND m.deleted=0 AND m.created_at>=cm.joined_at AND s.id<>o.id
 AND s.disabled=0 AND s.silenced=0 AND s.kind='user' AND o.disabled=0 AND o.kind='user'
 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(?2,?3))
 AND NOT EXISTS(SELECT 1 FROM ${guessBansSql} WHERE group_id=m.group_id AND user_id=?2)
 AND NOT EXISTS(SELECT 1 FROM user_limits WHERE user_id=?2 AND s.is_admin=0 AND kind='chat' AND (until=0 OR until>unixepoch()))
 AND (EXISTS(SELECT 1 FROM ldc_packets p JOIN ldc_awards a ON a.packet_id=p.packet_id WHERE p.packet_id=r.id AND p.owner_id=?3 AND p.mode IN('guess','clues') AND a.recipient_id=?2 AND a.purpose='winner')
 OR EXISTS(SELECT 1 FROM guess_free_rounds p WHERE p.packet_id=r.id AND p.owner_id=?3 AND p.winner_id=?2)))`
async function assertEligible(c:C,p:NativePacket,u:User){
 if(!await c.env.DB.prepare('SELECT 1 WHERE '+eligible).bind(p.packet_id,u.id,p.owner_id).first())fail(403,'仅本轮猜中者可自愿打赏有效的出题人')
}
export async function guessTipView(c:C,p:NativePacket,u:User){
 await assertEligible(c,p,u);await ensureCoinWallet(c.env.DB,u.id,now())
 const rows=await c.env.DB.batch<Record<string,unknown>>([
  c.env.DB.prepare('SELECT balance FROM coin52_wallets WHERE user_id=?').bind(u.id),
  c.env.DB.prepare('SELECT amount,created_at FROM guess_tips WHERE packet_id=? AND sender_id=? ORDER BY created_at DESC LIMIT 10').bind(p.packet_id,u.id),
 ])
 return {balance:Number(rows[0].results[0]?.balance||0),currency:'D币',recent:rows[1].results}
}
function tipInput(b:Record<string,unknown>){
 const amount=b.amount,nonce=String(b.nonce||'')
 if(b.confirm!==true)fail(400,'请确认从本人钱包支付打赏金额')
 if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<1||amount>10000||!/^[-a-f0-9]{36}$/i.test(nonce))fail(400,'请输入1–10000整数D币及有效请求编号')
 return {amount,nonce}
}
// A sender can reconcile their own completed transfer even after leaving the group.
export async function priorGuessTip(c:C,uid:number,mid:number,b:Record<string,unknown>){
 const {nonce}=tipInput(b)
 const packet=await c.env.DB.prepare('SELECT id FROM chat_redpacks WHERE message_id=?').bind(mid).first<{id:string}>()
 if(!packet)return null
 const id=await sha256(`guess-tip:${packet.id}:${uid}:${nonce}`)
 const prior=await c.env.DB.prepare('SELECT amount FROM guess_tips WHERE id=? AND sender_id=?').bind(id,uid).first<{amount:number}>()
 return prior?{sent:true,id,amount:prior.amount,duplicate:true}:null
}
export async function sendGuessTip(c:C,p:NativePacket,u:User,b:Record<string,unknown>){
 const {amount,nonce}=tipInput(b)
 const db=c.env.DB,id=await sha256(`guess-tip:${p.packet_id}:${u.id}:${nonce}`),t=now()
 const prior=await db.prepare('SELECT amount FROM guess_tips WHERE id=?').bind(id).first<{amount:number}>()
 if(prior)return {sent:true,id,amount:prior.amount,duplicate:true}
 await assertEligible(c,p,u)
 await ensureCoinWallet(db,u.id,t);await ensureCoinWallet(db,p.owner_id,t)
 const attempt=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM guess_tips WHERE attempt=?)'
 const result=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO guess_tips(id,packet_id,sender_id,recipient_id,amount,attempt,created_at)
   SELECT ?4,?1,?2,?3,?5,?6,?7 WHERE ${eligible}
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?2 AND balance>=?5)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?3 AND balance<=9007199254740991-?5) RETURNING id`)
   .bind(p.packet_id,u.id,p.owner_id,id,amount,attempt,t),
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT user_id,CASE WHEN user_id=? THEN 'guess-tip-send' ELSE 'guess-tip-receive' END,?,?,
   CASE WHEN user_id=? THEN -? ELSE ? END,balance+CASE WHEN user_id=? THEN -? ELSE ? END,?
   FROM coin52_wallets WHERE user_id IN(?,?) AND ${gate}`).bind(u.id,id,attempt,u.id,amount,amount,u.id,amount,amount,t,u.id,p.owner_id,attempt),
  db.prepare(`UPDATE coin52_wallets SET balance=balance+CASE WHEN user_id=? THEN -? ELSE ? END,revision=revision+1,updated_at=?
   WHERE user_id IN(?,?) AND ${gate}`).bind(u.id,amount,amount,t,u.id,p.owner_id,attempt),
 ])
 if(!result[0].results.length){const row=await db.prepare('SELECT amount FROM guess_tips WHERE id=?').bind(id).first<{amount:number}>();if(row)return {sent:true,id,amount:row.amount,duplicate:true};fail(409,'余额不足或账号状态已变化，本次转账未完成','guess_tip_not_sent')}
 return {sent:true,id,amount,duplicate:false}
}
