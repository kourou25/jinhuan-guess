import {Hono} from 'hono'
import type {Ctx} from '../types'
import {needUser} from '../services/auth'
import {boundedJson,fail} from '../lib/http'
import {now} from '../lib/time'

export const aiImages=new Hono<Ctx>()
aiImages.use('/api/me/ai-prefs',async(c,next)=>{needUser(c);c.header('cache-control','no-store');await next()})
aiImages.get('/api/me/ai-prefs',async c=>{
 const u=needUser(c)
 const row=await c.env.DB.prepare(`SELECT CASE WHEN ai_prefs IS NULL THEN 1 WHEN json_valid(ai_prefs) THEN
  (json_type(ai_prefs,'$.img_reply') IS NULL OR json_type(ai_prefs,'$.img_reply') IN ('true','null')) ELSE 0 END AS enabled FROM users WHERE id=?`).bind(u.id).first<{enabled:number}>()
 return c.json({img_reply:!!row?.enabled})
})
aiImages.patch('/api/me/ai-prefs',async c=>{
 const u=needUser(c),body=await boundedJson(c,1024)
 if(Object.keys(body).length!==1||typeof body.img_reply!=='boolean')fail(400,'请设置图片自动回应开关')
 const t=now(),db=c.env.DB
 const statements=[db.prepare(`UPDATE users SET ai_prefs=json_set(CASE WHEN json_valid(ai_prefs) THEN
  CASE WHEN json_type(ai_prefs)='object' THEN ai_prefs ELSE '{}' END ELSE '{}' END,'$.img_reply',json(?)),updated_at=? WHERE id=?`)
  .bind(JSON.stringify(body.img_reply),t,u.id)]
 // 仅取消未领取任务；已领取任务在调用及发布前读取最新偏好。重新打开不复活已取消任务。
 if(!body.img_reply)statements.push(db.prepare("UPDATE ai_jobs SET state='skipped',err='user_disabled',updated_at=? WHERE user_id=? AND kind='img_reply' AND state='pending'").bind(t,u.id))
 await db.batch(statements)
 return c.json({img_reply:body.img_reply})
})
