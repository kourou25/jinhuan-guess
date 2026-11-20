import webpush from 'web-push'
import type {Env} from '../env'
import {sha256} from '../lib/crypto'

export function pushConfigured(env:Env){return !!(env.PUSH_VAPID_PUBLIC_KEY&&env.PUSH_VAPID_PRIVATE_KEY)}
// Exact provider hosts only. Never follow a redirect supplied by a subscription.
export function validPushEndpoint(value:unknown):value is string{
 if(typeof value!=='string'||value.length>2048)return false
 try{
  const u=new URL(value)
  return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&!u.hash&&u.pathname.length>1&&
   (u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname==='web.push.apple.com'||/^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname))
 }catch{return false}
}
export function validPushKey(value:unknown,bytes:number):value is string{
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]+={0,2}$/.test(value))return false
 try{const raw=atob(value.replaceAll('-','+').replaceAll('_','/'));return raw.length===bytes&&(bytes!==65||raw.charCodeAt(0)===4)}catch{return false}
}
type Device={id:string;user_id:number;session_id:string;endpoint:string;p256dh:string;auth:string;failures:number;last_message_id:number}
// Each group is an indexed suffix lookup, not a COUNT over the chat history.
// Mutes suppress ordinary messages; existing @username behavior is preserved.
export const PUSH_UNREAD_SQL=`SELECT cm.group_id,
 (SELECT m.id FROM chat_messages m WHERE m.group_id=cm.group_id
  AND m.id>MAX(cm.last_read,p.last_message_id) AND m.created_at>=cm.joined_at
  AND m.deleted=0 AND m.user_id<>p.user_id
  AND (cm.muted=0 OR (instr(lower(m.body),lower('@'||u.username))>0 AND COALESCE(json_extract(CASE WHEN json_valid(u.notif_prefs) THEN u.notif_prefs ELSE '{}' END,'$.chat_at'),1)<>0))
  ORDER BY m.id DESC LIMIT 1) AS message_id
 FROM web_push_subscriptions p JOIN users u ON u.id=p.user_id
 JOIN sessions s ON s.id=p.session_id AND s.user_id=p.user_id
 JOIN chat_members cm ON cm.user_id=p.user_id JOIN chat_groups g ON g.id=cm.group_id
 WHERE p.id=?1 AND p.enabled=1 AND s.expires_at>?2 AND u.disabled=0 AND u.kind='user'
 AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.group_id=cm.group_id AND b.user_id=p.user_id)
 ORDER BY message_id DESC LIMIT 1`

export async function runWebPush(env:Env,t:number){
 if(!pushConfigured(env))return {checked:0,sent:0}
 // Bound work per cron. next_check_at rotates idle devices fairly.
 const due=await env.DB.prepare(`SELECT id FROM web_push_subscriptions WHERE enabled=1 AND next_check_at<=? ORDER BY next_check_at,id LIMIT 20`).bind(t).all<{id:string}>()
 let sent=0
 for(let start=0;start<due.results.length;start+=4){
  await Promise.all(due.results.slice(start,start+4).map(async({id})=>{
   const device=await env.DB.prepare(`UPDATE web_push_subscriptions SET next_check_at=?2 WHERE id=?1 AND enabled=1 AND next_check_at<=?3 RETURNING *`).bind(id,t+300,t).first<Device>()
   if(!device)return
   const unread=await env.DB.prepare(PUSH_UNREAD_SQL).bind(id,t).first<{group_id:number;message_id:number|null}>()
   if(!unread?.message_id){
    await env.DB.prepare(`UPDATE web_push_subscriptions SET next_check_at=?2 WHERE id=?1 AND next_check_at=?3`).bind(id,t+60,t+300).run()
    return
   }
   let status=0
   try{
    if(!validPushEndpoint(device.endpoint))status=410
    else{
     const details=webpush.generateRequestDetails({endpoint:device.endpoint,keys:{p256dh:device.p256dh,auth:device.auth}},
      JSON.stringify({body:'群聊有新消息',url:'/chat/'+unread.group_id,binding:await sha256(device.session_id+device.id)}),
      {vapidDetails:{subject:'https://jinhuan.example',publicKey:env.PUSH_VAPID_PUBLIC_KEY!,privateKey:env.PUSH_VAPID_PRIVATE_KEY!},TTL:300,urgency:'normal',contentEncoding:'aes128gcm'})
     const response=await fetch(details.endpoint,{method:details.method,headers:details.headers,body:details.body as BodyInit,redirect:'manual',signal:AbortSignal.timeout(5000)})
     status=response.status
     await response.body?.cancel()
    }
   }catch{status=0} // No endpoint, keys, message or provider response in logs.
   // Concurrent disable/rebind wins over an old sending job.
   const guard='id=?1 AND session_id=?2 AND next_check_at=?3'
   if(status>=200&&status<300){
    await env.DB.prepare(`UPDATE web_push_subscriptions SET last_message_id=MAX(last_message_id,?4),failures=0 WHERE ${guard}`).bind(id,device.session_id,t+300,unread.message_id).run();sent++
   }else if(status===404||status===410){
    await env.DB.prepare(`DELETE FROM web_push_subscriptions WHERE ${guard}`).bind(id,device.session_id,t+300).run()
   }else{
    const failures=device.failures+1
    await env.DB.prepare(`UPDATE web_push_subscriptions SET failures=?4,enabled=?5,next_check_at=?6 WHERE ${guard}`).bind(id,device.session_id,t+300,failures,failures<3?1:0,t+Math.min(3600,300*2**failures)).run()
   }
  }))
 }
 return {checked:due.results.length,sent}
}
