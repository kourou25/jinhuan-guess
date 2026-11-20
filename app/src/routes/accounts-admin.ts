import {Hono} from 'hono'
import type {Ctx} from '../types'
import {needUser,isOwner} from '../services/auth'
import {boundedJson,fail} from '../lib/http'
import {now} from '../lib/time'
export const accountsAdmin=new Hono<Ctx>()
accountsAdmin.put('/api/admin/users/:id/disabled',async c=>{
  const actor=needUser(c)
  if(!isOwner(c,actor))fail(403,'只有站长能停用或启用账号')
  const id=Number(c.req.param('id'))
  if(!Number.isSafeInteger(id)||id===0)fail(400,'用户编号不正确')
  if(isOwner(c,{id}))fail(400,'不能停用站长账号')
  const body=await boundedJson(c)
  if(body.disabled!==true&&body.disabled!==false)fail(400,'请选择停用或启用')
  const target=await c.env.DB.prepare("SELECT id FROM users WHERE id=? AND kind='user'").bind(id).first()
  if(!target)fail(404,'没有这个用户')
  const disabled=body.disabled?1:0,t=now()
  const statements=[c.env.DB.prepare('UPDATE users SET disabled=?,updated_at=? WHERE id=?').bind(disabled,t,id)]
  if(disabled)statements.push(
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id),
    c.env.DB.prepare('UPDATE api_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(t,id),
  )
  await c.env.DB.batch(statements)
  return c.json({ok:true,disabled:!!disabled})
})
