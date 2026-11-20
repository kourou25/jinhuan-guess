import {getCookie, setCookie} from 'hono/cookie'
import type {C} from '../types'
import {getSetting} from './settings'
import {hmacHex,verifyHmac} from '../lib/crypto'
import {now} from '../lib/time'
import {fail,sameOrigin} from '../lib/http'

export async function authOpen(c: C): Promise<boolean> {
  const mode = await getSetting(c.env.DB, 'auth.open', 'preview')
  if (mode === 'on') return true
  if (mode !== 'preview' || (c.env.PASSWORD_PEPPER?.length ?? 0) < 32) return false
  const token = getCookie(c,'auth_preview') ?? ''
  const [expiry,signature] = token.split('.')
  if (!/^\d{10}$/.test(expiry ?? '') || !signature || Number(expiry) <= now() || Number(expiry) > now()+86400) return false
  return verifyHmac(c.env.PASSWORD_PEPPER!,`auth-preview|${expiry}`,signature)
}
export async function requireAuthOpen(c: C) {
  if (!(await authOpen(c))) fail(403, '新登录方式即将开放', 'auth_soon')
}
export async function issueAuthPreview(c: C) {
  if ((c.env.PASSWORD_PEPPER?.length ?? 0) < 32) fail(503, '请先配置密码保护密钥')
  const expiry = now()+86400
  const signature = await hmacHex(c.env.PASSWORD_PEPPER!,`auth-preview|${expiry}`)
  setCookie(c,'auth_preview',`${expiry}.${signature}`,{httpOnly:true,secure:c.req.url.startsWith('https:'),sameSite:'Lax',path:'/',maxAge:86400})
}
export async function authConfiguration(c: C) {
  const open = await authOpen(c)
  const pepper = (c.env.PASSWORD_PEPPER?.length ?? 0) >= 32
  const email = !!(pepper && c.env.RESEND_API_KEY && c.env.MAIL_FROM && c.env.TURNSTILE_SITE_KEY && c.env.TURNSTILE_SECRET_KEY && c.env.AUTH_RL)
  const google = !!(pepper && c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET && c.env.AUTH_RL)
  return {open,email:open&&email,google:open&&google,register_mode:c.env.REGISTER_MODE==='open'?'open':'invite',turnstile_site_key:open&&email?c.env.TURNSTILE_SITE_KEY:null}
}
export function linuxdoBindingConfigured(c:C) {
  return !!(c.env.LINUXDO_CLIENT_ID && c.env.LINUXDO_CLIENT_SECRET && c.env.AUTH_RL && (c.env.PASSWORD_PEPPER?.length??0)>=32)
}
export async function authRequestGuard(c: C) {
  sameOrigin(c)
  await authRateLimit(c)
}
export async function authRateLimit(c:C) {
  if (!c.env.AUTH_RL || (c.env.PASSWORD_PEPPER?.length ?? 0) < 32) fail(503, '登录服务尚未配置')
  const ip = c.req.header('cf-connecting-ip') ?? 'local'
  const key = await hmacHex(c.env.PASSWORD_PEPPER!,`auth-rate|${c.req.path}|${ip}`)
  if (!(await c.env.AUTH_RL!.limit({key})).success) fail(429, '操作太频繁，请稍后重试')
}
