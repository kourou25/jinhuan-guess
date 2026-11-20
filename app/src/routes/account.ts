import {Hono} from 'hono'
import {getCookie,deleteCookie} from 'hono/cookie'
import type {Ctx} from '../types'
import {needUser} from '../services/auth'
import {sha256} from '../lib/crypto'
import {fail,sameOrigin,boundedJson} from '../lib/http'
import {now} from '../lib/time'
import {authConfiguration,linuxdoBindingConfigured,authRequestGuard,requireAuthOpen} from '../services/auth-gate'
import {handleInput} from '../shared/schemas'
import {changeHandle} from '../services/account-handle'
export const account=new Hono<Ctx>()
account.get('/api/me/account',async c=>{
 const user=needUser(c)
 const identities=await c.env.DB.prepare('SELECT provider,email,username,verified_at,created_at FROM identities WHERE user_id=? ORDER BY provider').bind(user.id).all()
 const password=await c.env.DB.prepare('SELECT 1 FROM passwords WHERE user_id=?').bind(user.id).first()
 const config=await authConfiguration(c)
 const handle=await c.env.DB.prepare('SELECT handle_at,handle_setup_pending FROM users WHERE id=?').bind(user.id).first<{handle_at:number|null;handle_setup_pending:number}>()
 c.header('cache-control','no-store')
 return c.json({username:user.username,handle_at:handle?.handle_at,handle_setup_pending:!!handle?.handle_setup_pending,can_change_password:config.email&&!!password&&identities.results.some(i=>i.provider==='email'&&i.verified_at!=null),can_change_handle:config.open&&!identities.results.some(i=>i.provider==='linuxdo'),identities:identities.results,has_password:!!password,can_bind_linuxdo:linuxdoBindingConfigured(c)&&config.open,can_bind_google:config.google,can_bind_email:config.email,can_unlink:config.open&&!!c.env.AUTH_RL&&(c.env.PASSWORD_PEPPER?.length??0)>=32})
})
account.patch('/api/me/handle',async c=>{
 await authRequestGuard(c);const user=needUser(c);await requireAuthOpen(c)
 const body=await boundedJson(c,1024)
 let handle:string
 try{handle=handleInput(body.handle,(c.env.ADMIN_USERNAMES??'').split(',').map(x=>x.trim()))}catch(error){return fail(400,(error as Error).message)}
 const result=await changeHandle(c.env.DB,user.id,await sha256(getCookie(c,'sid')??''),handle,now())
 if(result.status==='session')fail(401,'登录状态已变化，请重新登录')
 if(result.status==='linuxdo')fail(403,'用户名跟随 Linux.DO，请到 Linux.DO 修改')
 if(result.status==='cooldown')fail(409,'用户名每 30 天可修改一次')
 if(result.status==='taken')fail(409,'这个用户名已被占用或属于历史作者')
 c.header('cache-control','no-store');return c.json({ok:true,username:handle})
})
account.get('/api/me/sessions',async c=>{
 const user=needUser(c),current=await sha256(getCookie(c,'sid')??'')
 const rows=await c.env.DB.prepare(`SELECT substr(id,1,12) AS id,method,ua,created_at,seen_at,id=? AS current FROM sessions
  WHERE user_id=? AND expires_at>? ORDER BY current DESC,seen_at DESC LIMIT 100`).bind(current,user.id,now()).all()
 c.header('cache-control','no-store')
 return c.json({sessions:rows.results})
})
account.delete('/api/me/sessions',async c=>{
 sameOrigin(c);const user=needUser(c)
 await c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id).run()
 deleteCookie(c,'sid',{path:'/'})
 return c.json({ok:true,current:true})
})
account.delete('/api/me/sessions/:id',async c=>{
 sameOrigin(c);const user=needUser(c),prefix=c.req.param('id')
 if(!/^[a-f0-9]{12}$/.test(prefix))fail(400,'会话编号不正确')
 const current=await sha256(getCookie(c,'sid')??'')
 // 前缀罕见碰撞时拒绝删除，避免一次操作退出两台设备。
 const result=await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id=?1 AND substr(id,1,12)=?2
  AND (SELECT COUNT(*) FROM sessions WHERE user_id=?1 AND substr(id,1,12)=?2)=1 RETURNING id`).bind(user.id,prefix).first<{id:string}>()
 if(!result)fail(404,'会话不存在或编号不唯一，请刷新后重试')
 const self=result!.id===current
 if(self)deleteCookie(c,'sid',{path:'/'})
 return c.json({ok:true,current:self})
})
