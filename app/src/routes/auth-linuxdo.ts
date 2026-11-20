import {Hono} from 'hono'
import {getCookie,setCookie,deleteCookie} from 'hono/cookie'
import type {C,Ctx} from '../types'
import {randHex,sha256,hmacHex,verifyHmac} from '../lib/crypto'
import {safeNext,fail} from '../lib/http'
import {now} from '../lib/time'
import {needUser} from '../services/auth'
import {authRequestGuard,requireAuthOpen,linuxdoBindingConfigured} from '../services/auth-gate'
import {completeLinuxdo,type LinuxdoIntent,type LinuxdoProfile} from '../services/linuxdo'
import {mergeAccountSnapshot,issueMergeConfirmation} from '../services/account-merge-token'

const CONNECT='https://connect.linux.do'
export const authLinuxdo=new Hono<Ctx>()
authLinuxdo.use('/auth/*',async(c,next)=>{c.header('cache-control','no-store');c.header('referrer-policy','no-referrer');await next()})

async function begin(c:C,intent:LinuxdoIntent) {
  if(!c.env.LINUXDO_CLIENT_ID || !c.env.LINUXDO_CLIENT_SECRET)fail(503,'Linux.DO 登录尚未配置')
  if(c.env.AUTH_RL){
    const key=await hmacHex(c.env.LINUXDO_CLIENT_SECRET,'linuxdo-start|'+(c.req.header('cf-connecting-ip')??'local'))
    if(!(await c.env.AUTH_RL.limit({key})).success)fail(429,'操作太频繁，请稍后重试')
  }
  const token=randHex(32),t=now()
  if(intent.intent==='bind'){
    const snapshot=await mergeAccountSnapshot(c.env.DB,intent.userId)
    if(!snapshot)fail(409,'账号状态已变化，请重新登录')
    intent={...intent,mergeTargetSnapshot:snapshot!}
  }
  // 旧 Linux.DO 登录不依赖新增 pepper，保持现有配置下可登录。签名以用途隔离。
  const state=token+'.'+await hmacHex(c.env.LINUXDO_CLIENT_SECRET,'linuxdo-state|'+token)
  await c.env.DB.prepare("INSERT INTO auth_tokens(token_hash,kind,user_id,payload,expires_at,created_at) VALUES(?,'oauth_linuxdo',?,?,?,?)")
    .bind(await sha256(token),intent.intent==='bind'?intent.userId:null,JSON.stringify(intent),t+600,t).run()
  setCookie(c,'oauth_state',state,{httpOnly:true,secure:c.req.url.startsWith('https:'),sameSite:'Lax',path:'/auth',maxAge:600})
  const url=new URL(CONNECT+'/oauth2/authorize')
  url.searchParams.set('response_type','code');url.searchParams.set('client_id',c.env.LINUXDO_CLIENT_ID)
  url.searchParams.set('redirect_uri',new URL('/auth/callback',c.req.url).toString());url.searchParams.set('state',state)
  return url.toString()
}
function rejected(c:C,message:string,bind=false,status:400|403|502=400) {
  const action=bind?'/me/account':'/login',label=bind?'返回账号安全':'重新登录'
  return c.html(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>授权未完成 · 尽欢</title><body style="font:16px/1.7 system-ui;max-width:440px;margin:15vh auto;padding:24px"><h1 style="font-size:22px">授权未完成</h1><p>${message.replace(/[<>&]/g,'')}</p><a href="${action}">${label}</a></body></html>`,status)
}
authLinuxdo.get('/auth/login',async c=>{
 const raw=(c.req.query('invite')??getCookie(c,'inv')??'').trim().toUpperCase()
 const invite=/^[A-HJ-NP-Z2-9]{8}$/.test(raw)?raw:''
 return c.redirect(await begin(c,{intent:'login',next:safeNext(c.req.query('next')),invite}))
})
authLinuxdo.post('/api/me/bind/linuxdo',async c=>{
  await authRequestGuard(c);const user=needUser(c);await requireAuthOpen(c)
  if(!linuxdoBindingConfigured(c))fail(503,'账号绑定尚未配置')
  c.header('cache-control','no-store')
  return c.json({url:await begin(c,{intent:'bind',next:'/me/account',userId:user.id,sessionHash:await sha256(getCookie(c,'sid')??'')})})
})
authLinuxdo.get('/auth/callback',async c=>{
  const state=getCookie(c,'oauth_state')??''
  deleteCookie(c,'oauth_state',{path:'/auth'})
  const [token,signature,...extra]=state.split('.')
  if(!/^[a-f0-9]{64}$/.test(token??'') || extra.length || state!==c.req.query('state') || !signature || !c.env.LINUXDO_CLIENT_SECRET
    || !await verifyHmac(c.env.LINUXDO_CLIENT_SECRET,'linuxdo-state|'+token,signature))return rejected(c,'授权状态已过期，请重新发起。')
  const tokenHash=await sha256(token)
  const pending=await c.env.DB.prepare("SELECT payload FROM auth_tokens WHERE token_hash=? AND kind='oauth_linuxdo' AND used_at IS NULL AND expires_at>?")
    .bind(tokenHash,now()).first<{payload:string}>()
  if(!pending)return rejected(c,'授权状态已使用或过期，请重新发起。')
  const intent=JSON.parse(pending.payload) as LinuxdoIntent
  const bind=intent.intent==='bind'
  if(intent.intent!=='login' && !bind)return rejected(c,'授权状态不正确。')
  if(bind){
    const user=c.get('user'),sessionHash=await sha256(getCookie(c,'sid')??'')
    if(!user || user.id!==intent.userId || sessionHash!==intent.sessionHash)return rejected(c,'登录账号或设备会话已变化，请回到账号安全重新绑定。',true,403)
    await requireAuthOpen(c)
    if(!linuxdoBindingConfigured(c))return rejected(c,'账号绑定尚未配置。',true,403)
  }
  if(c.req.query('error'))return rejected(c,'已取消 Linux.DO 授权。',bind)
  const code=c.req.query('code')
  if(!code)return rejected(c,'缺少授权码，请重新发起。',bind)
  try {
  const tokenRes=await fetch(CONNECT+'/oauth2/token',{signal:AbortSignal.timeout(15000),method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',authorization:'Basic '+btoa(`${c.env.LINUXDO_CLIENT_ID}:${c.env.LINUXDO_CLIENT_SECRET}`),accept:'application/json'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:new URL('/auth/callback',c.req.url).toString()})})
  if(!tokenRes.ok)return rejected(c,'Linux.DO 暂时无法完成授权，请稍后重试。',bind,502)
  const access=await tokenRes.json<{access_token?:string}>()
  if(typeof access.access_token!=='string' || !access.access_token)return rejected(c,'Linux.DO 返回的授权信息不完整。',bind,502)
  const userRes=await fetch(CONNECT+'/api/user',{headers:{authorization:'Bearer '+access.access_token},signal:AbortSignal.timeout(15000)})
  if(!userRes.ok)return rejected(c,'暂时无法获取 Linux.DO 账号信息。',bind,502)
  const p=await userRes.json<Record<string,unknown>>()
  if(p.active===false)return rejected(c,'请先激活 Linux.DO 账号。',bind,403)
  // 外站用户名不套用邮箱自建账号的保留词/ASCII 限制，兼容存量账号。
  if(typeof p.id!=='number' || !Number.isSafeInteger(p.id) || p.id<=0 || typeof p.username!=='string' || !p.username.trim() || p.username.length>100 || /[\u0000-\u001f\u007f]/.test(p.username))return rejected(c,'Linux.DO 返回的账号信息不正确。',bind,502)
  let avatar=typeof p.avatar_url==='string'?p.avatar_url:typeof p.avatar_template==='string'?p.avatar_template.replace('{size}','144'):null
  if(avatar?.startsWith('/'))avatar='https://linux.do'+avatar
  if(avatar && !/^https:\/\//.test(avatar))avatar=null
  const profile:LinuxdoProfile={id:p.id,username:p.username,name:typeof p.name==='string'?p.name.slice(0,100):null,avatar,trustLevel:typeof p.trust_level==='number' && Number.isInteger(p.trust_level)?Math.max(0,Math.min(4,p.trust_level)):0,silenced:p.silenced?1:0}
  const sid=randHex(32)
  const result=await completeLinuxdo(c.env.DB,{tokenHash,intent,profile,now:now(),sessionHash:await sha256(sid),userAgent:c.req.header('user-agent')??'',ownerIds:(c.env.ADMIN_USER_IDS??'').split(',').filter(s=>/^-?\d+$/.test(s.trim())).map(Number)})
  if(result.status!=='ok'){
    if(result.status==='identity-in-use'&&intent.intent==='bind'&&!profile.silenced){
      const merge=await issueMergeConfirmation(c.env.DB,{targetId:intent.userId,sessionHash:intent.sessionHash,
        provider:'linuxdo',subject:String(profile.id),oauthHash:tokenHash,now:now(),
        ownerIds:(c.env.ADMIN_USER_IDS??'').split(',').filter(s=>/^-?\d+$/.test(s.trim())).map(Number)})
      if(merge)return c.redirect('/me/account?merge='+merge)
    }
    const messages={disabled:'账号已停用，请联系管理员。','identity-in-use':'这个 Linux.DO 已关联另一账号，请先使用原账号登录。','already-bound':'当前账号已关联另一个 Linux.DO，请保留现有关联。','invalid-state':'授权状态已变化或过期，请重新发起。'}
    return rejected(c,messages[result.status],bind,403)
  }
  if(bind)return c.redirect('/me/account?bound=linuxdo')
  deleteCookie(c,'inv',{path:'/'})
  setCookie(c,'sid',sid,{httpOnly:true,secure:c.req.url.startsWith('https:'),sameSite:'Lax',path:'/',maxAge:2592000})
  return c.redirect(safeNext(intent.next))
  } catch {
    // 绑定失败回到账号页，避免错误恢复被转换成另一个账号的普通登录。
    console.warn('linuxdo_callback_unavailable')
    return rejected(c,'授权服务暂时不可用，请稍后重试。',bind,502)
  }
})
