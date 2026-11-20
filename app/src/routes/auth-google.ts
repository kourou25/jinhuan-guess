import {Hono} from 'hono'
import {getCookie,setCookie,deleteCookie} from 'hono/cookie'
import type {C,Ctx} from '../types'
import {now} from '../lib/time'
import {boundedJson,fail,safeNext} from '../lib/http'
import {randHex,sha256,hmacHex,verifyHmac} from '../lib/crypto'
import {needUser,ownerNames} from '../services/auth'
import {authConfiguration,authRateLimit,authRequestGuard,requireAuthOpen} from '../services/auth-gate'
import {invitationInput} from '../shared/schemas'
import {mergeAccountSnapshot,issueMergeConfirmation} from '../services/account-merge-token'
import {pkceChallenge,profileFromGoogleToken,completeGoogleIdentity,completeGoogleSignup,googleHandle,parseGooglePending,type GoogleIntent,type GooglePending} from '../services/google'

export const authGoogle=new Hono<Ctx>()
for(const path of ['/auth/google/*','/api/auth/google/*','/api/me/bind/google'])authGoogle.use(path,async(c,next)=>{c.header('cache-control','no-store');c.header('referrer-policy','no-referrer');await next()})
const parseInvite=(value:unknown)=>{try{return invitationInput(value)}catch{return fail(400,'邀请码格式不对')}}
async function googleReady(c:C){await requireAuthOpen(c);if(!(await authConfiguration(c)).google)fail(503,'Google 登录尚未配置')}
const session=(c:C,sid:string)=>setCookie(c,'sid',sid,{httpOnly:true,secure:c.req.url.startsWith('https:'),sameSite:'Lax',path:'/',maxAge:2592000})
const welcome=(next:string)=>next==='/'?'/welcome':'/welcome?next='+encodeURIComponent(safeNext(next))
function rejected(c:C,message:string,bind=false,status:400|403|409|502=400){
  return c.html(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Google 授权未完成 · 尽欢</title><body style="font:16px/1.7 system-ui;max-width:440px;margin:15vh auto;padding:24px"><h1 style="font-size:22px">Google 授权未完成</h1><p>${message.replace(/[<>&]/g,'')}</p><a href="${bind?'/me/account':'/login'}">${bind?'返回账号安全':'返回登录'}</a></body></html>`,status)
}
const messages={disabled:'账号已停用，请联系管理员。','identity-in-use':'这个 Google 已关联另一账号，请使用原账号登录。','already-bound':'当前账号已关联另一个 Google。','invalid-state':'授权状态已变化，请重新发起。','invalid-token':'授权已过期，请重新用 Google 登录。','invalid-invite':'邀请码已失效，请换一个。','handle-taken':'用户名暂时被占用，请重试。','email-taken':'这个邮箱已经注册过，请先用邮箱密码登录，再到账号安全关联 Google。'}
type State=GoogleIntent & {nonce:string;verifier:string}
async function begin(c:C,intent:GoogleIntent){
  const raw=randHex(),nonce=randHex(16),verifier=randHex(),t=now()
  if(intent.intent==='bind'){
    const snapshot=await mergeAccountSnapshot(c.env.DB,intent.userId)
    if(!snapshot)fail(409,'账号状态已变化，请重新登录')
    intent={...intent,mergeTargetSnapshot:snapshot!}
  }
  const state=raw+'.'+await hmacHex(c.env.PASSWORD_PEPPER!,'google-state|'+raw)
  await c.env.DB.prepare("INSERT INTO auth_tokens(token_hash,kind,user_id,payload,expires_at,created_at) VALUES(?,'oauth_google',?,?,?,?)")
    .bind(await sha256(raw),intent.intent==='bind'?intent.userId:null,JSON.stringify({...intent,nonce,verifier}),t+600,t).run()
  setCookie(c,'g_state',state,{httpOnly:true,secure:c.req.url.startsWith('https:'),sameSite:'Lax',path:'/auth/google',maxAge:600})
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth')
  for(const [key,value] of Object.entries({client_id:c.env.GOOGLE_CLIENT_ID!,redirect_uri:new URL('/auth/google/callback',c.req.url).toString(),response_type:'code',scope:'openid email profile',state,nonce,code_challenge:await pkceChallenge(verifier),code_challenge_method:'S256'}))url.searchParams.set(key,value)
  return url.toString()
}
authGoogle.get('/auth/google/start',async c=>{
  await googleReady(c);await authRateLimit(c)
  return c.redirect(await begin(c,{intent:'login',next:safeNext(c.req.query('next')),invite:parseInvite(c.req.query('invite')??getCookie(c,'inv')??'')}))
})
authGoogle.post('/api/me/bind/google',async c=>{
  await authRequestGuard(c);const user=needUser(c);await googleReady(c)
  return c.json({url:await begin(c,{intent:'bind',next:'/me/account',userId:user.id,sessionHash:await sha256(getCookie(c,'sid')??'')})})
})
async function complete(c:C,raw:string,invite?:string){
  const sid=randHex()
  const result=await completeGoogleSignup(c.env.DB,{tokenHash:await sha256(raw),invite,required:c.env.REGISTER_MODE!=='open',t:now(),sessionHash:await sha256(sid),ua:c.req.header('user-agent')??'',owners:ownerNames(c.env)})
  if(result.status==='ok'||result.status==='created'){
    session(c,sid);deleteCookie(c,'g_pend',{path:'/'});deleteCookie(c,'inv',{path:'/'})
    return {status:'ok' as const,next:result.created?welcome(result.next):safeNext(result.next)}
  }
  return result
}
authGoogle.get('/auth/google/callback',async c=>{
  await googleReady(c)
  const state=getCookie(c,'g_state')??'';deleteCookie(c,'g_state',{path:'/auth/google'})
  const [raw,signature,...extra]=state.split('.')
  if(!/^[a-f0-9]{64}$/.test(raw??'')||!signature||extra.length||state!==c.req.query('state')||!await verifyHmac(c.env.PASSWORD_PEPPER!,'google-state|'+raw,signature))return rejected(c,'授权状态已过期，请重新发起。')
  const tokenHash=await sha256(raw),row=await c.env.DB.prepare("SELECT payload FROM auth_tokens WHERE token_hash=? AND kind='oauth_google' AND used_at IS NULL AND expires_at>?").bind(tokenHash,now()).first<{payload:string}>()
  if(!row)return rejected(c,'授权状态已使用或过期，请重新发起。')
  const intent=JSON.parse(row.payload) as State,bind=intent.intent==='bind'
  if(bind){
    if(c.get('user')?.id!==intent.userId||await sha256(getCookie(c,'sid')??'')!==intent.sessionHash)return rejected(c,'登录账号或设备会话已变化，请重新绑定。',true,403)
  }else if(intent.intent!=='login')return rejected(c,'授权状态不正确。')
  if(c.req.query('error'))return rejected(c,'已取消 Google 授权。',bind)
  const code=c.req.query('code');if(!code)return rejected(c,'缺少授权码，请重新发起。',bind)
  try{
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.env.GOOGLE_CLIENT_ID!,client_secret:c.env.GOOGLE_CLIENT_SECRET!,code,grant_type:'authorization_code',redirect_uri:new URL('/auth/google/callback',c.req.url).toString(),code_verifier:intent.verifier})})
    if(!response.ok)return rejected(c,'Google 暂时无法完成授权，请稍后重试。',bind,502)
    const token=await response.json<{id_token?:unknown}>(),t=now(),profile=profileFromGoogleToken(token.id_token,c.env.GOOGLE_CLIENT_ID!,intent.nonce,t),sid=randHex()
    const result=await completeGoogleIdentity(c.env.DB,{tokenHash,kind:'oauth_google',intent,profile,t,sessionHash:await sha256(sid),ua:c.req.header('user-agent')??''})
    if(result.status==='ok'){
      if(bind)return c.redirect('/me/account?bound=google')
      session(c,sid);deleteCookie(c,'g_pend',{path:'/'});return c.redirect(safeNext(intent.next))
    }
    if(result.status==='identity-in-use'&&intent.intent==='bind'){
      const merge=await issueMergeConfirmation(c.env.DB,{targetId:intent.userId,sessionHash:intent.sessionHash,
        provider:'google',subject:profile.sub,oauthHash:tokenHash,now:t,
        ownerIds:(c.env.ADMIN_USER_IDS??'').split(',').filter(s=>/^-?\d+$/.test(s.trim())).map(Number)})
      if(merge)return c.redirect('/me/account?merge='+merge)
    }
    if(result.status!=='new')return rejected(c,messages[result.status],bind,403)
    if(bind)return rejected(c,'请重新发起账号绑定。',true,403)
    const pending=randHex(),pendingHash=await sha256(pending),claim=crypto.randomUUID()
    const payload:GooglePending={...profile,handle:await googleHandle(c.env.DB,profile,ownerNames(c.env)),nick:profile.name,next:safeNext(intent.next),invite:intent.invite}
    const reserved=await c.env.DB.batch([
      c.env.DB.prepare("UPDATE auth_tokens SET used_at=?,claim_id=? WHERE token_hash=? AND kind='oauth_google' AND used_at IS NULL AND expires_at>?").bind(t,claim,tokenHash,t),
      c.env.DB.prepare(`INSERT INTO auth_tokens(token_hash,kind,email,payload,expires_at,created_at)
        SELECT ?,'gpending',?,?,?,? WHERE EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=? AND claim_id=?)`).bind(pendingHash,profile.email,JSON.stringify(payload),t+600,t,tokenHash,claim),
    ])
    if(reserved[0].meta.changes!==1)return rejected(c,'授权状态已使用，请重新发起。')
    setCookie(c,'g_pend',pending,{httpOnly:true,secure:c.req.url.startsWith('https:'),sameSite:'Lax',path:'/',maxAge:600})
    const signup=await complete(c,pending)
    if(signup.status==='ok')return c.redirect(signup.next)
    if(signup.status==='invalid-invite')return c.redirect('/i')
    return rejected(c,messages[signup.status],false,signup.status==='email-taken'?409:403)
  }catch{
    console.warn('google_callback_unavailable')
    return rejected(c,'Google 授权信息暂不可用，请重新发起。',bind,502)
  }
})
function pendingCookie(c:C){const value=getCookie(c,'g_pend')??'';if(!/^[a-f0-9]{64}$/.test(value))fail(400,messages['invalid-token']);return value}
authGoogle.get('/api/auth/google/pending',async c=>{
  await googleReady(c);await authRateLimit(c)
  const row=await c.env.DB.prepare("SELECT email,payload FROM auth_tokens WHERE token_hash=? AND kind='gpending' AND used_at IS NULL AND expires_at>?").bind(await sha256(pendingCookie(c)),now()).first<{email:string|null;payload:string}>()
  if(!row)fail(400,messages['invalid-token'])
  const payload=parseGooglePending(row!.payload)
  if(!payload)return fail(400,messages['invalid-token'])
  return c.json({valid:true,name:payload.name,email:row!.email,invite:payload.invite,required:c.env.REGISTER_MODE!=='open'})
})
authGoogle.post('/api/auth/google/complete',async c=>{
  await googleReady(c);await authRequestGuard(c)
  const body=await boundedJson(c),invite=parseInvite(body.invite)
  const result=await complete(c,pendingCookie(c),invite)
  if(result.status==='ok')return c.json({ok:true,next:result.next})
  if(result.status==='invalid-token'||result.status==='invalid-state'){deleteCookie(c,'g_pend',{path:'/'});fail(400,messages[result.status])}
  if(result.status==='disabled')fail(403,messages.disabled)
  fail(409,messages[result.status])
})
