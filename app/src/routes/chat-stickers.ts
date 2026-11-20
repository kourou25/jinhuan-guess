import {Hono} from 'hono'
import type {C, Ctx} from '../types'
import {needUser} from '../services/auth'
import {CHAT_HISTORY_FLOOR} from '../services/chat-access'
import {jsonBody, fail} from '../lib/http'
import {now} from '../lib/time'

type Source={id:number;media:string|null;image_key:string|null;width:number|null;height:number|null}
type Favorite=Source&{media_index:number;created_at:number;available:number}
const access=`EXISTS(SELECT 1 FROM users u WHERE u.id=?1 AND u.disabled=0 AND u.kind='user')
 AND EXISTS(SELECT 1 FROM chat_members cm WHERE cm.user_id=?1 AND cm.group_id=m.group_id
   AND m.created_at>=cm.joined_at AND m.id>=${CHAT_HISTORY_FLOOR})
 AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.user_id=?1 AND b.group_id=m.group_id)`

// 与消息的可见媒体索引一致（排除文件），只使用当前展示图，不读取保留原图 o。
export function favoriteImage(m:Source,index:number){
 let items:{k:string;kind?:string;b?:number;p?:string;w?:number;h?:number}[]
 try{items=m.media?JSON.parse(m.media):m.image_key?[{k:m.image_key,w:m.width??undefined,h:m.height??undefined}]:[]}catch{return null}
 if(!Array.isArray(items))return null
 const it=items.filter(x=>x&&x.kind!=='f')[index]
 if(!it||it.b||it.kind&&it.kind!=='g'||!/^c\/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp|gif)$/i.test(it.k)||it.k.includes('..'))return null
 return {message_id:m.id,index,url:'/img/'+it.k,width:it.w||null,height:it.h||null,animated:it.kind==='g'||/\.gif$/i.test(it.k)}
}
function ids(c:C){
 const id=Number(c.req.param('id')),index=Number(c.req.param('index'))
 if(!Number.isSafeInteger(id)||id<1||!Number.isInteger(index)||index<0||index>11)fail(400,'表情来源无效')
 return {id,index}
}
async function source(c:C,uid:number,id:number){
 const m=await c.env.DB.prepare(`SELECT m.id,m.media,m.image_key,m.width,m.height FROM chat_messages m
 WHERE m.id=?2 AND m.deleted=0 AND m.redpack_id IS NULL AND ${access}`).bind(uid,id).first<Source>()
 if(!m)fail(404,'来源消息已不可查看')
 return m!
}
export const chatStickers=new Hono<Ctx>()
chatStickers.get('/api/chat/stickers',async c=>{
 const u=needUser(c)
 const rows=await c.env.DB.prepare(`SELECT f.message_id AS id,m.media,m.image_key,m.width,m.height,f.media_index,f.created_at,
 CASE WHEN m.deleted=0 AND m.redpack_id IS NULL AND ${access} THEN 1 ELSE 0 END AS available
 FROM chat_sticker_favorites f LEFT JOIN chat_messages m ON m.id=f.message_id WHERE f.user_id=?1
 ORDER BY f.created_at DESC,f.message_id DESC,f.media_index LIMIT 100`).bind(u.id).all<Favorite>()
 c.header('Cache-Control','no-store')
 return c.json({items:rows.results.map(r=>r.available&&favoriteImage(r,r.media_index)||{message_id:r.id,index:r.media_index,unavailable:true})})
})
chatStickers.post('/api/chat/messages/:id/sticker',async c=>{
 const u=needUser(c),body=await jsonBody<{index?:unknown}>(c),id=Number(c.req.param('id')),index=Number(body.index)
 if(!Number.isSafeInteger(id)||id<1||typeof body.index!=='number'||!Number.isInteger(index)||index<0||index>11)fail(400,'表情来源无效')
 const m=await source(c,u.id,id),image=favoriteImage(m,index)
 if(!image)fail(400,'仅可添加未遮挡的图片或动图')
 const saved=await c.env.DB.prepare(`INSERT INTO chat_sticker_favorites(user_id,message_id,media_index,created_at)
 SELECT ?1,m.id,?3,?4 FROM chat_messages m WHERE m.id=?2 AND m.deleted=0 AND m.redpack_id IS NULL
 AND m.media IS ?5 AND m.image_key IS ?6 AND ${access}
 AND ((SELECT COUNT(*) FROM chat_sticker_favorites WHERE user_id=?1)<100
 OR EXISTS(SELECT 1 FROM chat_sticker_favorites WHERE user_id=?1 AND message_id=?2 AND media_index=?3))
 ON CONFLICT(user_id,message_id,media_index) DO UPDATE SET created_at=excluded.created_at RETURNING message_id`).bind(u.id,id,index,now(),m.media,m.image_key).first()
 if(!saved)fail(409,'收藏已达 100 张或来源已变化，请移除部分收藏后重试')
 return c.json({item:image})
})
chatStickers.get('/api/chat/stickers/:id/:index',async c=>{
 const u=needUser(c),{id,index}=ids(c)
 const own=await c.env.DB.prepare('SELECT 1 FROM chat_sticker_favorites WHERE user_id=? AND message_id=? AND media_index=?').bind(u.id,id,index).first()
 if(!own)fail(404,'表情不存在')
 const image=favoriteImage(await source(c,u.id,id),index)
 if(!image)fail(404,'来源图片已不可使用')
 c.header('Cache-Control','no-store');return c.json({item:image})
})
chatStickers.delete('/api/chat/stickers/:id/:index',async c=>{
 const u=needUser(c),{id,index}=ids(c)
 await c.env.DB.prepare('DELETE FROM chat_sticker_favorites WHERE user_id=? AND message_id=? AND media_index=?').bind(u.id,id,index).run()
 return c.json({ok:true})
})
