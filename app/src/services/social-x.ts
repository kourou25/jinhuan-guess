export type SocialMedia={url:string;kind:'image'|'video';poster?:string;alternates?:string[];posterAlternates?:string[];width:number|null;height:number|null}
export type XContent={title:string;description:string;image:string|null;available:boolean;author?:string;media?:SocialMedia[];sensitive?:boolean}
export function xMediaUrl(raw:unknown,video=false):string|null{
 try{const u=new URL(String(raw));return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&(video?u.hostname==='video.twimg.com':u.hostname==='pbs.twimg.com')?u.href:null}catch{return null}
}
export async function boundedBytes(response:Response,max:number){
 if(Number(response.headers.get('content-length')||0)>max){await response.body?.cancel();throw Error('媒体超过20MB，请选择较小文件')}
 const reader=response.body?.getReader();if(!reader)throw Error('原站未返回内容')
 const parts:Uint8Array[]=[];let size=0
 try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>max){await reader.cancel();throw Error('内容过大')}parts.push(r.value)}}finally{reader.releaseLock()}
 const out=new Uint8Array(size);let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length}return out
}
export async function fetchXContent(id:string,request:typeof fetch=fetch):Promise<XContent>{
 const empty={title:'X / Twitter分享',description:'暂未取得公开内容，请稍后重试。',image:null,available:false}
 try{
  const r=await request(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=0`,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}})
  if(!r.ok){await r.body?.cancel();return empty}
  const data=JSON.parse(new TextDecoder().decode(await boundedBytes(r,524288)))
  if(data.id_str!==id||typeof data.text!=='string')return empty
  const dimension=(v:unknown)=>Number.isFinite(Number(v))&&Number(v)>0&&Number(v)<=30000?Number(v):null
  const media:SocialMedia[]=[]
  for(const m of (Array.isArray(data.mediaDetails)?data.mediaDetails:[]).slice(0,12)){
   const poster=xMediaUrl(m.media_url_https);if(!poster)continue
   if(m.type==='photo')media.push({url:poster,kind:'image',width:dimension(m.original_info?.width),height:dimension(m.original_info?.height)})
   else if(m.type==='video'||m.type==='animated_gif'){
    const variants=(m.video_info?.variants||[]).filter((v:any)=>v.content_type==='video/mp4'&&xMediaUrl(v.url,true)).sort((a:any,b:any)=>Number(a.bitrate||0)-Number(b.bitrate||0))
    const pick=variants.find((v:any)=>Number(v.bitrate||0)>=256000)||variants[0]
    if(pick)media.push({url:xMediaUrl(pick.url,true)!,poster,kind:'video',width:dimension(m.original_info?.width),height:dimension(m.original_info?.height)})
   }
  }
  let text=data.text
  for(const m of data.entities?.media||[])if(typeof m.url==='string')text=text.replace(m.url,'')
  return{title:String(data.user?.name||'X / Twitter').slice(0,100),author:String(data.user?.screen_name||'').slice(0,30),description:text.trim().slice(0,10000),image:media[0]?.poster||media[0]?.url||null,media,sensitive:data.possibly_sensitive===true,available:true}
 }catch{return empty}
}
export async function fetchXMedia(url:string,kind:'image'|'video',request:typeof fetch=fetch,allowed=xMediaUrl,timeoutMs=15000){
 if(!allowed(url,kind==='video'))throw Error('媒体地址无效')
 let r:Response|undefined
 const signal=AbortSignal.timeout(timeoutMs)
 for(let hop=0;hop<3;hop++){
  r=await request(url,{redirect:'manual',signal})
  if(r.status<300||r.status>=400)break
  const location=r.headers.get('location');await r.body?.cancel()
  if(!location)throw Error('媒体跳转无效')
  url=new URL(location,url).href;if(!allowed(url,kind==='video'))throw Error('媒体跳转无效')
 }
 if(!r)throw Error('媒体暂不可用')
 const mime=(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()
 if(!r.ok||!(kind==='video'?mime==='video/mp4':['image/jpeg','image/png','image/gif','image/webp'].includes(mime))){await r.body?.cancel();throw Error('media_response_'+r.status)}
 return{bytes:await boundedBytes(r,20*1024*1024),mime,ext:({'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp','video/mp4':'mp4'} as Record<string,string>)[mime]}
}
