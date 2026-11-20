import type {Env} from '../env'
import {InvocationBudget,meterDatabase} from '../lib/budget'
import {aiProviders,aiSettings} from './config'
import {claimAiJob,recoverAiJobs} from './jobs'
import {executeImageJob} from './image-runner'
import type {AiRuntime} from './gateway'

export const IMAGE_CRON='*/5 * * * *'
const LIMIT=40,PAID_LIMIT=60,MAX_JOBS=5
// 含领取：最坏半开探测发送标记失败并退款为 25 SQL；保留一次 fetch 和两单位余量。
// Paid两次模型+图片抓取的双半开退款整轮实测40SQL+2fetch；每任务预留48。
// 只读取既有站长plan标记，不开通/升级套餐。Free仍维持40硬限。
const JOB_RESERVE=28,PAID_JOB_RESERVE=48
type CronRuntime=Partial<AiRuntime>&{warn?:(code:string)=>void;limit?:number}
export async function runImageCron(env:Env,runtime:CronRuntime={}){
 const budget=new InvocationBudget(Math.min(runtime.limit??PAID_LIMIT,PAID_LIMIT))
 let jobs=0,recovered=0,stopped:'disabled'|'budget'|'empty'|'limit'|'error'='disabled'
 const result=()=>({jobs,recovered,sql:budget.sql,fetches:budget.fetches,stopped})
 // 缺密钥不碰队列；生产保留关闭状态。
 if(!aiProviders(env,true).length)return result()
 const config={...env,DB:meterDatabase(env.DB,budget)}
 const run:Partial<AiRuntime>={...runtime,fetch:(input,init)=>budget.fetch(runtime.fetch??fetch,input,init)}
 // 租约以实际执行时间起算，平台延迟交付的 scheduledTime 不能用来新建租约。
 const currentTime=()=>Math.floor((runtime.now??Date.now)()/1000)
 try{
  const settings=await aiSettings(config.DB,'img')
  budget.restrict(settings.paid?PAID_LIMIT:LIMIT)
  if(!settings.enabled)return result()
  recovered=await recoverAiJobs(config.DB,currentTime(),'img_reply')
  while(jobs<MAX_JOBS){
   if(budget.remaining<(settings.paid?PAID_JOB_RESERVE:JOB_RESERVE)){stopped='budget';return result()}
   const job=await claimAiJob(config.DB,currentTime(),'img_reply')
   if(!job){stopped='empty';return result()}
   jobs++
   // 计划升级从下一轮生效，避免使用Free预留领取后进入Paid双调用路径。
   await executeImageJob(config,job,{...run,allowImageFallback:settings.paid})
  }
  stopped='limit'
 }catch{
  // 状态写回失败保留 running 等待租约恢复；不记录 SQL、密钥或上游原始异常。
  stopped='error';(runtime.warn??console.warn)('ai_image_cron_failed')
 }
 return result()
}
