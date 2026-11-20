type ImageMediaSource={image_key:string|null;image_url:string|null;thumb_url:string|null;gallery:string|null}
type Media={u?:unknown;t?:unknown;k?:unknown}
const ORIGIN='https://jinhuan.example'
function localImage(value:string){
 if(!/^\/img\/[a-zA-Z0-9_./-]+$/.test(value)||value.includes('//')||value.split('/').some(p=>p==='.'||p==='..'))return null
 return ORIGIN+value
}
function imageUrl(value:unknown,hosts:string[]):string|null{
 if(typeof value!=='string'||value.length>4096||/[\s\\\x00-\x1f]/.test(value))return null
 if(value.startsWith('/'))return localImage(value)
 try{
  const u=new URL(value)
  if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash)return null
  if(u.origin===ORIGIN){if(value!==u.href||u.search)return null;return localImage(u.pathname)}
  if(!hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))return null
  return u.href
 }catch{return null}
}

/** 只向视觉服务提供第一张公开展示图。永不读取 v/o（视频原文件、未打码原图）。 */
export function imageReplyMedia(source:ImageMediaSource,externalHosts='linux.do'):{url:string}|{reason:'gif'|'image'}{
 const hosts=externalHosts.split(',').map(s=>s.trim().toLowerCase()).filter(s=>/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)&&!/(?:^|\.)(?:localhost|local|internal|lan)$/.test(s))
 let first:Media
 if(source.gallery!==null){
  try{const items=JSON.parse(source.gallery);if(!Array.isArray(items)||!items[0]||typeof items[0]!=='object')return {reason:'image'};first=items[0]}catch{return {reason:'image'}}
 }else first={u:source.image_key?'/img/'+source.image_key:source.image_url,t:source.thumb_url}
 if(first.k==='g'||typeof first.u==='string'&&/\.gif(?:[?#]|$)/i.test(first.u))return {reason:'gif'}
 if(first.k==='f')return {reason:'image'}
 for(const candidate of [first.t,first.u]){const url=imageUrl(candidate,hosts);if(url&&!/\.gif(?:[?#]|$)/i.test(url))return {url}}
 return {reason:'image'}
}
