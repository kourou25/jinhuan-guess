import type {C} from '../types'
import {fail} from '../lib/http'
import {hmacHex,randHex,sha256} from '../lib/crypto'
import {now} from '../lib/time'

export async function verifyTurnstile(c:C,token:string,action:string){
 if(!c.env.TURNSTILE_SECRET_KEY)fail(503,'人机验证尚未配置')
 const payload={secret:c.env.TURNSTILE_SECRET_KEY,response:token,remoteip:c.req.header('cf-connecting-ip'),idempotency_key:crypto.randomUUID()}
 for(let attempt=0;attempt<2;attempt++){
  let response:Response
  try{response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)})}
  catch{if(attempt===0)continue;fail(503,'验证服务暂时不可用')}
  if(response!.status>=500){if(attempt===0)continue;fail(503,'验证服务暂时不可用')}
  if(!response!.ok)fail(503,'验证服务暂时不可用')
  const result=await response!.json<{success?:boolean;hostname?:string;action?:string}>().catch(()=>null)
  if(!result?.success||result.hostname!==new URL(c.req.url).hostname||result.action!==action)fail(400,'人机验证没通过，请重试')
  return
 }
}

type MailKind='signup'|'reset'|'notice'|'email'|'email-notice'|'login-alert'
type MailToken={kind:MailKind;email:string;userId?:number;payload?:unknown;ttl:number}
// 邮箱小时配额、全站 UTC 日配额、令牌写入在同一事务预留；失败发送仍计一次尝试。
export async function reserveMailToken(c:C,input:MailToken):Promise<{token:string;hash:string}|null>{
 const t=now(),token=randHex(),hash=await sha256(token),day=new Date(t*1000).toISOString().slice(0,10),hour=new Date(t*1000).toISOString().slice(0,13)
 const scope='mail:'+await hmacHex(c.env.PASSWORD_PEPPER!,input.email)
 const limit=Number(c.env.EMAIL_DAILY_MAX??80)
 if(!Number.isSafeInteger(limit)||limit<1||limit>10000)fail(503,'邮件额度配置不正确')
 const claimed='EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=?)'
 const alert=input.kind==='login-alert'
 const alertGuard=alert?` AND COALESCE((SELECT SUM(n) FROM quota_usage WHERE scope='login-failure' AND key=?12 AND day>?13 AND day<=?14),0)>50
   AND COALESCE((SELECT n FROM quota_usage WHERE day=?8 AND scope='mail:login-alert' AND key=?12),0)=0
   AND EXISTS(SELECT 1 FROM identities i JOIN users u ON u.id=i.user_id WHERE u.id=?12 AND u.disabled=0 AND u.kind='user' AND i.provider='email' AND i.subject=?4 AND i.verified_at IS NOT NULL)`:''
 const params=[hash,input.kind,input.userId??null,input.email,JSON.stringify(input.payload??null),t+input.ttl,t,day,limit,hour,scope]
 if(alert)params.push(input.userId??null,new Date((t-3600)*1000).toISOString(),new Date(t*1000).toISOString())
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO auth_tokens(token_hash,kind,user_id,email,payload,expires_at,created_at)
   SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE COALESCE((SELECT n FROM quota_usage WHERE day=?8 AND scope='mail' AND key=0),0)<?9
   AND COALESCE((SELECT n FROM quota_usage WHERE day=?10 AND scope=?11 AND key=0),0)<3${alertGuard}`)
   .bind(...params),
  c.env.DB.prepare(`INSERT INTO quota_usage(day,scope,key,n) SELECT ?,'mail',0,1 WHERE ${claimed}
   ON CONFLICT(day,scope,key) DO UPDATE SET n=n+1`).bind(day,hash),
  c.env.DB.prepare(`INSERT INTO quota_usage(day,scope,key,n) SELECT ?,?,0,1 WHERE ${claimed}
   ON CONFLICT(day,scope,key) DO UPDATE SET n=n+1`).bind(hour,scope,hash),
  ...(alert?[c.env.DB.prepare(`INSERT INTO quota_usage(day,scope,key,n) SELECT ?,'mail:login-alert',?,1 WHERE ${claimed}
   ON CONFLICT(day,scope,key) DO UPDATE SET n=n+1`).bind(day,input.userId!,hash)]:[]),
 ])
 return result[0].meta.changes?{token,hash}:null
}
export async function sendAuthMail(c:C,email:string,reserved:{token:string;hash:string},kind:MailKind,changedEmail?:string){
 if(!c.env.RESEND_API_KEY||!c.env.MAIL_FROM)fail(503,'邮件服务尚未配置')
 const origin=new URL(c.req.url).origin
 const link=kind==='signup'?`${origin}/auth/email/verify?t=${reserved.token}`:kind==='reset'?`${origin}/reset?t=${reserved.token}`:kind==='email'?`${origin}/auth/email/change?t=${reserved.token}`:`${origin}/login`
 const subject=kind==='login-alert'?'有人在尝试登录你的尽欢账号':kind==='signup'?'确认加入尽欢':kind==='reset'?'重设尽欢密码':kind==='email'?'确认尽欢登录邮箱':'尽欢账号提醒'
 const masked=changedEmail?.replace(/^(.).*(@.*)$/,'$1***$2')??'新邮箱'
 const text=kind==='login-alert'?`过去一小时，有人多次尝试登录你的尽欢账号，但密码验证未通过。\n\n如果不是你本人操作，请检查账号设备并重设密码：\n${origin}/me/account\n${origin}/reset\n\n这封提醒不表示对方已成功登录。每天最多发送一次。`:kind==='signup'?`点击链接后确认完成注册（24 小时内有效）：\n${link}\n\n如果不是你本人操作，忽略这封邮件即可。`:kind==='reset'?`点击链接设置新密码（30 分钟内有效）：\n${link}\n\n如果不是你本人操作，忽略这封邮件即可。`:kind==='email'?`请在发起操作的浏览器中打开链接，确认登录邮箱（30 分钟内有效）：\n${link}\n\n如果不是你本人操作，忽略这封邮件即可。`:kind==='email-notice'?`你的尽欢登录邮箱已改为 ${masked}。如果不是你本人操作，请立即用其他登录方式进入账号并联系站长：\n${link}`:`有人用你的邮箱注册尽欢。如果是你，请直接登录或找回密码：\n${link}\n\n如果不是你本人操作，忽略这封邮件即可。`
 try{
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${c.env.RESEND_API_KEY}`,'content-type':'application/json','idempotency-key':`auth-${reserved.hash}`},body:JSON.stringify({from:c.env.MAIL_FROM,to:[email],subject,text}),signal:AbortSignal.timeout(15000)})
  if(!response.ok){console.warn('auth_mail_failed',response.status);return false}
  return true
 }catch{console.warn('auth_mail_unavailable');return false}
}
