import {Hono} from 'hono'
import type {C, Ctx} from '../types'
import {needUser} from '../services/auth'
import {CHAT_HISTORY_FLOOR} from '../services/chat-access'
import {jsonBody,fail} from '../lib/http'
import {now} from '../lib/time'
import {sha256} from '../lib/crypto'
import {sharedPacket} from '../redpacket'
import type {Media} from '../services/content-media'
import {storeUpload,uploadNonce} from '../services/upload-operations'

type Source={id:number;body:string;media:string|null;image_key:string|null;width:number|null;height:number|null}
const access=`m.deleted=0 AND m.redpack_id IS NULL AND m.system_kind IS NULL
 AND NOT EXISTS(SELECT 1 FROM chat_redpacks p WHERE p.message_id=m.id)
 AND EXISTS(SELECT 1 FROM chat_members cm WHERE cm.user_id=?1 AND cm.group_id=m.group_id
 AND m.created_at>=cm.joined_at AND m.id>=${CHAT_HISTORY_FLOOR})
 AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.user_id=?1 AND b.group_id=m.group_id)`
function idOf(c:C){const id=Number(c.req.param('id'));if(!Number.isSafeInteger(id)||id<1)fail(400,'收藏编号无效');return id}
function mediaOf(m:Source):Media[]{
 let items:Media[]=[]
 try{items=m.media?JSON.parse(m.media):m.image_key?[{k:m.image_key,w:m.width,h:m.height}]:[]}catch{fail(400,'来源附件不可快捷发送')}
 if(!Array.isArray(items)||items.length>12||items.some(it=>!it||!it.k||[it.k,it.p,it.o].filter(Boolean).some(k=>typeof k!=='string'||!/^c\/[a-zA-Z0-9_./-]+$/.test(k)||k.includes('..'))))fail(400,'来源附件不可快捷发送')
 return items
}
async function source(c:C,uid:number,id:number,owned=false){
 const row=await c.env.DB.prepare(`SELECT m.id,m.body,m.media,m.image_key,m.width,m.height FROM chat_messages m
 WHERE m.id=?2 AND ${access}${owned?' AND EXISTS(SELECT 1 FROM chat_message_favorites f WHERE f.user_id=?1 AND f.message_id=m.id)':''}`).bind(uid,id).first<Source>()
 if(!row||sharedPacket(row.body))fail(404,'来源消息已不可使用')
 return row!
}
const version=(m:Source)=>sha256(JSON.stringify([m.body,m.media,m.image_key]))
// 最终发送事务再次核验来源，覆盖 prepare 到实际提交之间的编辑/撤回/取消收藏。
export async function favoriteSendGuard(c:C,uid:number,raw:unknown,body:string){
 if(raw===undefined)return null
 const data=raw as {id?:unknown;version?:unknown},id=Number(data?.id)
 if(!data||!Number.isSafeInteger(id)||id<1||typeof data.version!=='string')fail(400,'收藏发送标识无效')
 const m=await source(c,uid,id,true)
 if(data.version!==await version(m)||body!==m.body)fail(409,'来源消息已变化，请重新打开收藏')
 return c.env.DB.prepare(`SELECT json(CASE WHEN EXISTS(SELECT 1 FROM chat_messages m WHERE m.id=?2 AND ${access}
 AND m.body=?3 AND m.media IS ?4 AND m.image_key IS ?5
 AND EXISTS(SELECT 1 FROM chat_message_favorites f WHERE f.user_id=?1 AND f.message_id=m.id))
 THEN 'true' ELSE 'favorite_source_changed' END)`).bind(uid,id,m.body,m.media,m.image_key)
}
export const chatFavorites=new Hono<Ctx>()
chatFavorites.get('/api/chat/favorites',async c=>{
 const u=needUser(c),cursor=c.req.query('before')||'',parts=cursor.split(':').map(Number)
 if(cursor&&(parts.length!==2||parts.some(n=>!Number.isSafeInteger(n)||n<1)))fail(400,'分页位置无效')
 const rows=await c.env.DB.prepare(`SELECT m.id,m.body,m.media,m.image_key,m.width,m.height,f.created_at,
 CASE WHEN ${access} THEN 1 ELSE 0 END AS available FROM chat_message_favorites f JOIN chat_messages m ON m.id=f.message_id
 WHERE f.user_id=?1 ${cursor?'AND (f.created_at,f.message_id)<(?2,?3)':''}
 ORDER BY f.created_at DESC,f.message_id DESC LIMIT 21`).bind(u.id,...(cursor?parts:[])).all<Source&{created_at:number;available:number}>()
 const page=rows.results.slice(0,20),last=page.at(-1)
 c.header('Cache-Control','no-store')
 return c.json({items:page.map(m=>{
  if(!m.available||sharedPacket(m.body))return {id:m.id,unavailable:true}
  let media:Media[];try{media=mediaOf(m)}catch{return {id:m.id,unavailable:true}}
  return {id:m.id,body:m.body.slice(0,500),attachments:media.map(x=>x.kind||'image')}
 }),next:rows.results.length>20&&last?`${last.created_at}:${last.id}`:null})
})
chatFavorites.post('/api/chat/messages/:id/favorite',async c=>{
 const u=needUser(c),id=idOf(c),m=await source(c,u.id,id)
 mediaOf(m)
 const saved=await c.env.DB.prepare(`INSERT INTO chat_message_favorites(user_id,message_id,created_at)
 SELECT ?1,m.id,?3 FROM chat_messages m WHERE m.id=?2 AND ${access} AND m.body=?4 AND m.media IS ?5 AND m.image_key IS ?6
 AND ((SELECT COUNT(*) FROM chat_message_favorites WHERE user_id=?1)<100 OR EXISTS(SELECT 1 FROM chat_message_favorites WHERE user_id=?1 AND message_id=?2))
 ON CONFLICT(user_id,message_id) DO UPDATE SET created_at=excluded.created_at RETURNING message_id`).bind(u.id,id,now(),m.body,m.media,m.image_key).first()
 if(!saved)fail(409,'收藏已达100条或来源已变化，请整理收藏后重试')
 return c.json({ok:true})
})
chatFavorites.delete('/api/chat/favorites/:id',async c=>{
 const u=needUser(c);await c.env.DB.prepare('DELETE FROM chat_message_favorites WHERE user_id=? AND message_id=?').bind(u.id,idOf(c)).run()
 return c.json({ok:true})
})
chatFavorites.post('/api/chat/favorites/:id/prepare',async c=>{
 const u=needUser(c),id=idOf(c),b=await jsonBody<{nonce?:unknown}>(c)
 if(u.silenced)fail(403,'你在 linux.do 处于禁言状态')
 if(typeof b.nonce!=='string')fail(400,'请重新点击发送')
 const nonce=uploadNonce(b.nonce),m=await source(c,u.id,id,true),items=mediaOf(m),copied=new Map<string,string>()
 const copy=async(key?:string)=>{
  if(!key)return undefined
  if(copied.has(key))return copied.get(key)!
  const obj=await c.env.BUCKET.get(key)
  if(!obj)fail(404,'来源附件已失效')
  try{
   if(obj!.size>20*1024*1024)fail(413,'单个附件不能超过20MB')
   const token='fav-'+await sha256(JSON.stringify([id,nonce,key]))
   const out=await storeUpload(c.env.DB,c.env.BUCKET,{uid:u.id,nonce:token,source:obj!,mime:obj!.httpMetadata?.contentType||'application/octet-stream',ext:key.split('.').pop()||'bin',purpose:'chat',asFile:false,limited:true,t:now()})
   copied.set(key,out.key);return out.key
  }finally{await obj!.body.cancel().catch(()=>{})}
 }
 const media=[]
 for(const it of items)media.push({key:await copy(it.k),poster:await copy(it.p),orig:await copy(it.o),w:it.w,h:it.h,kind:it.kind,name:it.n,blur:it.b,car:it.c})
 // 复制期间撤回、编辑、离群或取消收藏，均不再交付快捷发送内容；副本按上传清理周期回收。
 const fresh=await source(c,u.id,id,true)
 if(fresh.body!==m.body||fresh.media!==m.media||fresh.image_key!==m.image_key)fail(409,'来源消息已变化，请重新打开收藏')
 c.header('Cache-Control','no-store')
 return c.json({body:m.body,media,favorite:{id,version:await version(m)}})
})
