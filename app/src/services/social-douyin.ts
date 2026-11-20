import type {SocialLink} from '../../public/social-links.js'
import {boundedBytes,type XContent,type SocialMedia} from './social-x'
const shareHosts=['v.douyin.com','www.douyin.com','douyin.com','www.iesdouyin.com','m.douyin.com','jingxuan.douyin.com']
export function douyinMediaUrl(raw:unknown,video=false){
 try{const u=new URL(String(raw));const suffixes=video?['douyinvod.com','amemv.com']:['douyinpic.com','byteimg.com']
  // 2026-10-17 原站播放接口实际302返回的海外视频CDN；仅精确主机，不放开整个zjcdn域。
  const knownVideoCdn=video&&u.hostname==='v5-dy-ov-experiment.zjcdn.com'
  return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&(knownVideoCdn||suffixes.some(s=>u.hostname===s||u.hostname.endsWith('.'+s)))?u.href:null
 }catch{return null}
}
// 平台不同出口可能返回HTTP CDN。只对已允许的媒体域名升级HTTPS，不降级、不改域名或签名。
export function douyinMediaCandidates(list:unknown,video=false):string[]{
 if(!Array.isArray(list))return []
 const urls=[...new Set(list.slice(0,12).map(raw=>{try{const u=new URL(String(raw));if(u.protocol==='http:')u.protocol='https:';return douyinMediaUrl(u.href,video)}catch{return null}}).filter((x):x is string=>!!x))]
 if(video)urls.sort((a,b)=>Number(new URL(a).hostname.endsWith('.amemv.com'))-Number(new URL(b).hostname.endsWith('.amemv.com')))
 return urls.slice(0,3)
}
export async function fetchDouyinContent(link:SocialLink,request:typeof fetch=fetch):Promise<XContent>{
 const empty={title:'抖音分享',description:'暂未取得公开内容，请稍后重试。',image:null,available:false}
 const ua='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
 try{
  let id=link.id
  if(link.short){let target=new URL(link.url);id='';for(let hop=0;hop<3;hop++){
   if(target.protocol!=='https:'||target.port||target.username||target.password||!shareHosts.includes(target.hostname))return empty
   const found=target.pathname.match(/\/(?:video|note)\/(\d{5,25})/);if(found){id=found[1];break}
   const r=await request(target.href,{redirect:'manual',signal:AbortSignal.timeout(5000),headers:{'User-Agent':ua}});await r.body?.cancel()
   if(r.status<300||r.status>=400||!r.headers.get('location'))return empty;target=new URL(r.headers.get('location')!,target)
  }}
  if(!/^\d{5,25}$/.test(id))return empty
  for(const host of ['api5-normal-c-hl.amemv.com','aweme.snssdk.com']){
   try{
    const r=await request(`https://${host}/aweme/v1/feed/?aweme_id=${id}&aid=1128`,{redirect:'manual',signal:AbortSignal.timeout(7000),headers:{'User-Agent':ua,Accept:'application/json'}})
    if(!r.ok){await r.body?.cancel();continue}
    const data=JSON.parse(new TextDecoder().decode(await boundedBytes(r,1048576)))
    const item=(Array.isArray(data.aweme_list)?data.aweme_list:[]).find((x:any)=>String(x.aweme_id)===id)
    if(!item)continue
    const size=(x:unknown)=>Number(x)>0&&Number(x)<=30000?Number(x):null
    const media:SocialMedia[]=[]
    for(const image of (Array.isArray(item.images)?item.images:[]).slice(0,12)){
     const [url,...alternates]=douyinMediaCandidates(image.url_list);if(url)media.push({url,alternates,kind:'image',width:size(image.width),height:size(image.height)})
    }
    if(!media.length){const video=item.video,[url,...alternates]=douyinMediaCandidates(video?.play_addr?.url_list,true),[poster,...posterAlternates]=douyinMediaCandidates(video?.cover?.url_list)
     if(url&&poster)media.push({url,poster,alternates,posterAlternates,kind:'video',width:size(video.width),height:size(video.height)})}
    if(!media.length)continue
    return{title:String(item.author?.nickname||'抖音').slice(0,100),description:String(item.desc||'').slice(0,10000),image:media[0].poster||media[0].url,available:true,media}
   }catch{/* 单个公开端点失败后尝试备用端点。 */}
  }
 }catch{/* 短链或公开端点暂不可用。 */}
 return empty
}
