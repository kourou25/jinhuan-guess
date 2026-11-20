import type {Env} from '../env'
import {chat,type AiResult,type AiRuntime} from './gateway'
import {AiError} from './errors'
import {ensureAiBot,imageJobSource,publishImageReply} from './images'
import {imageReplyMedia} from './image-media'
import {filterAiText} from './filter'
import {settleImageJob,type AiJobEnd,type AiJobReason,type ClaimedAiJob} from './jobs'
import {imageReplyPrompt} from '../shared/ai-prompts'
import {aiProviders,aiSettings} from './config'
import {downloadImageInput,type InlineImage} from './image-input'

/** 只执行已经原子领取的任务；不做 waitUntil，不在这里循环领取其他任务。 */
export type ImageJobRuntime=Partial<AiRuntime>&{allowImageFallback?:boolean}
export async function executeImageJob(env:Env,job:ClaimedAiJob,run:ImageJobRuntime={}):Promise<AiJobEnd>{
 if(job.kind!=='img_reply')return 'lost'
 const ref={id:job.id,lease:job.lease_token},now=()=>Math.floor((run.now??Date.now)()/1000)
 const finish=(state:'pending'|'failed'|'skipped',reason:AiJobReason)=>settleImageJob(env.DB,ref,now(),state,reason)
 let fallback=false
 try{
  const source=await imageJobSource(env.DB,ref,now())
  if(!source)return finish('skipped','ineligible')
  if(!aiProviders(env,true).length)return finish('skipped','ai_disabled')
  const media=imageReplyMedia(source,env.EXT_HOSTS)
  if('reason' in media)return finish('skipped',media.reason)
  if(!(await ensureAiBot(env.DB,now())))return finish('failed','bot_collision')
  const beforeAttempt=async()=>{
   const current=await imageJobSource(env.DB,ref,now())
   return !!current&&current.revision===source.revision
  }
  const generate=(url:string,inlineImage?:InlineImage)=>chat(env,{feature:'img',uid:source.author_id,job:ref,vision:true,maxTokens:150,timeoutMs:20000,beforeAttempt,inlineImage,
   messages:[{role:'system',content:imageReplyPrompt},{role:'user',content:[
    {type:'text',text:JSON.stringify({title:source.title,content:Array.from(source.content).slice(0,200).join(''),tags:JSON.parse(source.tags)})},
    {type:'image_url',image_url:{url}},
   ]}]},run) as Promise<AiResult>
  let result:AiResult
  try{result=await generate(media.url)}catch(error){
   if(!(error instanceof AiError)||error.code!=='ai_image_fetch')throw error
   const settings=await aiSettings(env.DB,'img')
   if(!settings.enabled||!settings.paid||run.allowImageFallback===false)return finish('skipped','fetch')
   if(!(await beforeAttempt()))return finish('skipped','ineligible')
   fallback=true
   const image=await downloadImageInput(media.url,env.EXT_HOSTS,run.fetch??fetch)
   if('reason' in image)return finish('skipped',image.reason)
   result=await generate(image.image.url,image.image)
  }
  const text=filterAiText(result.text,40)
  if(!text)return finish('skipped','filtered')
  if(await publishImageReply(env.DB,ref,{text,model:result.model,revision:source.revision},now()))return 'done'
  return finish('skipped','ineligible')
 }catch(error){
  // 只持久化受控原因，不记录模型正文、URL、Key 或数据库异常原文。
  if(error instanceof AiError){
   if(error.code==='ai_image_fetch')return finish('failed','fetch')
   if(error.code==='ai_ineligible')return finish('skipped','ineligible')
   if(error.code==='ai_refused')return finish('skipped','filtered')
   if(['ai_disabled','ai_off','quota'].includes(error.code))return finish('skipped',error.code as AiJobReason)
   if(error.retryable&&!fallback)return finish('pending',error.code as AiJobReason)
   return finish('failed',error.code as AiJobReason)
  }
  return finish('failed','internal')
 }
}
