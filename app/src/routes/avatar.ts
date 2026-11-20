import {Hono} from 'hono'
import type {Ctx} from '../types'
import {needUser} from '../services/auth'
import {boundedJson,fail} from '../lib/http'
import {now} from '../lib/time'
import {commitUploadContent} from '../services/upload-operations'

export const avatarSettings=new Hono<Ctx>()
const keyPattern=/^a\/\d{4}\/\d{2}\/[a-f0-9]{24}\.(?:png|jpg|gif|webp)$/
avatarSettings.patch('/api/me/avatar',async c=>{
 const u=needUser(c),b=await boundedJson(c),key=typeof b.key==='string'?b.key:''
 if(!keyPattern.test(key))fail(400,'请选择本人上传的头像图片')
 let fragment=''
 if(b.crop!==undefined){
  if(!b.crop||typeof b.crop!=='object'||Array.isArray(b.crop))fail(400,'头像裁剪参数无效')
  const v=b.crop as Record<string,unknown>,a=[v.width,v.height,v.rotation,v.zoom,v.x,v.y]
  if(a.some(n=>typeof n!=='number'||!Number.isFinite(n)))fail(400,'头像裁剪参数无效')
  const [w,h,r,z,x,y]=a as number[]
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>4096||h>4096||![0,90,180,270].includes(r)||z<1||z>3||x<0||x>1||y<0||y>1)fail(400,'头像裁剪参数超出范围')
  fragment='#av='+[w,h,r,...[z,x,y].map(n=>Math.round(n*10000)/10000)].join(',')
 }
 const avatar='/img/'+key+fragment,db=c.env.DB,t=now()
 // A lost save response may be retried without consuming a new file or writing again.
 if(u.avatar===avatar)return c.json({ok:true,avatar})
 if(!await db.prepare("SELECT 1 FROM uploads WHERE key=? AND user_id=? AND used=0 AND mime IN ('image/png','image/jpeg','image/gif','image/webp') AND size<=5242880").bind(key,u.id).first())fail(400,'头像上传已失效或不属于当前账号，请重新选择')
 const oldKey=u.avatar?.split('#')[0].slice(5),content=[
  db.prepare('UPDATE users SET avatar=?,avatar_custom=1,updated_at=? WHERE id=? AND avatar IS ?').bind(avatar,t,u.id,u.avatar),
  db.prepare("SELECT json(CASE WHEN changes()=1 THEN 'true' ELSE 'avatar_changed' END)"),
 ]
 // Only retire an owned avatar key, never an OAuth URL or another content prefix.
 if(oldKey&&keyPattern.test(oldKey)&&oldKey!==key){
  content.push(db.prepare('UPDATE uploads SET used=0,created_at=? WHERE key=? AND user_id=?').bind(t,oldKey,u.id))
  content.push(db.prepare('UPDATE upload_operations SET cleanup_after=? WHERE key=? AND user_id=?').bind(t+86400,oldKey,u.id))
 }
 try{await commitUploadContent(db,u.id,[key],content)}catch(e){
  if(String(e).includes('malformed JSON'))fail(409,'头像已在另一处更新，请刷新后重试')
  throw e
 }
 return c.json({ok:true,avatar})
})
