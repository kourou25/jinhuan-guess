import {Hono} from 'hono'
import {getCookie,setCookie} from 'hono/cookie'
import type {Ctx} from '../types'
import {boundedJson,fail} from '../lib/http'
import {sha256,randHex} from '../lib/crypto'
import {now} from '../lib/time'
import {needUser} from '../services/auth'
import {requireAuthOpen,authRateLimit,authRequestGuard,authConfiguration,linuxdoBindingConfigured} from '../services/auth-gate'
import {readMergeConfirmation,parseMergePayload} from '../services/account-merge-token'
import {accountProof} from '../services/account-binding'
import {completeAccountMerge} from '../services/account-merge'

export const accountMerge=new Hono<Ctx>()
accountMerge.use('/api/me/merge',async(c,next)=>{c.header('cache-control','no-store');c.header('referrer-policy','no-referrer');await next()})
const tokenValue=(value:unknown)=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail(409,'合并确认已失效，请重新绑定','merge_invalid');return value as string}
accountMerge.post('/api/me/merge',async c=>{
 const user=needUser(c);await requireAuthOpen(c);await authRequestGuard(c)
 const body=await boundedJson(c),tokenHash=await sha256(tokenValue(body.token)),proof=await accountProof(c,user.id,body.password)
 const config=await authConfiguration(c),sid=randHex()
 const ok=await completeAccountMerge(c.env.DB,{targetId:user.id,tokenHash,proof,now:now(),newSessionHash:await sha256(sid),
  ua:c.req.header('user-agent')??'',ownerIds:(c.env.ADMIN_USER_IDS??'').split(',').filter(s=>/^-?\d+$/.test(s.trim())).map(Number),
  enabledProviders:[...(config.google?['google']:[]),...(linuxdoBindingConfigured(c)?['linuxdo']:[])]})
 if(!ok)fail(409,'合并确认已失效，请重新绑定','merge_invalid')
 setCookie(c,'sid',sid,{httpOnly:true,secure:true,sameSite:'Lax',path:'/',maxAge:2592000})
 return c.json({ok:true})
})
accountMerge.get('/api/me/merge',async c=>{
 const user=needUser(c);await requireAuthOpen(c);await authRateLimit(c)
 const tokenHash=await sha256(tokenValue(c.req.query('token'))),sessionHash=await sha256(getCookie(c,'sid')??'')
 const pending=await readMergeConfirmation(c.env.DB,{targetId:user.id,sessionHash,tokenHash,now:now(),
  ownerIds:(c.env.ADMIN_USER_IDS??'').split(',').filter(s=>/^-?\d+$/.test(s.trim())).map(Number)})
 if(!pending)fail(409,'合并确认已失效，请重新绑定','merge_invalid')
 const p=pending!.payload
 if(p.provider==='google'?!(await authConfiguration(c)).google:!linuxdoBindingConfigured(c))fail(503,'账号绑定尚未配置')
 const source=JSON.parse(p.sourceSnapshot),target=JSON.parse(p.targetSnapshot)
 return c.json({valid:true,source:{id:p.sourceId,username:source.username},target:{id:user.id,username:target.username},
  providers:source.identities.map((i:{provider:string})=>i.provider)})
})
accountMerge.delete('/api/me/merge',async c=>{
 const user=needUser(c);await requireAuthOpen(c);await authRequestGuard(c)
 const body=await boundedJson(c),tokenHash=await sha256(tokenValue(body.token)),sessionHash=await sha256(getCookie(c,'sid')??'')
 const row=await c.env.DB.prepare("SELECT payload FROM auth_tokens WHERE token_hash=? AND kind='merge' AND user_id=? AND used_at IS NULL")
  .bind(tokenHash,user.id).first<{payload:string}>(),p=row&&parseMergePayload(row.payload)
 if(!row||!p||p.sessionHash!==sessionHash)fail(409,'合并确认已失效','merge_invalid')
 const t=now(),result=await c.env.DB.prepare(`UPDATE auth_tokens SET used_at=? WHERE token_hash=? AND kind='merge' AND user_id=? AND payload=? AND used_at IS NULL
   AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>?)`)
  .bind(t,tokenHash,user.id,row!.payload,sessionHash,user.id,t).run()
 if(result.meta.changes!==1)fail(409,'合并确认已失效','merge_invalid')
 return c.json({ok:true})
})
