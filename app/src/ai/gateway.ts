import type {Env} from '../env'
import {AiError} from './errors'
import {aiProviders,aiSettings} from './config'
import {guessProviders} from './guess-config'
import {reserveAiAttempt,markAiAttemptSent,refundAiAttempt,type AiFeature} from './quota'
import {acquireAiPermit,settleAiPermit,releaseAiPermit,recordAiAlert} from './breaker'
import {validAiJobIdentity,type AiJobIdentity} from './jobs'
import {isInlineImage,isImageDownloadError,type InlineImage} from './image-input'
import {collectStructuredStream} from './structured-stream'
import {configuredTaskProvider,connectionDraftProvider} from './connections'
import {AI_TASKS,type AiTask} from './connections-shared'
import {typeSafeRequest,typeSafeResult,type GuessEvaluation} from './typesafe'
import {diagnoseAiHttp} from './http-diagnostics'

type Message={role:'system'|'user'|'assistant';content:string|({type:'text';text:string}|{type:'image_url';image_url:{url:string}})[]}
export type AiChatInput={feature:AiFeature;uid:number;messages:Message[];guessEvaluation?:GuessEvaluation;guess?:boolean;guessReview?:boolean;guessTask?:'generation'|'similarity'|'yesno'|'hint';guessDraft?:boolean;connectionTest?:{revision:string;task:AiTask};vision?:boolean;stream?:boolean;maxTokens:number;json?:boolean;temperature?:number;timeoutMs:number;totalTimeoutMs?:number;signal?:AbortSignal;job?:AiJobIdentity;beforeAttempt?:()=>Promise<boolean>;inlineImage?:InlineImage}
export type AiResult={text:string;model:string;provider:string}
export type AiRuntime={fetch:typeof fetch;now:()=>number;log:(row:Record<string,unknown>)=>void}
type Runtime=AiRuntime
const runtime:Runtime={fetch:(...args)=>fetch(...args),now:()=>Date.now(),log:row=>console.info('ai_request',JSON.stringify(row))}
const second=(clock:()=>number)=>Math.floor(clock()/1000)
function deadline<T>(promise:Promise<T>,ms:number,abort:()=>void):Promise<T>{
 if(ms<=0){abort();return Promise.reject(new AiError('ai_upstream',502,true,'timeout'))}
 let timer:ReturnType<typeof setTimeout>
 return Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new AiError('ai_upstream',502,true,'timeout'));abort()},ms)})]).finally(()=>clearTimeout(timer))
}
function validate(input:AiChatInput){
 if(input.guessReview&&(input.feature!=='assistant'||input.uid!==0||input.guess||input.guessDraft||input.connectionTest||input.vision||input.stream||input.guessTask))throw new AiError('ai_input',400)
 if(input.connectionTest&&(input.feature!=='test'||input.guess||input.guessDraft||input.vision||input.stream||!AI_TASKS.includes(input.connectionTest.task)||typeof input.connectionTest.revision!=='string'))throw new AiError('ai_input',400)
 if(input.guessTask!==undefined&&(!(input.guess||input.guessDraft)||!['generation','similarity','yesno','hint'].includes(input.guessTask)))throw new AiError('ai_input',400)
 if((input.guess||input.guessDraft)&&(input.vision||input.stream||!['assistant','test'].includes(input.feature)))throw new AiError('ai_input',400)
 if(input.temperature!==undefined&&(!Number.isFinite(input.temperature)||input.temperature<0||input.temperature>2))throw new AiError('ai_input',400)
 if(input.inlineImage&&(!isInlineImage(input.inlineImage)||!input.job||input.feature!=='img'||!input.vision||input.stream))throw new AiError('ai_input',400)
 if(input.beforeAttempt!==undefined&&(!input.job||typeof input.beforeAttempt!=='function'))throw new AiError('ai_input',400)
 if(input.job&&(!validAiJobIdentity(input.job)||input.stream||input.uid<=0||!['img','road'].includes(input.feature)))throw new AiError('ai_input',400)
 if(!Number.isSafeInteger(input.uid)||!Number.isInteger(input.maxTokens)||input.maxTokens<1||input.maxTokens>16000||!Number.isInteger(input.timeoutMs)||input.timeoutMs<1||input.timeoutMs>60000||input.totalTimeoutMs!==undefined&&(!Number.isInteger(input.totalTimeoutMs)||input.totalTimeoutMs<1||input.totalTimeoutMs>60000))throw new AiError('ai_input',400)
 if(!Array.isArray(input.messages)||!input.messages.length||input.messages.length>64)throw new AiError('ai_input',400)
 let inlineCount=0
 for(const message of input.messages){
  if(!message||!['system','user','assistant'].includes(message.role))throw new AiError('ai_input',400)
  if(typeof message.content==='string')continue
  if(!input.vision||!Array.isArray(message.content)||message.content.length>8)throw new AiError('ai_input',400)
  for(const part of message.content){
   if(part?.type==='text'&&typeof part.text==='string')continue
   if(part?.type==='image_url'&&typeof part.image_url?.url==='string'){
    if(/^https:\/\//.test(part.image_url.url))continue
    if(input.inlineImage&&part.image_url.url===input.inlineImage.url&&++inlineCount===1)continue
   }
   throw new AiError('ai_input',400)
  }
 }
 if(input.inlineImage&&inlineCount!==1||JSON.stringify(input.messages).length>256000+(input.inlineImage?.url.length??0))throw new AiError('ai_input',400)
}
// 全站模型调用的唯一出口。runtimeOverrides 只供本地受控测试，不从 HTTP 请求接收。
export async function chat(env:Env,input:AiChatInput,runtimeOverrides:Partial<Runtime>={}):Promise<AiResult|Response>{
 validate(input)
 const run={...runtime,...runtimeOverrides},settings=await aiSettings(env.DB,input.feature)
 const task=input.guessTask??(!input.guessReview&&!input.guess&&!input.guessDraft&&!input.vision&&input.feature==='assistant'?'chat':undefined)
 const configured=input.connectionTest?await connectionDraftProvider(env,input.connectionTest.revision,input.connectionTest.task):!input.guessDraft&&task?await configuredTaskProvider(env,task):null
 const providers=input.guessReview?aiProviders(env,false).slice(0,1):configured?[configured]:input.guess||input.guessDraft?await guessProviders(env,!!input.guessDraft,input.guessTask):aiProviders(env,!!input.vision)
 if(input.guessReview&&providers.some(p=>p.protocol==='typesafe'||!/(?:^|\/)gpt[-\d]/i.test(p.model)))throw new AiError('ai_input',400)
 if(!settings.enabled||!providers.length)throw new AiError('ai_disabled',503)
 if(input.inlineImage&&!settings.paid)throw new AiError('ai_disabled',503)
 const started=run.now(),totalEnd=started+(input.totalTimeoutMs??(input.stream?60000:Math.min(60000,input.timeoutMs*providers.length)))
 let first=true,attempts=0,lastIssue:AiError|undefined
 for(let index=0;index<providers.length;index++){
  const provider=providers[index],permit=await acquireAiPermit(env.DB,second(run.now),provider.circuit??provider.name)
  if(!permit){if(index+1<providers.length)continue;const issue=lastIssue||new AiError('ai_off',503);if(!lastIssue)issue.reason='breaker';issue.attempts=attempts;throw issue}
  let sent=false,settled=false,status=0,usage:number|undefined,errorCode:string|undefined,failure:AiError['failure']
  const diagnostics:Record<string,string|number>={...(input.guessReview?{task:'guess_review'}:input.guessTask?{task:input.guessTask}:{}),...(provider.connectionId?{connection:provider.connectionId}:{}),phase:'prepare'}
  const controller=new AbortController(),abort=()=>controller.abort(),signal=input.signal
  const finish=async(outcome:'success'|'failure'|'neutral')=>{
   if(settled)return;settled=true
   if(sent){
    const opened=await settleAiPermit(env.DB,permit,second(run.now),outcome)
    if(opened)await recordAiAlert(env.DB,second(run.now),'breaker')
    run.log({feature:input.feature,provider:provider.name,model:provider.model,status,outcome,...(errorCode?{error_code:errorCode}:{}),...(failure?{failure}:{}),elapsed_ms:run.now()-started,...diagnostics,...(usage===undefined?{}:{total_tokens:usage})})
   }else await releaseAiPermit(env.DB,permit,second(run.now))
  }
  signal?.addEventListener('abort',abort,{once:true})
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined
  try{
   if(signal?.aborted)throw new AiError('ai_upstream',502)
   // 只对猜词 DeepSeek 模型发送思考参数；旧配置仍默认关闭，不影响普通聊天。
   const deepseek=(provider.name==='guess'||provider.name==='guess-test'||!!provider.guessOptions)&&/(?:^|\/)deepseek-(?:v[34](?:\.\d+)?(?:-(?:flash|pro))?|flash|chat|reasoner)$/i.test(provider.model)
   const thinking=deepseek&&!!provider.guessOptions?.thinking,maxTokens=provider.guessOptions?.maxTokens??input.maxTokens
   diagnostics.thinking_mode=deepseek?(thinking?'enabled':'disabled'):'unspecified'
   if(deepseek)diagnostics.reasoning_effort=thinking?'high':'none'
   diagnostics.max_tokens=maxTokens
   const native=provider.protocol==='typesafe',nativeTask=input.connectionTest?.task??task
   const nativeBody=native?typeSafeRequest(provider.model,nativeTask,input.connectionTest?{answers:['猫'],attempt:nativeTask==='yesno'?'是动物吗':'猫咪'}:input.guessEvaluation):null
   diagnostics.protocol=native?'typesafe':'openai'
   const structuredStream=!native&&!!(input.guessReview||input.guess||input.guessDraft||configured)&&(provider.guessOptions?.stream??true)
   const responseStream=!native&&!!input.stream&&(provider.guessOptions?.stream??true)
   diagnostics.stream=structuredStream||responseStream?1:0
   const body=JSON.stringify(nativeBody??{model:provider.model,messages:input.messages,max_tokens:maxTokens,temperature:input.temperature??0.7,stream:structuredStream||responseStream,...(deepseek?{thinking:{type:thinking?'enabled':'disabled'},reasoning_effort:thinking?'high':'none'}:{}),...(input.json&&settings.json?{response_format:{type:'json_object'}}:{})})
   const receipt=await reserveAiAttempt(env.DB,{feature:input.feature,uid:input.uid,t:second(run.now),first,personalMax:settings.personalMax,featureMax:settings.featureMax,globalMax:settings.globalMax,job:input.job})
   if(!receipt){
    const day=new Date(run.now()+28800000).toISOString().slice(0,10)
    const used=await env.DB.prepare("SELECT n FROM quota_usage WHERE day=? AND scope='ai:*' AND key=0").bind(day).first<{n:number}>()
    if((used?.n??0)>=settings.globalMax){await recordAiAlert(env.DB,second(run.now),'cap');const issue=new AiError('ai_off',503);issue.reason='cap';throw issue}
    throw new AiError('quota',429)
   }
   try{
    // 仅接受服务端任务闭包，HTTP 业务路由不透传此字段。失败仍处于未发送阶段，可退还本次预留。
    if(input.beforeAttempt&&!(await input.beforeAttempt()))throw new AiError('ai_ineligible',409)
    if(signal?.aborted||run.now()>=totalEnd)throw new AiError('ai_upstream',502)
    if(!(await markAiAttemptSent(env.DB,receipt,second(run.now))))throw new AiError('ai_upstream',502)
   }catch(error){await refundAiAttempt(env.DB,receipt,second(run.now));throw error}
   sent=true;first=false;attempts++
   // 专用模型没有下一路可切换；用满调用方现有总预算，避免在12/30秒提前中断。
   const firstEnd=(provider.name==='guess'||input.guessTask||configured)&&providers.length===1?totalEnd:Math.min(totalEnd,run.now()+input.timeoutMs)
   const attemptStarted=run.now()
   diagnostics.timeout_ms=firstEnd-attemptStarted;diagnostics.phase='headers'
   const relay=native&&provider.url==='https://api.typesafe.ai/v1/systemone'?env.JEV_RELAY:undefined
   const send=relay?relay.fetch.bind(relay):run.fetch
   if(relay)diagnostics.route='jev_tokyo'
   const response=await deadline(send(provider.url,{method:'POST',headers:{authorization:`Bearer ${provider.key}`,'content-type':'application/json'},body,redirect:'manual',signal:controller.signal}),firstEnd-run.now(),abort)
   if(relay){const ray=response.headers.get('cf-ray');if(ray&&/^[a-zA-Z0-9-]{1,80}$/.test(ray))diagnostics.upstream_cf_ray=ray}
   status=response.status
   diagnostics.headers_ms=run.now()-attemptStarted;diagnostics.phase='body';diagnostics.response_bytes=0
   if(!response.ok){
    Object.assign(diagnostics,await diagnoseAiHttp(response,input.uid,Math.max(0,firstEnd-run.now())))
    // 只识别图片任务的明确抓取错误。限8KiB并沿用请求总超时；不保存正文。
    if(input.job&&input.feature==='img'&&input.vision&&(status===400||status===422)&&response.body){
     reader=response.body.getReader();let errorText='',bytes=0;const decoder=new TextDecoder()
     while(true){const part=await deadline(reader.read(),firstEnd-run.now(),abort);if(part.done)break;bytes+=part.value.byteLength;if(bytes>8192)break;errorText+=decoder.decode(part.value,{stream:true})}
     errorText+=decoder.decode()
     if(bytes<=8192&&isImageDownloadError(errorText))throw new AiError('ai_image_fetch',502)
     void reader.cancel().catch(()=>{})
    }
    if(!reader&&!response.body?.locked)await response.body?.cancel()
    if(status===429)throw new AiError('ai_busy',503,true)
    if(status>=500)throw new AiError('ai_upstream',502,true,'http')
    await recordAiAlert(env.DB,second(run.now),'configuration')
    throw new AiError('ai_upstream',502,false,'http')
   }
   reader=response.body?.getReader()
   if(!reader)throw new AiError('ai_upstream',502,false,'empty')
   if(responseStream){
    if(!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream'))throw new AiError('ai_upstream',502)
    // 首字节超时包括响应头之后、正文迟迟没有到达的情况。
    const head=await deadline(reader.read(),firstEnd-run.now(),abort)
    if(head.done)throw new AiError('ai_upstream',502)
    let pending:Uint8Array|undefined=head.value,size=0,tail='',done=false,closed=false
    const upstream=reader,decoder=new TextDecoder()
    let totalTimer:ReturnType<typeof setTimeout>
    const cleanup=()=>{closed=true;clearTimeout(totalTimer);signal?.removeEventListener('abort',abort);abort();void upstream.cancel().catch(()=>{})}
    const bodyStream=new ReadableStream<Uint8Array>({
     start(sink){totalTimer=setTimeout(()=>{if(closed)return;cleanup();sink.error(new AiError('ai_upstream',502));void finish('failure').catch(()=>{})},Math.max(1,totalEnd-run.now()))},
     async pull(sink){
      try{
       if(closed)return
       if(signal?.aborted)throw new AiError('ai_upstream',502)
       const part=pending?{value:pending,done:false}:await deadline(upstream.read(),totalEnd-run.now(),abort);pending=undefined
       if(closed)return
       if(part.done)throw new AiError('ai_upstream',502,true)
       size+=part.value!.byteLength;if(size>2*1024*1024)throw new AiError('ai_upstream',502)
       const text=tail+decoder.decode(part.value,{stream:true});done=/(?:^|\n)data:\s*\[DONE\]\s*(?:\r?\n|$)/.test(text);tail=text.slice(-128)
       sink.enqueue(part.value!)
       if(done){await finish('success');if(!closed){cleanup();sink.close()}}
      }catch{if(!closed){cleanup();sink.error(new AiError('ai_upstream',502));await finish(signal?.aborted?'neutral':'failure')}}
     },
     async cancel(){cleanup();await finish('neutral')},
    })
    reader=undefined // 所有权移交给返回的流，外层 finally 不能取消。
    return new Response(bodyStream,{headers:{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no'}})
   }
   let data:{choices?:{message?:{content?:unknown;refusal?:unknown};finish_reason?:unknown}[];usage?:{total_tokens?:unknown;completion_tokens?:unknown;completion_tokens_details?:{reasoning_tokens?:unknown}}}
   let size=0
   const readPart=async()=>{const part=await deadline(reader!.read(),firstEnd-run.now(),abort);if(!part.done){if(diagnostics.first_byte_ms===undefined)diagnostics.first_byte_ms=run.now()-attemptStarted;size+=part.value.byteLength;diagnostics.response_bytes=size;if(size>1024*1024)throw new AiError('ai_upstream',502)}return part}
   if(structuredStream&&response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')){
    data=await collectStructuredStream(readPart) as typeof data
   }else{
    // 部分兼容中转忽略 stream，返回完整 JSON；仍按原有完整响应校验。
    let text='';const decoder=new TextDecoder()
    while(true){const part=await readPart();if(part.done)break;text+=decoder.decode(part.value,{stream:true})}
    text+=decoder.decode()
    try{data=JSON.parse(text)}catch{throw new AiError('ai_upstream',502,false,'invalid_response')}
   }
   diagnostics.phase='parse'
   if(!data||typeof data!=='object'||Array.isArray(data))throw new AiError('ai_upstream',502,false,'invalid_response')
   if(native){
    const result=typeSafeResult(data,nativeTask);usage=result.usage
    diagnostics.phase='complete';await finish('success')
    return {text:input.connectionTest?JSON.stringify({ok:true}):result.text,model:provider.model,provider:provider.name}
   }
   const tokenCount=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0
   if(tokenCount(data.usage?.total_tokens))usage=data.usage.total_tokens
   if(tokenCount(data.usage?.completion_tokens))diagnostics.completion_tokens=data.usage.completion_tokens
   if(tokenCount(data.usage?.completion_tokens_details?.reasoning_tokens))diagnostics.reasoning_tokens=data.usage.completion_tokens_details.reasoning_tokens
   const reason=data.choices?.[0]?.finish_reason
   if(typeof reason==='string'&&['stop','length','content_filter','tool_calls','function_call'].includes(reason))diagnostics.finish_reason=reason
   if(data.choices?.[0]?.message?.refusal)throw new AiError('ai_refused',422)
   if(input.json&&reason==='length')throw new AiError('ai_upstream',502,false,'output_limit')
   const result=data.choices?.[0]?.message?.content
   if(typeof result!=='string'||!result.trim())throw new AiError('ai_upstream',502,false,data.choices?.[0]?.finish_reason==='length'?'output_limit':'empty')
   diagnostics.phase='complete'
   await finish('success')
   if(input.stream)return new Response(`data: ${JSON.stringify({model:provider.model,choices:[{delta:{content:result},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store'}})
   return {text:result,model:provider.model,provider:provider.name}
  }catch(error){
   const issue=error instanceof AiError?error:new AiError('ai_upstream',502,true,'network')
   if(signal?.aborted)diagnostics.client_aborted=1
   issue.attempts=attempts;lastIssue=issue;errorCode=issue.code;failure=issue.failure
   await finish(sent&&!signal?.aborted&&issue.retryable&&issue.code!=='ai_busy'?'failure':'neutral')
   // 参数/鉴权/限流/重定向不切备；只有网络、超时和5xx允许另计一次备用调用。
   if(sent&&!signal?.aborted&&issue.retryable&&issue.code==='ai_upstream'&&index+1<providers.length&&run.now()<totalEnd)continue
   throw issue
  }finally{
   if(reader){void reader.cancel().catch(()=>{});signal?.removeEventListener('abort',abort);abort()}
   else if(settled||!sent)signal?.removeEventListener('abort',abort)
  }
 }
 throw new AiError('ai_upstream',502)
}
