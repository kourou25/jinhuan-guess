import {useEffect,useRef,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {api} from './api'
import {AiJobs} from './ai-jobs'
import {AiGuessCheck} from './ai-guess-check'
import {AiConnections} from './ai-connections'
type Circuit={status:string;until:number;fails:number}
type State={settings:Record<string,string|number>;invalid:string[];providers:Record<'primary'|'vision'|'fallback',{ready:boolean;model:string|null}>;circuits?:Record<'primary'|'vision'|'fallback',Circuit>;day:string;used:number;breaker:Circuit;checkedAt:number;available:boolean;can_enable?:boolean}
const features=[['img','看图评论'],['summary','群聊摘要'],['assistant','群聊助手'],['road','鞭打评审'],['report','AI 日报'],['test','服务测试']] as const
export function AdminAi(){
 const client=useQueryClient(),query=useQuery({queryKey:['admin','ai'],queryFn:async()=>({...await api<State>('/api/admin/ai'),receivedAt:Date.now()}),retry:false,refetchOnWindowFocus:'always'})
 const [draft,setDraft]=useState<Record<string,string|number>>({})
 const values={...query.data?.settings,...draft},refreshedUntil=useRef(0)
 const {data,refetch}=query
 useEffect(()=>{
  if(!data||data.breaker.status!=='open'||data.breaker.until<=0||refreshedUntil.current===data.breaker.until)return
  // One status read at the deadline, based on server time. No polling or model calls.
  const checkedAt=Number.isFinite(data.checkedAt)?data.checkedAt:Math.floor(data.receivedAt/1000)
  const delay=Math.max(0,(data.breaker.until-checkedAt)*1000-(Date.now()-data.receivedAt))+500
  const timer=setTimeout(()=>{
   if(document.visibilityState!=='visible')return
   refreshedUntil.current=data.breaker.until
   void refetch()
  },delay)
  return()=>clearTimeout(timer)
 },[data,refetch])
 const save=useMutation({mutationFn:(settings:Record<string,string|number>)=>api('/api/admin/ai',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({settings})}),onSuccess:(_,settings)=>{
  client.setQueryData<State>(['admin','ai'],old=>old?{...old,settings}:old)
  setDraft({})
  return client.invalidateQueries({queryKey:['admin','ai']})
 }})
 const probe=useMutation({mutationFn:()=>api('/api/admin/ai/probe',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),onSuccess:()=>client.invalidateQueries({queryKey:['admin','ai']})})
 const change=(key:string,value:string|number)=>{setDraft(old=>({...old,[key]:value}));save.reset()}
 const toggle=(key:string,label:string,disabled=false)=><label className="ai-toggle"><input id={key} type="checkbox" checked={values[key]==='on'} disabled={disabled||save.isPending} onChange={e=>change(key,e.target.checked?'on':'off')}/>{label}</label>
 const number=(key:string,label:string,max=100000)=><label className="ai-number" htmlFor={key}>{label}<input id={key} type="number" min="0" max={max} step="1" required value={values[key]??''} disabled={save.isPending} onChange={e=>change(key,e.target.value===''?'':Number(e.target.value))}/></label>
 return <div className="page"><header><a className="brand" href="/"><img src="/logo.svg" alt=""/>尽欢</a><a href="/admin/flags">管理设置</a></header><main className="ai-page">
  <div className="ai-heading"><h1>AI 小伙伴</h1><button type="button" disabled={query.isFetching||save.isPending} onClick={()=>{save.reset();query.refetch()}}>刷新状态</button></div>
  {query.isPending?<p role="status">正在读取…</p>:query.error?<div role="alert"><p>{query.error.message}</p><button onClick={()=>query.refetch()}>重试</button></div>:data&&<>
   <section className="ai-status" aria-label="默认文字通道状态"><span>默认文字通道</span><strong>{data.available?'服务已就绪':data.breaker.status==='invalid'?'运行状态异常':data.breaker.status==='open'?'服务暂停中':data.breaker.status==='half_open'?'等待恢复探测':!data.providers.primary.ready?'等待模型配置':data.settings['ai.enabled']==='off'?'服务已关闭':'服务暂不可用'}</strong><span>今日 {data.used} / {data.settings['ai.daily.max']} 次</span><span>{data.day} · 北京时间</span></section>
   {data.breaker.status==='open'&&<p role="status">上游连续失败，已触发临时保护。北京时间 {new Date(data.breaker.until*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} 起，下一次 AI 请求会探测恢复。</p>}
   {data.breaker.status==='half_open'&&<p role="status">暂停期已结束，下一次 AI 请求会探测恢复；当前尚未确认恢复。</p>}
   {data.providers.primary.ready&&data.settings['ai.enabled']==='on'&&data.circuits?.primary.status==='open'&&<div className="ai-probe"><button type="button" disabled={probe.isPending} onClick={()=>probe.mutate()}>{probe.isPending?'处理中…':'提前允许文字模型探测'}</button><p>确认 CPA 已恢复后使用。仅把冷却改为单次探测机会；下一次 AI 请求仍会实际验证，失败会继续保护。</p>{probe.error&&<p role="alert">{probe.error.message}</p>}{probe.isSuccess&&<p role="status">已允许下一次请求提前探测，尚未确认模型恢复。</p>}</div>}
   {!!data.invalid.length&&<p role="alert">设置异常：{data.invalid.join('、')}。检查后重新保存。</p>}
   <dl className="ai-models">{([['primary','文字模型'],['vision','看图模型'],['fallback','备用模型']] as const).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{data.providers[key].ready?<>{data.providers[key].model}{data.circuits?.[key]&&` · ${{closed:'可用',open:'冷却恢复中',half_open:'等待下次请求探测',invalid:'状态异常'}[data.circuits[key].status]||'待核对'}`}</>:'未配置'}</dd></div>)}</dl>
   <details open={!data.providers.primary.ready}><summary>接入模型与使用方法</summary>
    <p>在 Cloudflare 控制台打开 Workers 和 Pages → meme-hall → 设置 → 变量和机密，配置服务地址、模型名称和 API Key，部署后回到这里刷新状态。</p>
    <p>文字模型：<code>AI_BASE_URL</code>、<code>AI_MODEL</code>；密钥选择 Secret 类型，名称为 <code>AI_API_KEY</code>。地址填写兼容接口的 HTTPS 基础地址（通常以 /v1 结尾）。</p>
    <p>看图功能必须设置支持图片的 <code>AI_VISION_MODEL</code>；可复用文字模型的地址和密钥，或另设 <code>AI_VISION_BASE_URL</code> 和 <code>AI_VISION_API_KEY</code>。备用文字模型使用对应的 <code>AI_FALLBACK_</code> 三项配置。</p>
    <p>配置就绪后启用 AI 和所需功能并保存。群聊的“更多聊天操作 → 欢欢助手”提供聊天、是非提问和猜答案入口，也保留私有助手和群聊总结；看图评论还需在个人偏好和发帖时允许。未配置时不会调用模型。</p>
    <a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">打开 Cloudflare 配置</a>
   </details>
   <form onSubmit={e=>{e.preventDefault();save.mutate(values)}}>
    <div className="ai-controls">{toggle('ai.enabled','启用 AI',!(data.can_enable??data.providers.primary.ready)&&values['ai.enabled']!=='on')}{toggle('ai.json_mode','JSON 输出模式')}</div>
    {number('ai.daily.max','全站每日请求上限',10000)}
    <h2>功能与额度</h2><p className="hint">不设个人每日次数上限。全站额度按北京时间每日计算，发送频率保护仍生效。</p>
    <div className="ai-features">{features.map(([key,label])=><div key={key}>{toggle(`ai.${key}.enabled`,label)}{key==='img'&&number('ai.img.daily_max','全站图片次数')}</div>)}</div>
    <h2>🍌兑换 AI 券</h2>
    {toggle('ai.voucher.enabled','开放 AI 券兑换',true)}
    <p className="hint">本次仅保存兑换配置，兑换保持关闭，不扣🍌、不增加 AI 调用。价格以每次调用的🍌数计；日限以调用次数计，0 表示未配置。正式开放前还需启用预算校验与券核销。</p>
    <div className="ai-features">{number('ai.voucher.price','每次调用价格（🍌）')}{number('ai.voucher.user_daily_max','每人每日兑换上限（次）')}{number('ai.voucher.site_daily_max','全站每日兑换预算（次）',10000)}</div>
    <h2>猜词判题复核</h2>
    {toggle('ai.guess.review.enabled','开启 GPT 判题复核')}
    <p className="hint">每 5 次成功的新判题，由 Cloudflare 主文字模型（{data.providers.primary.model||'未配置'}）逐条复核这 5 条原回答，错误会更正。审核另计全站额度，不增加本轮 AI 次数或追加奖励。</p>
    <p className="hint">关闭后保留 Jev 首答和已完成的纠正，暂停未完成审核；重新开启后继续。保存后生效。已发往上游的请求无法撤回，但关闭后不会写回更正。</p>
    <button className="primary" type="submit" disabled={save.isPending||!Object.entries(draft).some(([key,value])=>value!==data.settings[key])}>{save.isPending?'保存中…':'保存 AI 设置'}</button>
    {save.error&&<p role="alert">{save.error.message}</p>}{save.isSuccess&&<p role="status">已保存</p>}
   </form>
   <AiConnections/>
   <AiGuessCheck/>
   <AiJobs/>
  </>}
 </main></div>
}
