import type {C} from '../types'
import {fail} from '../lib/http'
import {money} from './core'
import {fishBalance} from './fish'
import {fundingSecret,type FundingAccount} from './funding'

const minor=(s:string)=>{const [a,b='']=s.split('.');return Number(a)*100+Number(b.padEnd(2,'0'))}
// Two indexed ranges: active promises and expired orders whose payment is still unresolved.
export async function fishCapacity(c:C,a:FundingAccount){
 const local=await c.env.DB.prepare(`SELECT COALESCE((SELECT revision FROM fish_capacity_versions WHERE owner_id=?1),0) revision,
  COALESCE((SELECT SUM(reserved_cents) FROM fish_packet_capacity INDEXED BY idx_fish_capacity_active WHERE owner_id=?1 AND client_id=?2 AND ends_at>unixepoch()),0)
  +COALESCE((SELECT SUM(unpaid_cents) FROM fish_packet_capacity INDEXED BY idx_fish_capacity_unpaid WHERE owner_id=?1 AND client_id=?2 AND ends_at<=unixepoch() AND unpaid_cents>0),0)
  +COALESCE((SELECT SUM(o.amount_cents) FROM guess_fish_orders o WHERE o.payer_id=?1 AND o.client_id=?2 AND o.kind='collect' AND o.state NOT IN('accepted','rejected')),0)
  +COALESCE((SELECT SUM(CASE WHEN o.kind='collect' AND o.state<>'rejected' THEN o.amount_cents WHEN o.kind='return' AND o.state='accepted' THEN -o.amount_cents ELSE 0 END)
    FROM guess_fish_pools f JOIN guess_prediction_bets b ON b.packet_id=f.packet_id JOIN guess_fish_orders o ON o.bet_id=b.id
    WHERE f.custodian_id=?1 AND f.client_id=?2),0) committed`).bind(a.user_id,a.client_id).first<{revision:number;committed:number}>()
 const result=await fishBalance(await fundingSecret(c,a))
 const owner=await c.env.DB.prepare("SELECT subject,username FROM identities WHERE user_id=? AND provider='linuxdo' AND verified_at IS NOT NULL").bind(a.user_id).first<{subject:string;username:string}>()
 if(!owner||owner.subject!==result.owner.userId||owner.username!==result.owner.username)fail(403,'Fish Key 与当前 Linux.DO 身份不一致，请重新核对绑定')
 if(!result.quotaKnown||result.dailyLimit!==null&&result.usedToday===null)fail(503,'Fish 未返回完整的今日额度，暂不能确认发包能力，请稍后刷新')
 const available=minor(result.available),dailyRemaining=result.dailyLimit===null?null:Math.max(0,minor(result.dailyLimit)-minor(result.usedToday!)),limit=Math.min(available,dailyRemaining??available)
 return {available:money(available),daily_remaining:dailyRemaining===null?null:money(dailyRemaining),committed:money(local!.committed),capacity:money(result.canTransfer?Math.max(0,limit-local!.committed):0),can_transfer:result.canTransfer,reason:result.reason,checked_at:Math.floor(Date.now()/1000),revision:local!.revision}
}
export async function checkFishCapacity(c:C,a:FundingAccount,required:number){
 let result:Awaited<ReturnType<typeof fishCapacity>>
 try{result=await fishCapacity(c,a)}catch(error){if(error instanceof Error&&'status'in error)throw error;return fail(503,'Fish 余额暂时无法查询，请稍后刷新；本次未创建红包')}
 if(!result.can_transfer)fail(409,result.reason||'Fish 暂未允许转账，请检查账户状态')
 if(required>minor(result.capacity))fail(409,`Fish 当前可新增 ${result.capacity} LDC，本次需 ${money(required)} LDC（含追加上限）；余额 ${result.available}，本站待发占用 ${result.committed}${result.daily_remaining===null?'':`，今日额度剩余 ${result.daily_remaining}`}。请调整金额或补充余额后重试`)
 return result
}
export async function fishCreationGuard(c:C,a:FundingAccount,required:number,id:string){
 if(a.payment_provider!=='fish')return []
 const result=await checkFishCapacity(c,a,required)
 // A payout or another creation after the balance snapshot invalidates it. The guard
 // is inside the message/packet transaction, so stale concurrent requests leave no rows.
 return [c.env.DB.prepare(`INSERT INTO fish_capacity_checks(owner_id,expected_revision)
  SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM ldc_packets WHERE packet_id=?)`).bind(a.user_id,result.revision,id)]
}
