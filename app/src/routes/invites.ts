import {Hono} from 'hono'
import type {Ctx} from '../types'
import {needUser,isOwner} from '../services/auth'
import {authRequestGuard,authRateLimit} from '../services/auth-gate'
import {createInvite} from '../services/invites'
import {guideLevel,rewardStatements} from '../services/invite-rewards'
import {now} from '../lib/time'
import {fail,sameOrigin} from '../lib/http'
export const invites = new Hono<Ctx>()
invites.get('/api/invites/:code',async c=>{
  await authRateLimit(c)
  const code=c.req.param('code').trim().toUpperCase()
  if(!/^[A-HJ-NP-Z2-9]{8}$/.test(code))fail(400,'邀请码格式不对')
  const row=await c.env.DB.prepare(`SELECT u.name,u.username FROM invite_codes i JOIN users u ON u.id=i.owner_id
    WHERE i.code=? AND i.used_by IS NULL AND i.revoked=0 AND i.expires_at>? AND u.disabled=0 AND u.kind='user'`).bind(code,now()).first<{name:string|null;username:string}>()
  c.header('cache-control','no-store')
  return c.json({valid:!!row,inviter:row?(row.name||row.username):null})
})
invites.get('/api/me/invites',async c=>{
  const user=needUser(c),t=now()
  const data=await c.env.DB.batch([
    c.env.DB.prepare('SELECT code,created_at,expires_at,used_by,used_at,revoked FROM invite_codes WHERE owner_id=? ORDER BY created_at DESC,code LIMIT 100').bind(user.id),
    c.env.DB.prepare(`SELECT 3+(SELECT COUNT(*) FROM invites WHERE inviter_id=?1 AND qualified_at IS NOT NULL AND revoked=0) AS total,
      (SELECT COUNT(*) FROM invite_codes WHERE owner_id=?1 AND used_by IS NOT NULL) AS used,
      (SELECT COUNT(*) FROM invite_codes WHERE owner_id=?1 AND used_by IS NULL AND revoked=0 AND expires_at>?2) AS active`).bind(user.id,t),
    c.env.DB.prepare(`SELECT i.created_at,i.qualified_at,i.revoked,u.username,u.name FROM invites i JOIN users u ON u.id=i.invitee_id
      WHERE i.inviter_id=? ORDER BY i.created_at DESC LIMIT 100`).bind(user.id),
  ])
  const n=Number((data[1].results[0] as {total:number}).total)-3
  return c.json({codes:data[0].results,quota:data[1].results[0],invited:data[2].results,reward:{count:n,level:guideLevel(n)},can_manage:!!user.is_admin||isOwner(c,user),unlimited:!!user.is_admin||isOwner(c,user),now:t})
})
invites.get('/api/admin/invites',async c=>{
 const actor=needUser(c);if(!actor.is_admin&&!isOwner(c,actor))fail(403,'只有管理员能管理邀请')
 const inviter=Number(c.req.query('inviter')||0),before=Number(c.req.query('before')||Number.MAX_SAFE_INTEGER)
 if(!Number.isSafeInteger(inviter)||!Number.isSafeInteger(before)||inviter<0||before<1)fail(400,'筛选条件不正确')
 const result=await c.env.DB.prepare(`SELECT i.*,u.username,u.name,p.username AS inviter_name,
  COALESCE(b.n,0) AS qualified_count FROM invites i JOIN users u ON u.id=i.invitee_id JOIN users p ON p.id=i.inviter_id
  LEFT JOIN user_badges b ON b.user_id=i.inviter_id AND b.badge='guide'
  WHERE (?=0 OR i.inviter_id=?) AND i.invitee_id<? ORDER BY i.invitee_id DESC LIMIT 51`).bind(inviter,inviter,before).all()
 const rows=result.results.slice(0,50);c.header('cache-control','no-store')
 return c.json({items:rows,next:result.results.length>50?rows.at(-1)!.invitee_id:null})
})
invites.delete('/api/admin/invites/:id',async c=>{
 sameOrigin(c);const actor=needUser(c);if(!actor.is_admin&&!isOwner(c,actor))fail(403,'只有管理员能作废邀请')
 const id=Number(c.req.param('id'));if(!Number.isSafeInteger(id)||id===0)fail(400,'用户编号不正确')
 const row=await c.env.DB.prepare('SELECT inviter_id FROM invites WHERE invitee_id=?').bind(id).first<{inviter_id:number}>()
 if(!row)fail(404,'邀请关系不存在')
 await c.env.DB.batch([c.env.DB.prepare('UPDATE invites SET revoked=1 WHERE invitee_id=?').bind(id),...rewardStatements(c.env.DB,[row!.inviter_id],now())])
 return c.json({ok:true})
})
invites.post('/api/invites',async c=>{
  const user=needUser(c)
  await authRequestGuard(c)
  const code=await createInvite(c.env.DB,user.id,!!user.is_admin||isOwner(c,user),now())
  if(!code)fail(409,'邀请名额已用完')
  return c.json({code,url:`${new URL(c.req.url).origin}/i/${code}`},201)
})
invites.delete('/api/invites/:code',async c=>{
  const user=needUser(c)
  await authRequestGuard(c)
  const code=c.req.param('code').toUpperCase()
  if(!/^[A-HJ-NP-Z2-9]{8}$/.test(code))fail(400,'邀请码格式不对')
  const result=await c.env.DB.prepare('UPDATE invite_codes SET revoked=1 WHERE code=? AND owner_id=? AND used_by IS NULL AND revoked=0').bind(code,user.id).run()
  if(!result.meta.changes)fail(404,'邀请码不存在或已使用')
  return c.json({ok:true})
})
