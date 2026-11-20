import {xMediaUrl} from './social-x'

export class SocialVideoError extends Error {
 constructor(public code:'range'|'upstream'|'format'|'redirect'|'timeout',public upstreamStatus?:number){super(code)}
}
// 浏览器播放器使用单段Range。拒绝多段及无效输入，避免把本站变成任意请求转发器。
export function videoRange(raw:string|null|undefined){
 if(!raw)return null
 const m=/^bytes=(\d{0,15})-(\d{0,15})$/.exec(raw.trim())
 if(!m||(!m[1]&&!m[2])||(!m[1]&&Number(m[2])===0)||(m[1]&&m[2]&&Number(m[2])<Number(m[1])))throw new SocialVideoError('range')
 return `bytes=${m[1]}-${m[2]}`
}
export async function fetchSocialVideo(url:string,{range,ifRange,request=fetch,allowed=xMediaUrl,headerTimeoutMs=15000}:{range?:string|null;ifRange?:string|null;request?:typeof fetch;allowed?:typeof xMediaUrl;headerTimeoutMs?:number}={}){
 const selected=videoRange(range)
 if(!allowed(url,true))throw new SocialVideoError('redirect')
 const requestHeaders=new Headers({'Accept':'video/mp4','Accept-Encoding':'identity'})
 if(selected)requestHeaders.set('Range',selected)
 if(selected&&ifRange&&ifRange.length<=256)requestHeaders.set('If-Range',ifRange)
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),headerTimeoutMs)
 let result:Response|undefined
 try{
  for(let hop=0;hop<3;hop++){
   result=await request(url,{headers:requestHeaders,redirect:'manual',signal:controller.signal})
   if(result.status<300||result.status>=400)break
   const location=result.headers.get('location');await result.body?.cancel();result=undefined
   if(!location)throw new SocialVideoError('redirect')
   url=new URL(location,url).href
   if(!allowed(url,true))throw new SocialVideoError('redirect')
  }
 }catch(error){if(controller.signal.aborted)throw new SocialVideoError('timeout');throw error}
 finally{clearTimeout(timer)}
 if(!result)throw new SocialVideoError('redirect')
 const headers=new Headers({'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'})
 const contentRange=result.headers.get('content-range')
 if(result.status===416&&selected&&contentRange&&/^bytes \*\/\d+$/.test(contentRange)){
  await result.body?.cancel();headers.set('Content-Range',contentRange);headers.set('Cache-Control','no-store')
  return new Response(null,{status:416,headers})
 }
 if(![200,206].includes(result.status)){await result.body?.cancel();throw new SocialVideoError('upstream',result.status)}
 const mime=(result.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()
 if(mime!=='video/mp4'||!result.body){await result.body?.cancel();throw new SocialVideoError('format')}
 if(result.status===206&&(!selected||!contentRange||!/^bytes \d+-\d+\/\d+$/.test(contentRange))){await result.body.cancel();throw new SocialVideoError('format')}
 headers.set('Content-Type',mime)
 for(const name of ['content-length','accept-ranges','etag','last-modified']){const value=result.headers.get(name);if(value)headers.set(name,value)}
 if(result.status===206)headers.set('Content-Range',contentRange!)
 // 不读取/tee整段body，不为缓存继续下载用户已取消的视频；运行时保留背压与取消传播。
 return new Response(result.body,{status:result.status,headers})
}
