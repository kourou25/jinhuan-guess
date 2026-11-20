import {AiError} from './errors'

// 猜词只在服务端收集正文，不把思考片段、谜底或半截 JSON 交给客户端。
export async function collectStructuredStream(read:()=>Promise<ReadableStreamReadResult<Uint8Array>>){
 const decoder=new TextDecoder()
 let buffer='',event:string[]=[],bytes=0,content='',finish:unknown,refusal=false,usage:unknown,done=false
 const consume=()=>{
  if(!event.length)return
  const data=event.join('\n');event=[]
  if(data==='[DONE]'){done=true;return}
  let chunk:any
  try{chunk=JSON.parse(data)}catch{throw new AiError('ai_upstream',502,false,'invalid_response')}
  if(!chunk||typeof chunk!=='object'||chunk.error)throw new AiError('ai_upstream',502,false,'invalid_response')
  if(chunk.usage)usage=chunk.usage
  const choice=chunk.choices?.[0]
  if(!choice)return
  if(choice.delta?.refusal)refusal=true
  if(typeof choice.delta?.content==='string')content+=choice.delta.content
  if(choice.finish_reason!==null&&choice.finish_reason!==undefined)finish=choice.finish_reason
 }
 while(!done){
  const part=await read()
  if(part.done){buffer+=decoder.decode();if(buffer.startsWith('data:'))event.push(buffer.slice(5).trimStart());consume();break}
  bytes+=part.value.byteLength
  if(bytes>1024*1024)throw new AiError('ai_upstream',502,false,'invalid_response')
  buffer+=decoder.decode(part.value,{stream:true})
  let end:number
  while(!done&&(end=buffer.indexOf('\n'))>=0){
   const line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1)
   if(!line)consume()
   else if(line.startsWith('data:'))event.push(line.slice(5).replace(/^ /,''))
  }
 }
 if(finish==='length')throw new AiError('ai_upstream',502,false,'output_limit')
 if(refusal||finish==='content_filter')throw new AiError('ai_refused',422)
 if(!done||finish!=='stop')throw new AiError('ai_upstream',502,true,'invalid_response')
 return {choices:[{message:{content},finish_reason:finish}],usage}
}
