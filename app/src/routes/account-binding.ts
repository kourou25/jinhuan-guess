import {Hono} from 'hono'
import {getCookie,setCookie} from 'hono/cookie'
import type {C,Ctx} from '../types'
import {needUser} from '../services/auth'
import {boundedJson,fail} from '../lib/http'
import {sha256,randHex} from '../lib/crypto'
import {now} from '../lib/time'
import {authConfiguration,authRateLimit,authRequestGuard,requireAuthOpen} from '../services/auth-gate'
import {reserveMailToken,sendAuthMail,verifyTurnstile} from '../services/auth-email'
import {accountProof,completeEmailChange,parseEmailChange,unlinkIdentity} from '../services/account-binding'
import {hashPassword} from '../services/password'
import {changePassword} from '../services/password-change'
import {emailInput,passwordInput,turnstileInput} from '../shared/schemas'
export const accountBinding=new Hono<Ctx>()
for(const path of ['/api/auth/email/change*','/api/me/identities/*','/api/me/password'])accountBinding.use(path,async(c,next)=>{c.header('cache-control','no-store');c.header('referrer-policy','no-referrer');await next()})
const parse=<T>(fn:()=>T):T=>{try{return fn()}catch(e){return fail(400,e instanceof Error?e.message:'输入格式不对')}}
const tokenInput=(value:unknown)=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))return fail(400,'链接已失效，请重新申请');return value}
async function ready(c:C){await requireAuthOpen(c);if(!(await authConfiguration(c)).email)fail(503,'邮箱登录尚未配置')}
accountBinding.post('/api/me/password',async c=>{
 await ready(c);await authRequestGuard(c);const user=needUser(c),body=await boundedJson(c)
 const identity=await c.env.DB.prepare("SELECT i.subject,p.hash FROM identities i JOIN passwords p ON p.user_id=i.user_id WHERE i.user_id=? AND i.provider='email' AND i.verified_at IS NOT NULL").bind(user.id).first<{subject:string;hash:string}>()
 if(!identity)return fail(409,'请先关联并验证登录邮箱，再设置密码')
 const password=parse(()=>passwordInput(body.new_password,identity.subject,user.username))
 if(typeof body.confirm_password!=='string'||body.confirm_password.normalize('NFKC')!==password)fail(400,'两次输入的新密码不一致')
 const proof=await accountProof(c,user.id,body.password)
 if(!proof.passwordHash||proof.passwordHash!==identity.hash)fail(409,'账号状态已变化，请刷新后重试')
 if((body.password as string).normalize('NFKC')===password)fail(400,'新密码不能与当前密码相同')
 const sid=randHex(),ok=await changePassword(c.env.DB,{id:user.id,email:identity.subject,username:user.username,oldHash:identity.hash,newHash:await hashPassword(password,c.env.PASSWORD_PEPPER!),oldSession:proof.sessionHash,newSession:await sha256(sid),ua:c.req.header('user-agent')??'',t:now()})
 if(!ok)fail(409,'账号状态已变化，请重新登录后重试')
 setCookie(c,'sid',sid,{httpOnly:true,secure:c.req.url.startsWith('https:'),sameSite:'Lax',path:'/',maxAge:2592000})
 return c.json({ok:true})
})
accountBinding.post('/api/auth/email/change',async c=>{
 await ready(c);await authRequestGuard(c);const user=needUser(c),body=await boundedJson(c)
 await verifyTurnstile(c,parse(()=>turnstileInput(body.turnstile)),'email_change')
 const email=parse(()=>emailInput(body.email)),proof=await accountProof(c,user.id,body.password)
 const old=await c.env.DB.prepare("SELECT subject FROM identities WHERE user_id=? AND provider='email'").bind(user.id).first<{subject:string}>()
 if(old?.subject===email)fail(400,'这已经是当前登录邮箱')
 if(await c.env.DB.prepare("SELECT 1 FROM identities WHERE provider='email' AND subject=?").bind(email).first())fail(409,'这个邮箱已关联其他账号')
 const newHash=proof.passwordHash?null:await hashPassword(parse(()=>passwordInput(body.new_password,email,user.username)),c.env.PASSWORD_PEPPER!)
 const reserved=await reserveMailToken(c,{kind:'email',email,userId:user.id,ttl:1800,payload:{sessionHash:proof.sessionHash,passwordHash:proof.passwordHash,newHash,oldEmail:old?.subject??null}})
 if(!reserved)fail(429,'邮件发送太频繁，请稍后再试')
 if(!await sendAuthMail(c,email,reserved!,'email'))fail(503,'邮件暂未发送成功，请稍后重试')
 return c.json({sent:true},202)
})
accountBinding.get('/api/auth/email/change/check',async c=>{
 await ready(c);await authRateLimit(c);const user=needUser(c),sid=await sha256(getCookie(c,'sid')??'')
 const row=await c.env.DB.prepare("SELECT email,payload FROM auth_tokens WHERE token_hash=? AND kind='email' AND user_id=? AND used_at IS NULL AND expires_at>?").bind(await sha256(tokenInput(c.req.query('t'))),user.id,now()).first<{email:string;payload:string}>()
 const payload=row&&parseEmailChange(row.payload)
 return c.json({valid:!!payload&&payload.sessionHash===sid,email:payload?.sessionHash===sid?row?.email:null})
})
accountBinding.post('/api/auth/email/change/confirm',async c=>{
 await ready(c);await authRequestGuard(c);const user=needUser(c),body=await boundedJson(c)
 const result=await completeEmailChange(c.env.DB,{id:user.id,tokenHash:await sha256(tokenInput(body.t)),sessionHash:await sha256(getCookie(c,'sid')??''),t:now()})
 if(result.status==='email-taken')fail(409,'这个邮箱已关联其他账号，请重新申请换绑')
 if(result.status!=='ok')return fail(400,'链接已失效或账号状态已变化，请在发起操作的浏览器中重新申请')
 if(result.oldEmail){try{const notice=await reserveMailToken(c,{kind:'email-notice',email:result.oldEmail,userId:user.id,ttl:86400});if(notice)await sendAuthMail(c,result.oldEmail,notice,'email-notice',result.email)}catch{console.warn('email_change_notice_unavailable')}}
 return c.json({ok:true})
})
accountBinding.delete('/api/me/identities/:provider',async c=>{
 await requireAuthOpen(c);await authRequestGuard(c);const user=needUser(c),provider=c.req.param('provider')
 if(!['email','google','linuxdo'].includes(provider))fail(400,'这个登录方式不能解绑')
 const body=await boundedJson(c),proof=await accountProof(c,user.id,body.password)
 if(!await unlinkIdentity(c,user.id,provider,proof))fail(409,'至少保留一种可用登录方式；账号状态变化后请重新登录再试')
 return c.json({ok:true})
})
