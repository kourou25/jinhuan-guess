import {Hono} from 'hono'
import type {Ctx,C} from '../types'
import {needUser} from '../services/auth'
import {boundedJson,fail,sameOrigin} from '../lib/http'
import {now} from '../lib/time'
import {sha256} from '../lib/crypto'
import {seal} from '../ldc/core'
import {identity,ready} from '../ldc/packets'
import {fishCapacity} from '../ldc/fish-capacity'
import {fundingAccount} from '../ldc/funding'
import {fishBalance} from '../ldc/fish'
export const fishFunding=new Hono<Ctx>()
async function mutation(c:C){const u=needUser(c);sameOrigin(c);ready(c);c.header('cache-control','no-store');const id=await identity(c,u.id),t=now();const r=await c.env.DB.prepare(`INSERT INTO quota_usage(day,scope,key,n) VALUES('fish-binding',?,?,1) ON CONFLICT(day,scope,key) DO UPDATE SET n=n+1 WHERE n<3 RETURNING n`).bind(String(Math.floor(t/60)),String(u.id)).first();if(!r)fail(429,'请一分钟后再试');return {u,id,t}}
fishFunding.get('/api/me/fish',async c=>{
 const u=needUser(c);c.header('cache-control','no-store')
 const a=await c.env.DB.prepare('SELECT enabled,username,updated_at FROM fish_accounts WHERE user_id=?').bind(u.id).first<{enabled:number;username:string;updated_at:number}>()
 let balance=null,balance_error=null
 if(a?.enabled&&c.env.LDC_ENCRYPTION_KEY){try{const {revision,...value}=await fishCapacity(c,await fundingAccount(c,u.id,'fish'));balance=value}catch(e){balance_error=e instanceof Error?e.message:'Fish 余额暂不可用'}}
 return c.json({balance,balance_error,configured:!!c.env.LDC_ENCRYPTION_KEY,bound:!!a,enabled:!!a?.enabled,username:a?.username||null,destination:'balance',updated_at:a?.updated_at||null})
})
fishFunding.post('/api/me/fish',async c=>{
 const {u,id,t}=await mutation(c),b=await boundedJson(c,4096),key=String(b.api_key??'').trim()
 if(b.authorize!==true)fail(400,'请确认授权本人 Fish 积分发放及本人提交的猜词下注结算')
 if(!/^hbk_[A-Za-z0-9_-]{16,240}$/.test(key))fail(400,'请输入 Fish 开放接口的 hbk_ API Key')
 let check:Awaited<ReturnType<typeof fishBalance>>;try{check=await fishBalance(key)}catch(e){return fail(400,(e as Error).message)}
 if(check.owner.userId!==id.subject||check.owner.username!==id.username)fail(403,'该 Fish Key 不属于当前绑定的 Linux.DO 账号')
 if(!check.canTransfer)fail(409,check.reason||'Fish 尚未允许此账号转账，请检查 PLUS 状态')
 const latest=await identity(c,u.id);if(latest.subject!==id.subject||latest.username!==id.username)fail(409,'登录身份已变化，请刷新后重新绑定')
 const client='fish-'+await sha256(key),box=await seal(ready(c),'fish-account:'+u.id+':'+client,key)
 const saved=await c.env.DB.prepare(`INSERT INTO fish_accounts(user_id,client_id,secret_box,subject,username,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM identities WHERE provider='linuxdo' AND user_id=? AND subject=? AND username=? AND verified_at IS NOT NULL)
  ON CONFLICT(user_id) DO UPDATE SET client_id=excluded.client_id,secret_box=excluded.secret_box,subject=excluded.subject,username=excluded.username,enabled=1,updated_at=excluded.updated_at
  WHERE fish_accounts.client_id=excluded.client_id OR (NOT EXISTS(SELECT 1 FROM guess_fish_orders o WHERE o.payer_id=fish_accounts.user_id AND (o.state NOT IN('accepted','rejected') OR o.kind='return' AND o.state<>'accepted'))
  AND NOT EXISTS(SELECT 1 FROM guess_fish_pools f JOIN guess_prediction_pools p ON p.packet_id=f.packet_id WHERE f.custodian_id=fish_accounts.user_id AND p.state='open')
  AND NOT EXISTS(SELECT 1 FROM ldc_packets p WHERE p.owner_id=? AND p.payment_provider='fish' AND
   ((p.state='open' AND p.ends_at>?) OR EXISTS(SELECT 1 FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.state IN('reserved','sent','unknown','rejected')))))
  RETURNING user_id`).bind(u.id,client,box,id.subject,id.username,t,t,u.id,id.subject,id.username,u.id,t).first().catch(()=>fail(409,'该 Fish Key 已绑定其他账号或当前账号状态已变化，无法保存'))
 if(!saved)fail(409,'Fish 红包或猜词积分奖池尚有未结束、未核清的原单，请处理后再更换 Key；可用同一 Key 重新启用')
 return c.json({saved:true,available:check.available,username:check.owner.username})
})
fishFunding.post('/api/me/fish/disable',async c=>{
 const {u,t}=await mutation(c)
 await c.env.DB.batch([c.env.DB.prepare('UPDATE fish_accounts SET enabled=0,updated_at=? WHERE user_id=?').bind(t,u.id),
  c.env.DB.prepare("UPDATE packet_draws SET settled_at=? WHERE settled_at IS NULL AND draw_at>? AND packet_id IN(SELECT packet_id FROM ldc_packets WHERE owner_id=? AND payment_provider='fish' AND state='open')").bind(t,t,u.id),
  c.env.DB.prepare("UPDATE ldc_packets SET state='closed' WHERE owner_id=? AND payment_provider='fish' AND state='open'").bind(u.id)])
 return c.json({disabled:true,in_flight_may_complete:true})
})
