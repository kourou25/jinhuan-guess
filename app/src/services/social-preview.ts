import type {SocialLink} from '../../public/social-links.js'
import {fetchXContent,type XContent} from './social-x'
import {fetchDouyinContent} from './social-douyin'
import {weiboObjectId,parseWeiboPage} from './social-weibo'
import {fetchOfficialEmbed} from './social-embed'
import {fetchInstagramContent} from './social-instagram'
export type Preview=XContent & {embed?:{provider:'instagram'|'tiktok';url:string}}
const hosts={douyin:['www.douyin.com','douyin.com','v.douyin.com','www.iesdouyin.com','jingxuan.douyin.com'],weibo:['weibo.com','www.weibo.com','m.weibo.cn','m.weibo.com']}
export function allowedRedirect(url:URL,provider:string){return url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&(hosts[provider as keyof typeof hosts]||[]).includes(url.hostname)}
export function previewImage(raw:string,base:string,provider:string){
 if(!raw)return null
 try{const u=new URL(raw,base),ends=provider==='weibo'?['sinaimg.cn']:['douyinpic.com','byteimg.com','douyin.com'];return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&ends.some(s=>u.hostname===s||u.hostname.endsWith('.'+s))?u.href:null}catch{return null}
}
export async function fetchPreview(link:SocialLink,request:typeof fetch=fetch):Promise<Preview>{
 if(link.provider==='instagram')return await fetchInstagramContent(link,request)||fetchOfficialEmbed(link,request)
 if(link.provider==='tiktok')return fetchOfficialEmbed(link,request)
 if(link.provider==='x')return fetchXContent(link.id,request)
 if(link.provider==='douyin'){
  const data=await fetchDouyinContent(link,request);if(data.available||link.short)return data
 }
 const empty={title:link.label+'分享',description:'原站未提供可读取的公开预览，可打开原链接查看。',image:null,available:false}
 const weiboId=link.provider==='weibo'?weiboObjectId(link.id):null
 let target=new URL(weiboId?`https://weibo.com/2/detail/${weiboId}`:link.url)
 const signal=AbortSignal.timeout(7000)
 try{
  for(let hop=0;hop<3;hop++){
   if(!allowedRedirect(target,link.provider))return empty
   const response=await request(target.href,{redirect:'manual',signal,headers:{Accept:'text/html','User-Agent':'Mozilla/5.0 (compatible; JinhuanPreview/1.0)'}})
   if(response.status>=300&&response.status<400){const to=response.headers.get('location');await response.body?.cancel();if(!to)return empty;target=new URL(to,target);continue}
   if(!response.ok||!response.headers.get('content-type')?.includes('text/html')){await response.body?.cancel();return empty}
   const reader=response.body?.getReader();if(!reader)return empty
   const chunks:Uint8Array[]=[];let bytes=0
   try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>262144){await reader.cancel();return empty}chunks.push(value)}}finally{reader.releaseLock()}
   const data=new Uint8Array(bytes);let off=0;for(const chunk of chunks){data.set(chunk,off);off+=chunk.length}
   if(weiboId){const native=parseWeiboPage(new TextDecoder().decode(data),weiboId);if(native)return native}
   const meta:Record<string,string>={}
   await new HTMLRewriter().on('meta',{element(e){const key=(e.getAttribute('property')||e.getAttribute('name')||'').toLowerCase();if(['og:title','og:description','og:image','description','twitter:title','twitter:description','twitter:image'].includes(key)&&!meta[key])meta[key]=(e.getAttribute('content')||'').slice(0,2000)}}).transform(new Response(data)).text()
   const clean=(s:string,n:number)=>s.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
   const title=clean(meta['og:title']||meta['twitter:title']||'',160),description=clean(meta['og:description']||meta['twitter:description']||meta.description||'',500)
   const generic=/^(?:查看微博正文内容|微博正文|微博|新浪微博|抖音|抖音-记录美好生活|登录|安全验证|验证码|访问验证)$/
   if((!title||generic.test(title))&&(!description||generic.test(description)))return empty
   return {title:title||link.label+'分享',description,image:previewImage(meta['og:image']||meta['twitter:image']||'',target.href,link.provider),available:true}
  }
 }catch{/* 超时、登录和验证码页不绕过，不向客户端泄漏上游响应。 */}
 return empty
}
