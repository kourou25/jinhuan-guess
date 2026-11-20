import {imageReplyMedia} from './image-media'

export const MAX_INLINE_IMAGE_BYTES=3*1024*1024
export type InlineImage=Readonly<{url:string}>
const verified=new WeakSet<object>()
export function isInlineImage(value:unknown):value is InlineImage{return typeof value==='object'&&value!==null&&verified.has(value)}
type DownloadResult={image:InlineImage}|{reason:'fetch'|'size'|'image'}

// 校验完整的尺寸头与段边界，拒绝只有 magic bytes 的截断文件；不在 Worker 内解码像素。
function imageHeaderMatches(bytes:Uint8Array,mime:string){
 const starts=(values:number[],offset=0)=>values.every((value,i)=>bytes[offset+i]===value)
 const u32=(offset:number,little=false)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(offset,little)
 if(mime==='image/png')return bytes.length>=33&&starts([137,80,78,71,13,10,26,10])&&u32(8)===13&&starts([73,72,68,82],12)&&u32(16)>0&&u32(20)>0
 if(mime==='image/webp'){
  if(bytes.length<25||!starts([82,73,70,70])||!starts([87,69,66,80],8)||u32(4,true)!==bytes.length-8)return false
  const size=u32(16,true);if(size>bytes.length-20)return false
  if(starts([86,80,56,76],12))return size>=5&&bytes[20]===47
  if(starts([86,80,56,88],12))return bytes.length>=30&&size===10
  return bytes.length>=30&&starts([86,80,56,32],12)&&size>=10&&starts([157,1,42],23)
 }
 if(mime!=='image/jpeg'||bytes.length<15||!starts([255,216])||!starts([255,217],bytes.length-2))return false
 let offset=2
 while(offset+4<=bytes.length){
  if(bytes[offset++]!==255)return false
  while(bytes[offset]===255)offset++
  const marker=bytes[offset++];if(marker===217||marker===218)return false
  if(marker===1||marker>=208&&marker<=215)continue
  if(offset+2>bytes.length)return false
  const length=(bytes[offset]<<8)|bytes[offset+1]
  if(length<2||offset+length>bytes.length)return false
  if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return length>=8&&((bytes[offset+3]<<8)|bytes[offset+4])>0&&((bytes[offset+5]<<8)|bytes[offset+6])>0
  offset+=length
 }
 return false
}

/** 只重新获取已选中的公开展示 URL，禁止跳转、凭据、原图替换和任意 MIME。 */
export async function downloadImageInput(url:string,hosts:string|undefined,perform:typeof fetch,timeoutMs=10000):Promise<DownloadResult>{
 const safe=imageReplyMedia({image_key:null,image_url:url,thumb_url:null,gallery:null},hosts)
 if('reason' in safe||safe.url!==url)return {reason:'fetch'}
 const controller=new AbortController()
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,timer:ReturnType<typeof setTimeout>|undefined
 const operation=async():Promise<DownloadResult>=>{
  const response=await perform(url,{method:'GET',headers:{accept:'image/png,image/jpeg,image/webp'},redirect:'manual',signal:controller.signal})
  if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});return {reason:'fetch'}}
  reader=response.body?.getReader()
  if(!response.ok||!reader)return {reason:'fetch'}
  const mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if(!['image/png','image/jpeg','image/webp'].includes(mime??''))return {reason:'image'}
  const length=response.headers.get('content-length')
  if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))))return {reason:'fetch'}
  if(length!==null&&Number(length)>MAX_INLINE_IMAGE_BYTES)return {reason:'size'}
  const chunks:Uint8Array[]=[];let size=0
  while(!controller.signal.aborted){
   const part=await reader.read();if(part.done)break
   size+=part.value.byteLength;if(size>MAX_INLINE_IMAGE_BYTES)return {reason:'size'}
   chunks.push(part.value)
  }
  if(controller.signal.aborted)return {reason:'fetch'}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length}
  if(!imageHeaderMatches(bytes,mime!))return {reason:'image'}
  const binary:string[]=[];for(let i=0;i<bytes.length;i+=8192)binary.push(String.fromCharCode(...bytes.subarray(i,i+8192)))
  const image=Object.freeze({url:`data:${mime};base64,${btoa(binary.join(''))}`});verified.add(image)
  return {image}
 }
 try{
  return await Promise.race([operation(),new Promise<DownloadResult>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({reason:'fetch'})},Math.min(10000,Math.max(1,timeoutMs)))})])
 }catch{return {reason:'fetch'}}
 finally{if(timer!==undefined)clearTimeout(timer);controller.abort();void reader?.cancel().catch(()=>{})}
}

/** 错误正文只用于窄匹配，不返回、不日志、不持久化。未知兼容服务错误保持原处理。 */
export function isImageDownloadError(text:string){
 try{
  const error=JSON.parse(text)?.error
  if(!error||typeof error!=='object')return false
  if(error.code==='failed_to_download_image')return true
  return error.code==='invalid_image_url'&&typeof error.message==='string'&&/(?:error while downloading|failed to download|timeout while downloading) (?:image|https?:\/\/)/i.test(error.message)
 }catch{return false}
}
