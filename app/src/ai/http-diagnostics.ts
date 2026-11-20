// 仅对异常 HTTP 响应提取固定分类与请求标识，不保留正文、用户输入或密钥。
export async function diagnoseAiHttp(response:Response,uid:number,budgetMs:number):Promise<Record<string,string|number>>{
 const out:Record<string,string|number>={actor_uid:uid}
 for(const name of ['cf-ray','x-request-id','request-id']){
  const value=response.headers.get(name)
  if(value&&/^[a-zA-Z0-9_-]{8,100}$/.test(value))out['upstream_'+name.replaceAll('-','_')]=value
 }
 const server=response.headers.get('server')?.toLowerCase()??''
 out.http_server=server.includes('cloudflare')?'cloudflare':server.includes('envoy')?'envoy':server.includes('nginx')?'nginx':'other'
 const mime=response.headers.get('content-type')?.toLowerCase()??''
 out.http_format=mime.includes('json')?'json':mime.includes('html')?'html':mime.startsWith('text/')?'text':'other'
 if(response.headers.get('cf-mitigated')==='challenge')out.http_challenge=1
 if(response.status!==451||!response.body||budgetMs<=0)return out
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0,timer:ReturnType<typeof setTimeout>|undefined
 try{
  const read=async()=>{
   while(bytes<8192){const part=await reader.read();if(part.done)break;text+=decoder.decode(part.value.subarray(0,8192-bytes),{stream:true});bytes+=part.value.byteLength}
  }
  await Promise.race([read(),new Promise<void>(resolve=>{timer=setTimeout(()=>{out.http_diag_timeout=1;resolve()},Math.min(1000,budgetMs))})])
  out.http_diag_bytes=Math.min(bytes,8192)
  const markers:[string,RegExp][]=[
   ['cf_1009',/\b1009\b/],['cf_1020',/\b1020\b/],['cloudflare',/cloudflare/i],
   ['country',/countr(?:y|ies)/i],['region',/region|territor/i],['legal',/legal|sanction|export control/i],
   ['unsupported',/unsupported|not supported|not available/i],['blocked',/block|denied|forbidden/i],
   ['bot',/bot detection|captcha|challenge/i],['rate',/rate.?limit|too many/i],
   ['auth',/unauthori[sz]ed|invalid.*(?:key|token)|authentication/i],['policy',/policy|policies/i],
  ]
  out.http_markers=markers.filter(([,pattern])=>pattern.test(text)).map(([name])=>name).join('.')||'unclassified'
 }catch{out.http_diag_read_error=1}
 finally{if(timer!==undefined)clearTimeout(timer);void reader.cancel().catch(()=>{})}
 return out
}
