import {Hono} from 'hono'
import {setCookie} from 'hono/cookie'
import type {C,Ctx} from '../types'
import {boundedJson,fail} from '../lib/http'
import {hmacHex,randHex,sha256} from '../lib/crypto'
import {now} from '../lib/time'
import {ownerNames} from '../services/auth'
import {authConfiguration,authRateLimit,authRequestGuard,requireAuthOpen} from '../services/auth-gate'
import {reserveMailToken,sendAuthMail,verifyTurnstile} from '../services/auth-email'
import {hashPassword,verifyPassword} from '../services/password'
import {completeSignup} from '../services/accounts'
import {completePasswordReset} from '../services/password-reset'
import {recordLoginFailure} from '../services/login-failure'
import {startEmailSession} from '../services/email-login'
import {emailInput,invitationInput,passwordInput,registrationInput,turnstileInput} from '../shared/schemas'

export const authEmail=new Hono<Ctx>()
authEmail.use('/api/auth/*',async(c,next)=>{c.header('cache-control','no-store');c.header('referrer-policy','no-referrer');await next()})
const parse=<T>(fn:()=>T):T=>{try{return fn()}catch(error){return fail(400,error instanceof Error?error.message:'输入格式不对')}}
const tokenInput=(value:unknown)=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail(400,'链接已失效，请重新申请');return value as string}
const setSession=(c:C,sid:string)=>setCookie(c,'sid',sid,{httpOnly:true,secure:c.req.url.startsWith('https:'),sameSite:'Lax',path:'/',maxAge:2592000})
async function emailReady(c:C){
 await requireAuthOpen(c)
 if(!(await authConfiguration(c)).email)fail(503,'邮箱登录尚未配置')
}
const validInvite=(c:C,code:string)=>c.env.DB.prepare(`SELECT 1 FROM invite_codes i JOIN users u ON u.id=i.owner_id WHERE code=? AND used_by IS NULL AND revoked=0 AND expires_at>? AND u.disabled=0 AND u.kind='user'`).bind(code,now()).first()

