import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {api} from './api'
type Job={id:number;target_id:number;state:string;attempts:number;run_after:number;err:string|null;updated_at:number}
const states:Record<string,string>={all:'全部',pending:'等待中',running:'回应中',done:'已回应',failed:'失败',skipped:'已跳过'}
const reasons:Record<string,string>={ineligible:'图片状态已变化',filtered:'没有合适的回应',gif:'动图暂不支持',image:'图片不可用',fetch:'图片暂时无法读取',size:'图片超过处理上限',bot_collision:'机器人账号不可用',ai_disabled:'功能已关闭',ai_off:'功能已关闭',quota:'今日额度已用完',ai_busy:'服务繁忙',ai_upstream:'模型服务暂不可用',ai_input:'图片请求不支持',internal:'任务异常',interrupted:'执行中断',user_disabled:'作者已关闭',post_disabled:'本帖已关闭'}
export function AiJobs(){
 const [state,setState]=useState('all'),[before,setBefore]=useState<number|null>(null)
 const client=useQueryClient(),query=useQuery({queryKey:['admin','ai-jobs',state,before],queryFn:()=>api<{jobs:Job[];next:number|null}>(`/api/admin/ai/jobs?state=${state}${before?'&before='+before:''}`),retry:false})
 const retry=useMutation({mutationFn:(id:number)=>api(`/api/admin/ai/jobs/${id}/retry`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),onSuccess:()=>client.invalidateQueries({queryKey:['admin','ai-jobs']})})
 const busy=query.isFetching||retry.isPending
 return <section className="ai-jobs" aria-labelledby="ai-jobs-title">
  <div className="ai-heading"><h2 id="ai-jobs-title">看图回应记录</h2><button disabled={busy} onClick={()=>{retry.reset();query.refetch()}}>刷新任务</button></div>
  <label htmlFor="ai-job-state">任务状态</label><select id="ai-job-state" value={state} disabled={retry.isPending} onChange={e=>{setState(e.target.value);setBefore(null);retry.reset()}}>{Object.entries(states).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
  {retry.error&&<p role="alert">{retry.error.message}</p>}{retry.isSuccess&&<p role="status">已重新排队</p>}
  {query.isPending?<p role="status">正在读取任务…</p>:query.error?<div role="alert"><p>{query.error.message}</p><button onClick={()=>query.refetch()}>重新读取任务</button></div>:<>
   {!query.data?.jobs.length?<p className="empty">没有这类任务</p>:<ul className="ai-job-list">{query.data.jobs.map(job=><li key={job.id}>
    <div><a href={`/m/${job.target_id}`}>No.{job.target_id}</a><strong>{states[job.state]??'状态未知'}</strong></div>
    <p>{job.err?reasons[job.err]??'任务异常':job.state==='pending'?`等待至 ${new Date(job.run_after*1000).toLocaleString('zh-CN')}`:`更新于 ${new Date(job.updated_at*1000).toLocaleString('zh-CN')}`}</p>
    <div><span>已尝试 {job.attempts} 次</span>{job.state==='failed'&&<button className="ai-job-retry" disabled={busy} onClick={()=>retry.mutate(job.id)}>{retry.isPending&&retry.variables===job.id?'排队中…':'重试'}</button>}</div>
   </li>)}</ul>}
   <div className="ai-job-pagination"><button disabled={busy||before===null} onClick={()=>{setBefore(null);retry.reset()}}>返回最新</button><button disabled={busy||!query.data?.next} onClick={()=>{setBefore(query.data?.next??null);retry.reset()}}>下一页</button></div>
  </>}
 </section>
}
