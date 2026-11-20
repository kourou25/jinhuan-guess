import {Hono} from 'hono'
import type {Ctx,C} from '../types'
import {needUser} from '../services/auth'
import {CHAT_HISTORY_FLOOR} from '../services/chat-access'
import {fail} from '../lib/http'
import {socialLinks,socialCaption} from '../../public/social-links.js'
import {fetchPreview} from '../services/social-preview'
import {fetchXMedia} from '../services/social-x'
import {douyinMediaUrl} from '../services/social-douyin'
import {weiboMediaUrl} from '../services/social-weibo'
import {instagramMediaUrl} from '../services/social-instagram'
import {fetchSocialVideo,SocialVideoError} from '../services/social-video'
import {postShareLink} from '../services/social-post'
const failedMedia=new Map<string,number>()
export async function socialMediaResponse(c:C,url:string,kind:'image'|'video',provider='x',alternates:string[]=[]){
 const allowed=provider==='douyin'?douyinMediaUrl:provider==='weibo'?weiboMediaUrl:provider==='instagram'?instagramMediaUrl:undefined
 const all=[...new Set([url,...alternates])]
 if(provider==='douyin'&&kind==='video')all.sort((a,b)=>Number(new URL(a).hostname.endsWith('.amemv.com'))-Number(new URL(b).hostname.endsWith('.amemv.com')))
 const at=Date.now()
 all.sort((a,b)=>Number((failedMedia.get(a)||0)>at)-Number((failedMedia.get(b)||0)>at))
 const candidates=all.slice(0,3),deadline=Date.now()+15000
 for(const candidate of candidates){
  try{
   const timeout=Math.max(1,Math.min(candidates.length>1?6000:15000,deadline-Date.now()))
   if(kind==='video'){const result=await fetchSocialVideo(candidate,{range:c.req.header('Range'),ifRange:c.req.header('If-Range'),allowed,headerTimeoutMs:timeout});failedMedia.delete(candidate);return result}
   const key=new Request(new URL('/__social_media_v1?url='+encodeURIComponent(candidate),c.req.url)),cache=caches.default
   let result=await cache.match(key)
   if(!result){const media=await fetchXMedia(candidate,kind,fetch,allowed,timeout);result=new Response(media.bytes,{headers:{'Content-Type':media.mime,'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'}});c.executionCtx.waitUntil(cache.put(key,result.clone()))}
   const headers=new Headers(result.headers);headers.set('Cache-Control','private, max-age=300');headers.set('X-Content-Type-Options','nosniff')
   failedMedia.delete(candidate)
   return new Response(result.body,{headers})
  }catch(error){
   if(error instanceof SocialVideoError&&error.code==='range')fail(416,'视频分段请求无效，请重新播放')
   if(failedMedia.size>=512&&!failedMedia.has(candidate))failedMedia.delete(failedMedia.keys().next().value!)
   failedMedia.set(candidate,Date.now()+60000)
   console.warn('social_media_upstream',{provider,kind,host:new URL(candidate).hostname,reason:error instanceof SocialVideoError?error.code:error instanceof Error&&/^media_response_\d+$/.test(error.message)?error.message:error instanceof Error?error.name:'unknown',status:error instanceof SocialVideoError?error.upstreamStatus:undefined})
   if(Date.now()>=deadline)break
  }
 }
 fail(503,kind==='video'?'原站视频暂不可读取，请稍后重试':'原站媒体暂不可用，请重试')
}
const limits=new Map<number,{at:number;n:number}>()
const pending=new Map<string,Promise<Awaited<ReturnType<typeof fetchPreview>>>>()
export const socialPreview=new Hono<Ctx>()
async function source(c:C){
 const u=needUser(c),id=Number(c.req.param('id')),index=Number(c.req.query('index')||0)
 if(!Number.isSafeInteger(id)||id<=0||!Number.isInteger(index)||index<0||index>1)fail(400,'预览来源无效')
 const row=await c.env.DB.prepare(`SELECT m.body FROM chat_messages m JOIN chat_members cm ON cm.group_id=m.group_id AND cm.user_id=?
  WHERE m.id=? AND m.deleted=0 AND (m.redpack_id IS NULL) AND m.created_at>=cm.joined_at AND m.id>=${CHAT_HISTORY_FLOOR}
  AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.group_id=m.group_id AND b.user_id=cm.user_id)`).bind(u.id,id).first<{body:string}>()
 if(!row)fail(404,'来源消息已不可查看')
 const link=socialLinks(row!.body)[index]
 if(!link||!['x','douyin','weibo','instagram'].includes(link.provider))fail(400,'该链接不使用分享页预览')
 return {u,link}
}
export async function cachedSocialPreview(c:C,u:{id:number},link:NonNullable<ReturnType<typeof socialLinks>[number]>){
 c.header('Cache-Control','no-store')
 const key=new Request(new URL('/__social_preview_v6?url='+encodeURIComponent(link.url),c.req.url)),cache=caches.default
 const hit=await cache.match(key);if(hit)return await hit.json<Awaited<ReturnType<typeof fetchPreview>>>()
 const t=Date.now(),last=limits.get(u.id),limit=last&&t-last.at<60000?last:{at:t,n:0}
 if(limit.n>=10)fail(429,'预览请求较多，请稍后再试')
 if(limits.size>=2000&&!limits.has(u.id))limits.delete(limits.keys().next().value!)
 limit.n++;limits.set(u.id,limit)
 let work=pending.get(link.url)
 if(!work){if(pending.size>=30)fail(429,'预览忙碌，请稍后再试');work=fetchPreview(link);pending.set(link.url,work);work.finally(()=>pending.delete(link.url))}
 const data=await work
 c.executionCtx.waitUntil(cache.put(key,Response.json(data,{headers:{'Cache-Control':'public, max-age='+(data.available?(['douyin','instagram'].includes(link.provider)?300:1800):30)}})))
 return data
}
socialPreview.get('/api/chat/messages/:id/preview',async c=>{
 const {u,link}=await source(c);return c.json(await cachedSocialPreview(c,u,link))
})
socialPreview.get('/api/social/preview',async c=>{
 const u=needUser(c),link=postShareLink(c.req.query('share'))
 const data=await cachedSocialPreview(c,u,link)
 return c.json({available:data.available,description:socialCaption(data.description),embed:data.embed,sensitive:!!data.sensitive,media:data.media?.map((it,i)=>({kind:it.kind,url:`/api/social/preview/media/${i}?share=${encodeURIComponent(link.url)}`,poster:it.poster?`/api/social/preview/media/${i}?poster=1&share=${encodeURIComponent(link.url)}`:undefined}))||[]})
})
socialPreview.get('/api/social/preview/media/:media',async c=>{
 const u=needUser(c),link=postShareLink(c.req.query('share')),idx=Number(c.req.param('media'))
 if(!Number.isInteger(idx)||idx<0||idx>11)fail(400,'媒体无效')
 const data=await cachedSocialPreview(c,u,link),item=data.media?.[idx],poster=c.req.query('poster')==='1'
 const url=poster?item?.poster:item?.url
 if(!url)fail(404,'媒体暂不可用')
 return socialMediaResponse(c,url!,poster?'image':item!.kind,link.provider,poster?item?.posterAlternates:item?.alternates)
})
socialPreview.get('/api/chat/messages/:id/preview/media/:media',async c=>{
 const {u,link}=await source(c),idx=Number(c.req.param('media'))
 if(!['x','douyin','weibo','instagram'].includes(link.provider)||!Number.isInteger(idx)||idx<0||idx>11)fail(400,'媒体无效')
 const data=await cachedSocialPreview(c,u,link),item=data.media?.[idx]
 if(!item)fail(404,'媒体暂不可用')
 const poster=c.req.query('poster')==='1',url=poster?item!.poster:item!.url,kind=poster?'image':item!.kind
 if(!url)fail(404,'媒体暂不可用')
 return socialMediaResponse(c,url!,kind,link.provider,poster?item?.posterAlternates:item?.alternates)
})
