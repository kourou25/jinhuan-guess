import { Hono } from 'hono'
import {setCookie} from 'hono/cookie'
import type {StatusCode} from 'hono/utils/http-status'
import type { Ctx } from '../types'
import { needUser, isOwner, canManageAi } from '../services/auth'
import { fail, jsonBody } from '../lib/http'
import { getSetting, setSetting } from '../services/settings'
import {authConfiguration,issueAuthPreview} from '../services/auth-gate'

export const platform = new Hono<Ctx>()
platform.get('/api/auth/config',async c=>{c.header('cache-control','no-store');return c.json(await authConfiguration(c))})
platform.post('/api/admin/auth-preview',async c=>{
  if(!isOwner(c,needUser(c)))fail(403,'只有站长能启用预览')
  await issueAuthPreview(c)
  return c.json({ok:true})
})
platform.get('/api/admin/flags', async c => {
  const user = needUser(c)
  if (!canManageAi(c,user)) fail(403, '只有管理员能查看设置')
  return c.json({owner: isOwner(c, user), can_manage_ai:canManageAi(c,user), flags: {
    'ui.next': JSON.parse(await getSetting(c.env.DB, 'ui.next', '[]')),
    plan: await getSetting(c.env.DB, 'plan', 'free'),
  }})
})
platform.put('/api/admin/flags', async c => {
  if (!isOwner(c, needUser(c))) fail(403, '只有站长能修改全站设置')
  const body = await jsonBody<{key?: unknown; value?: unknown}>(c)
  if (body.key !== 'plan' || (body.value !== 'free' && body.value !== 'paid')) fail(400, '设置值无效')
  await setSetting(c.env.DB, 'plan', body.value as string)
  return c.json({ok:true})
})
for (const path of ['/admin/ai','/admin/invites','/admin/flags','/me/invites','/me/account','/me/account/email','/me/account/password','/login','/register','/reset','/auth/email/verify','/auth/email/change','/i/:code','/i','/welcome']) platform.get(path, async c => {
  if(path==='/i/:code'){
    const code=(c.req.param('code')??'').toUpperCase()
    if(/^[A-HJ-NP-Z2-9]{8}$/.test(code))setCookie(c,'inv',code,{httpOnly:true,secure:c.req.url.startsWith('https:'),sameSite:'Lax',path:'/',maxAge:86400})
  }
  const url = new URL(c.req.url)
  url.pathname = '/app.html'; url.search = ''
  const response = await c.env.ASSETS.fetch(new Request(url))
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'no-store')
  headers.set('referrer-policy','no-referrer')
  return c.newResponse(response.body, {status:response.status as StatusCode, headers})
})
