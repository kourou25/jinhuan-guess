import {Hono} from 'hono'
import {getCookie} from 'hono/cookie'
import type {Ctx} from '../types'
import {needUser} from '../services/auth'
import {boundedJson,fail,sameOrigin} from '../lib/http'
import {sha256} from '../lib/crypto'
import {now} from '../lib/time'
import {pushConfigured,validPushEndpoint,validPushKey} from '../services/web-push'

export const webPush=new Hono<Ctx>()
webPush.use('/api/push/*',async(c,next)=>{needUser(c);c.header('cache-control','no-store');await next()})
webPush.get('/api/push/config',async c=>c.json({available:pushConfigured(c.env),public_key:pushConfigured(c.env)?c.env.PUSH_VAPID_PUBLIC_KEY:null}))
webPush.post('/api/push/subscription',async c=>{
 sameOrigin(c);const user=needUser(c),body=await boundedJson(c,4096)
 if(!pushConfigured(c.env))fail(503,'设备通知尚未配置')
 const keys=body.keys as Record<string,unknown>|undefined
 if(!validPushEndpoint(body.endpoint)||!keys||!validPushKey(keys.p256dh,65)||!validPushKey(keys.auth,16))return fail(400,'设备订阅无效或推送平台暂不支持')
 const id=await sha256(body.endpoint),sid=await sha256(getCookie(c,'sid')??''),t=now()
 const row=await c.env.DB.prepare(`INSERT INTO web_push_subscriptions(id,user_id,session_id,endpoint,p256dh,auth,next_check_at,last_message_id,updated_at)
 SELECT ?1,?2,?3,?4,?5,?6,?7,(SELECT COALESCE(MAX(id),0) FROM chat_messages),?7
 WHERE EXISTS(SELECT 1 FROM sessions WHERE id=?3 AND user_id=?2 AND expires_at>?7)
 AND ((SELECT COUNT(*) FROM web_push_subscriptions WHERE user_id=?2)<10 OR EXISTS(SELECT 1 FROM web_push_subscriptions WHERE id=?1 AND user_id=?2))
 ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,session_id=excluded.session_id,endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth=excluded.auth,enabled=1,failures=0,updated_at=excluded.updated_at,
 last_message_id=CASE WHEN web_push_subscriptions.user_id=excluded.user_id THEN web_push_subscriptions.last_message_id ELSE excluded.last_message_id END
 RETURNING id`).bind(id,user.id,sid,body.endpoint,keys.p256dh,keys.auth,t).first()
 if(!row)fail(409,'设备数量已达上限或登录已过期，请在账号安全中清理旧会话后重试')
 return c.json({ok:true})
})
webPush.post('/api/push/status',async c=>{
 sameOrigin(c);const user=needUser(c),body=await boundedJson(c,4096)
 if(!validPushEndpoint(body.endpoint))return fail(400,'设备订阅无效')
 const id=await sha256(body.endpoint),sid=await sha256(getCookie(c,'sid')??'')
 const row=await c.env.DB.prepare('SELECT enabled,failures FROM web_push_subscriptions WHERE id=? AND user_id=? AND session_id=?').bind(id,user.id,sid).first<{enabled:number;failures:number}>()
 return c.json({enabled:!!row?.enabled,failed:!!row?.failures,binding:row?.enabled?await sha256(sid+id):null})
})
webPush.delete('/api/push/subscription',async c=>{
 sameOrigin(c);const user=needUser(c),body=await boundedJson(c,4096)
 if(!validPushEndpoint(body.endpoint))return fail(400,'设备订阅无效')
 await c.env.DB.prepare('DELETE FROM web_push_subscriptions WHERE id=? AND user_id=? AND session_id=?').bind(await sha256(body.endpoint),user.id,await sha256(getCookie(c,'sid')??'')).run()
 return c.json({ok:true})
})
