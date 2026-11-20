import {socialLink,type SocialLink} from '../../public/social-links.js'
import {boundedBytes} from './social-x'
import type {Preview} from './social-preview'

// 仅取得官方公开嵌入的可用性；不执行、保存或向客户端转发第三方HTML。
export async function fetchOfficialEmbed(link:SocialLink,request:typeof fetch=fetch):Promise<Preview>{
 const empty={title:link.label+'分享',description:'',image:null,available:false}
 if(link.provider!=='instagram'&&link.provider!=='tiktok')return empty
 const endpoint=link.provider==='instagram'?'https://graph.facebook.com/v25.0/instagram_oembed':'https://www.tiktok.com/oembed'
 try{
  const r=await request(endpoint+'?url='+encodeURIComponent(link.url),{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}})
  if(!r.ok||!r.headers.get('content-type')?.includes('json')){await r.body?.cancel();return empty}
  const data=JSON.parse(new TextDecoder().decode(await boundedBytes(r,65536)))
  if(typeof data.html!=='string'||!['rich','video'].includes(data.type))return empty
  if(link.provider==='instagram'){
   const permalink=data.html.match(/data-instgrm-permalink\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g,'&')
   const actual=permalink?socialLink(permalink):null
   if(actual?.provider!=='instagram'||actual.id!==link.id)return empty
  }else if(data.html.match(/data-video-id\s*=\s*["'](\d+)["']/i)?.[1]!==link.id)return empty
  return {...empty,available:true,description:typeof data.title==='string'?data.title.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,2000):'',embed:{provider:link.provider,url:link.url}}
 }catch{return empty}
}
