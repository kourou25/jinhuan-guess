import type {SocialLink} from '../../public/social-links.js'
import {socialLink} from '../../public/social-links.js'
import {boundedBytes,type XContent} from './social-x'

function metaText(value:string){
 const names:Record<string,string>={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}
 return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(full,key:string)=>{
  if(!key.startsWith('#'))return names[key.toLowerCase()]||full
  const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):''
 })
}

export function instagramMediaUrl(raw:unknown,_video=false):string|null{
 try{const u=new URL(String(raw));return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&['cdninstagram.com','fbcdn.net'].some(host=>u.hostname.endsWith('.'+host))?u.href:null}catch{return null}
}
export function instagramMetadata(meta:Record<string,string>,id:string):XContent|null{
 const actual=socialLink(meta['og:url']||'')
 if(actual?.provider!=='instagram'||actual.id!==id)return null
 const image=instagramMediaUrl(meta['og:image']),video=instagramMediaUrl(meta['og:video:secure_url']||meta['og:video'],true)
 // 视频封面不能冒充可播放内容；只有原站明确标记为照片的对象才降为图片。
 if(!image||(!video&&!/Instagram photo\b/i.test(meta['twitter:title']||'')))return null
 const size=(value:string)=>Number.isFinite(Number(value))&&Number(value)>0&&Number(value)<=30000?Number(value):null
 const caption=(meta['og:title']||'').match(/on Instagram:\s*"([\s\S]*)"\s*$/)?.[1]||''
 return{title:'Instagram分享',description:caption.slice(0,10000),image,available:true,media:[{url:video||image,kind:video?'video':'image',...(video?{poster:image}:{}),width:size(meta[video?'og:video:width':'og:image:width']),height:size(meta[video?'og:video:height':'og:image:height'])}]}
}
// 只读对象公开HTML，不附带登录Cookie，不处理登录跳转或验证页。
export async function fetchInstagramContent(link:SocialLink,request:typeof fetch=fetch):Promise<XContent|null>{
 try{
  const response=await request(link.url,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'text/html'}})
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html')){await response.body?.cancel();return null}
  const bytes=await boundedBytes(response,1048576),meta:Record<string,string>={}
  await new HTMLRewriter().on('meta',{element(e){const key=e.getAttribute('property')||e.getAttribute('name')||'';if(['og:url','og:title','og:image','og:image:width','og:image:height','og:video','og:video:secure_url','og:video:width','og:video:height','twitter:title'].includes(key)&&!meta[key])meta[key]=(e.getAttribute('content')||'').slice(0,12000)}}).transform(new Response(bytes)).text()
  return instagramMetadata(Object.fromEntries(Object.entries(meta).map(([key,value])=>[key,metaText(value)])),link.id)
 }catch{return null}
}