authEmail.post('/api/auth/register',async c=>{
 await emailReady(c);await authRequestGuard(c)
 const body=await boundedJson(c)
 await verifyTurnstile(c,parse(()=>turnstileInput(body.turnstile)),'register')
 const input=parse(()=>registrationInput(body,ownerNames(c.env),c.env.REGISTER_MODE!=='open'))
 if(input.invite&&!(await validInvite(c,input.invite)))fail(400,'邀请码已失效，请换一个')
 const occupied=await c.env.DB.prepare('SELECT 1 FROM users WHERE username=?1 COLLATE NOCASE UNION ALL SELECT 1 FROM memes WHERE author_name=?1 COLLATE NOCASE LIMIT 1').bind(input.handle).first()
 if(occupied)fail(409,'这个用户名已被占用')
 const existing=await c.env.DB.prepare("SELECT 1 FROM identities WHERE provider='email' AND subject=?").bind(input.email).first()
 const kind=existing?'notice':'signup'
 const pw=existing?null:await hashPassword(input.password,c.env.PASSWORD_PEPPER!)
 const reserved=await reserveMailToken(c,{kind,email:input.email,payload:existing?undefined:{handle:input.handle,nick:input.nick,pw,invite:input.invite},ttl:86400})
 if(!reserved)fail(429,'邮件发送太频繁，请稍后再试')
 if(!(await sendAuthMail(c,input.email,reserved!,kind)))fail(503,'邮件暂未发送成功，请稍后重试')
 return c.json({sent:true},202)
})
authEmail.get('/api/auth/token/check',async c=>{
 await requireAuthOpen(c);await authRateLimit(c)
 const token=tokenInput(c.req.query('t')),kind=c.req.query('kind')
 if(kind!=='signup'&&kind!=='reset')fail(400,'链接类型不正确')
 const row=await c.env.DB.prepare('SELECT 1 FROM auth_tokens WHERE token_hash=? AND kind=? AND used_at IS NULL AND expires_at>?').bind(await sha256(token),kind,now()).first()
 c.header('cache-control','no-store')
 return c.json({valid:!!row})
})
authEmail.post('/api/auth/email/verify',async c=>{
 await emailReady(c);await authRequestGuard(c)
 const body=await boundedJson(c),token=tokenInput(body.t)
 const invite=body.invite===undefined?undefined:parse(()=>invitationInput(body.invite,false))
 const sid=randHex()
 const result=await completeSignup(c.env.DB,{tokenHash:await sha256(token),invite,inviteRequired:c.env.REGISTER_MODE!=='open',now:now(),sessionHash:await sha256(sid),userAgent:c.req.header('user-agent')??''})
 if(result.status==='invalid-token')fail(400,'链接已失效，请重新注册')
 if(result.status==='invalid-invite')fail(409,'邀请码已失效，请换一个再确认')
 if(result.status==='handle-taken')fail(409,'用户名已被占用，请重新注册')
 if(result.status==='email-taken')fail(409,'这个邮箱已经注册，请直接登录')
 setSession(c,sid)
 return c.json({ok:true,next:'/welcome'})
})
authEmail.post('/api/auth/login',async c=>{
 await emailReady(c);await authRequestGuard(c)
 const body=await boundedJson(c)
 await verifyTurnstile(c,parse(()=>turnstileInput(body.turnstile)),'login')
 const email=parse(()=>emailInput(body.email))
 // 登录只校验长度，弱口令规则更新不能锁住已有账号。
 if(typeof body.password!=='string'||[...body.password.normalize('NFKC')].length>128||[...body.password.normalize('NFKC')].length<8)fail(400,'邮箱或密码不对')
 const user=await c.env.DB.prepare(`SELECT u.id,u.disabled,u.kind,p.hash FROM identities i JOIN users u ON u.id=i.user_id LEFT JOIN passwords p ON p.user_id=u.id WHERE i.provider='email' AND i.subject=?`).bind(email).first<{id:number;disabled:number;kind:string;hash:string|null}>()
 const ip=await hmacHex(c.env.PASSWORD_PEPPER!,c.req.header('cf-connecting-ip')??'local'),t=now()
 const prior=user?await c.env.DB.prepare('SELECT locked_until FROM login_fails WHERE user_id=? AND ip_hash=?').bind(user.id,ip.slice(0,16)).first<{locked_until:number}>():null
 if(prior&&prior.locked_until>t)fail(429,'试错太多次，请稍后重试或找回密码')
 // 固定合法格式确保不存在的邮箱也执行一次同强度 PBKDF2。
 const dummy='pbkdf2_sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$p1'
 const verified=await verifyPassword(body.password as string,user?.hash??dummy,c.env.PASSWORD_PEPPER!)
 if(!verified||!user||!user.hash){
  if(user){
   await recordLoginFailure(c.env.DB,user.id,ip.slice(0,16),t)
   c.executionCtx.waitUntil((async()=>{
    try{
     const reserved=await reserveMailToken(c,{kind:'login-alert',email,userId:user.id,ttl:86400})
     if(reserved)await sendAuthMail(c,email,reserved,'login-alert')
    }catch{console.warn('login_alert_unavailable')}
   })())
  }
  fail(401,'邮箱或密码不对')
 }
 if(user!.disabled||user!.kind!=='user')fail(403,'账号已停用，请联系管理员')
 const sid=randHex(),sidHash=await sha256(sid)
 const ok=await startEmailSession(c.env.DB,{id:user!.id,email,passwordHash:user!.hash!,sessionHash:sidHash,t,ua:c.req.header('user-agent')??'',ipHash:ip.slice(0,16)})
 if(!ok)fail(409,'账号状态已变更，请重新登录')
 setSession(c,sid);return c.json({ok:true})
})
authEmail.post('/api/auth/reset/request',async c=>{
 await emailReady(c);await authRequestGuard(c)
 const body=await boundedJson(c)
 await verifyTurnstile(c,parse(()=>turnstileInput(body.turnstile)),'reset')
 const email=parse(()=>emailInput(body.email))
 const user=await c.env.DB.prepare("SELECT u.id FROM identities i JOIN users u ON u.id=i.user_id WHERE i.provider='email' AND i.subject=? AND u.disabled=0 AND u.kind='user'").bind(email).first<{id:number}>()
 if(user){const reserved=await reserveMailToken(c,{kind:'reset',email,userId:user.id,ttl:1800});if(reserved)await sendAuthMail(c,email,reserved,'reset')}
 return c.json({sent:true},202)
})
authEmail.post('/api/auth/reset/confirm',async c=>{
 await emailReady(c);await authRequestGuard(c)
 const body=await boundedJson(c),tokenHash=await sha256(tokenInput(body.token))
 const row=await c.env.DB.prepare("SELECT t.email,u.username FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.kind='reset' AND t.used_at IS NULL AND t.expires_at>?").bind(tokenHash,now()).first<{email:string;username:string}>()
 if(!row)fail(400,'链接已失效，请重新找回密码')
 const password=parse(()=>passwordInput(body.password,row!.email,row!.username)),sid=randHex()
 const ok=await completePasswordReset(c.env.DB,{tokenHash,hash:await hashPassword(password,c.env.PASSWORD_PEPPER!),sessionHash:await sha256(sid),now:now(),userAgent:c.req.header('user-agent')??''})
 if(!ok)fail(400,'链接已失效或账号已停用')
 setSession(c,sid);return c.json({ok:true})
})
