import {useRef,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {api} from './api'
import './ai-guess-model.css'
import {GUESS_TASKS,guessTaskDefaults,type GuessTask,type GuessTaskSettings} from '../../src/ai/guess-tasks'
const taskLabels:Record<GuessTask,string>={generation:'出题',hint:'给线索',similarity:'相关度',yesno:'是非判断'}

type Config={revision:string;base:string;model:string;tasks?:GuessTaskSettings;has_key:boolean;ready:boolean}
type State={draft:Config|null;active:Config|null;can_store_key:boolean}
type Form={revision:string|null;base:string;model:string;key:string;clear_key:boolean;tasks:GuessTaskSettings}
const formOf=(c:Config|null):Form=>({revision:c?.revision??null,base:c?.base??'',model:c?.model??'',key:'',clear_key:false,tasks:Object.fromEntries(GUESS_TASKS.map(task=>[task,c?.tasks?.[task]??guessTaskDefaults(task)]))})
export function AiGuessModel(){
 const client=useQueryClient(),dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement>(null)
 const [opened,setOpened]=useState(false),[form,setForm]=useState<Form|null>(null),[notice,setNotice]=useState(''),[testTask,setTestTask]=useState<GuessTask>('generation')
 const query=useQuery({queryKey:['admin','guess-model'],queryFn:()=>api<State>('/api/admin/ai/guess-model'),enabled:opened,retry:false})
 const values=form??formOf(query.data?.draft??null),saved=query.data?.draft
 const dirty=JSON.stringify(values)!==JSON.stringify(formOf(saved??null))
 const save=useMutation({mutationFn:()=>api<State>('/api/admin/ai/guess-model',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(values)}),onSuccess:data=>{client.setQueryData(['admin','guess-model'],data);setForm(null);test.reset();setNotice('草稿已保存，当前模型未切换。')}})
 const action=useMutation({mutationFn:(kind:'activate'|'disable')=>api<State>('/api/admin/ai/guess-model/'+kind,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(kind==='activate'?{revision:saved?.revision}:{})}),onSuccess:(data,kind)=>{client.setQueryData(['admin','guess-model'],data);setNotice(kind==='activate'?'猜词专用配置已启用，后续猜词 AI 请求按用途选择模型。':'已恢复沿用现有文字模型。')}})
 const test=useMutation({mutationFn:()=>api<{structured:boolean;model:string;elapsed_ms:number}>('/api/admin/ai/guess-model/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:saved?.revision,task:testTask})}),onSettled:()=>client.invalidateQueries({queryKey:['admin','ai']})})
 const busy=save.isPending||action.isPending||test.isPending
 const change=(part:Partial<Form>)=>{setForm({...values,...part});setNotice('');save.reset();action.reset();test.reset()}
 const close=()=>{if(busy)return;dialog.current?.close();setOpened(false);setForm(null);opener.current?.focus()}
 return <section className="ai-guess-model"><h2>猜词专用模型</h2><p>分别配置出题、线索、相关度和是非判断的模型及思考模式。未启用时沿用现有文字模型。</p>
  <button ref={opener} type="button" onClick={()=>{setNotice('');save.reset();action.reset();test.reset();setOpened(true);dialog.current?.showModal()}}>配置猜词模型</button>
  <dialog ref={dialog} className="ai-model-dialog" aria-labelledby="guess-model-title" onCancel={e=>{e.preventDefault();close()}}>
   <div className="ai-model-dialog-head"><h2 id="guess-model-title">猜词模型配置</h2><button type="button" disabled={busy} onClick={close}>关闭</button></div>
   {query.isPending?<p role="status">正在读取配置…</p>:query.error?<><p role="alert">{query.error.message}</p><button onClick={()=>query.refetch()}>重新读取</button></>:query.data&&<>
    <p className="ai-model-current">当前：{query.data.active?`已启用专用模型 · ${query.data.active.model}`:'沿用现有文字模型'}{!saved&&' · 尚未保存专用配置'}</p>
    {query.data.active&&<details className="ai-model-active"><summary>查看当前四项生效设置</summary><ul>{GUESS_TASKS.map(task=>{const active=query.data.active!,row=active.tasks?.[task]??guessTaskDefaults(task);return <li key={task}>{taskLabels[task]}：{row.source==='site'?'本站文字通道':'专用通道'} · {row.model||(row.source==='site'?'本站默认模型':active.model)} · 思考{row.thinking?'开':'关'} · {row.maxTokens} Token · {row.stream===false?'非流式':'流式'}</li>})}</ul></details>}
    <p className="hint">接口采用 OpenAI 兼容 Chat Completions 协议。模型 ID 以服务商提供的完整名称为准，支持后续填写 Muse 等模型。</p>
    <form onSubmit={e=>{e.preventDefault();save.mutate()}} autoComplete="off">
     <label>服务基础地址<input type="url" maxLength={512} placeholder="https://服务域名/v1" value={values.base} disabled={busy} onChange={e=>change({base:e.target.value})}/></label>
     <label>专用通道默认模型 ID<input maxLength={100} placeholder="填写完整模型 ID，可稍后补充" value={values.model} disabled={busy} onChange={e=>change({model:e.target.value})}/></label>
     <label>API Key<input type="password" autoComplete="new-password" maxLength={512} value={values.key} disabled={busy||!query.data.can_store_key} placeholder={saved?.has_key?'已加密保存，留空保留原密钥':'填写服务密钥，可稍后补充'} onChange={e=>change({key:e.target.value,clear_key:false})}/></label>
     {saved?.has_key&&<label className="ai-toggle"><input type="checkbox" checked={values.clear_key} disabled={busy} onChange={e=>change({clear_key:e.target.checked,key:''})}/>清除草稿中的密钥</label>}
     {!query.data.can_store_key&&<p role="alert">服务端加密配置未就绪，当前可保存地址和模型，暂不能保存密钥。</p>}
     <p className="hint">密钥仅加密保存在服务端，不回显。保存草稿不会影响已启用配置；更换服务地址需重新填写密钥。</p>
     <section className="ai-task-settings" aria-label="按用途配置">
      <h3>按用途配置</h3>
      <p className="hint">模型留空沿用所选通道的默认模型。本站文字通道使用原有地址和密钥，专用通道使用上方配置；不会自动跨通道兜底。</p>
      {GUESS_TASKS.map(task=>{const row=values.tasks[task]??guessTaskDefaults(task);const update=(part:Partial<typeof row>)=>change({tasks:{...values.tasks,[task]:{...row,...part}}});return <fieldset key={task} disabled={busy} className="ai-task-row"><legend>{taskLabels[task]}</legend>
       <label>通道<select aria-label={`${taskLabels[task]}通道`} value={row.source} onChange={e=>update({source:e.target.value as typeof row.source})}><option value="dedicated">猜词专用通道</option><option value="site">本站文字通道</option></select></label>
       <label>模型 ID<input aria-label={`${taskLabels[task]}模型`} maxLength={100} placeholder={row.source==='dedicated'?(values.model||'沿用默认模型'):'沿用本站文字模型'} value={row.model} onChange={e=>update({model:e.target.value})}/></label>
       <label>响应方式<select aria-label={`${taskLabels[task]}响应方式`} value={row.stream===false?'json':'stream'} onChange={e=>update({stream:e.target.value==='stream'})}><option value="stream">流式接收，完整校验</option><option value="json">非流式完整响应</option></select></label>
       <label className="ai-toggle"><input type="checkbox" aria-label={`${taskLabels[task]}开启DeepSeek思考`} checked={row.thinking} onChange={e=>update({thinking:e.target.checked,...(e.target.checked&&row.maxTokens<2048?{maxTokens:2048}:{})})}/>开启 DeepSeek 思考</label>
       <label>输出上限（Token）<input aria-label={`${taskLabels[task]}输出上限`} type="number" min={64} max={16000} step={1} value={row.maxTokens} onChange={e=>update({maxTokens:Number(e.target.value)})}/></label>
      </fieldset>})}
      <p className="hint">思考默认关闭，仅对 DeepSeek 模型发送对应参数。开启时输出上限至少调整为2048，可再修改；思考与正文共用额度，可能更慢、费用更高。出题最长45秒，其他用途20秒。默认由服务端流式接收，收齐并校验后使用，不向前端发送谜底或思考片段；中转不支持时可切非流式。</p>
     </section>
     <button type="submit" disabled={busy||!!saved&&!dirty}>{save.isPending?'保存中…':'保存草稿'}</button>
    </form>
    <label className="ai-model-test-task">测试用途<select value={testTask} disabled={busy} onChange={e=>{setTestTask(e.target.value as GuessTask);test.reset()}}>{GUESS_TASKS.map(task=><option key={task} value={task}>{taskLabels[task]}</option>)}</select></label>
    <div className="ai-model-actions"><button type="button" disabled={busy||dirty||!saved?.ready} onClick={()=>test.mutate()}>{test.isPending?'测试中…':`测试${taskLabels[testTask]}配置`}</button><button type="button" className="primary" disabled={busy||dirty||!saved?.ready||saved.revision===query.data.active?.revision} onClick={()=>action.mutate('activate')}>启用专用配置</button>{query.data.active&&<button type="button" disabled={busy} onClick={()=>action.mutate('disable')}>恢复沿用现有模型</button>}</div>
    <p className="hint">测试会调用一次模型并计入全站额度。启用后仍遵守全站开关、额度及单轮上限；普通聊天保持现有配置。</p>
    {test.data&&<p role="status">连接成功 · {test.data.model} · {(test.data.elapsed_ms/1000).toFixed(2)} 秒。{test.data.structured?'结构化响应正常。':'结构化响应不符合预期，启用前请核对模型兼容性。'}连接测试不代表猜词判题质量已经验证。</p>}
    {notice&&<p role="status">{notice}</p>}
    {(save.error||action.error||test.error)&&<p role="alert">{(save.error||action.error||test.error)?.message}</p>}
   </>}
  </dialog>
 </section>
}
