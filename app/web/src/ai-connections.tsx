import {useRef,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {api} from './api'
import {AiGuessModel as LegacyGuessModel} from './ai-guess-model'
import {AI_TASKS,taskLabels,connectionTaskDefault,type AiTask,type ConnectionTasks} from '../../src/ai/connections-shared'
import './ai-connections.css'
import {isTypeSafe,supportsTypeSafeTask} from '../../src/ai/protocol'
type Connection={id:string;name:string;base:string;model:string;has_key:boolean;ready:boolean;readonly?:boolean}
type Config={revision:string;connections:Connection[];tasks:ConnectionTasks;ready:boolean}
type State={draft:Config|null;active:Config|null;catalog:Connection[];can_store_key:boolean;runtime?:Record<string,{model:string|null;status:string;until:number}>}
type Edit={id:string;name:string;base:string;model:string;key:string;clear_key:boolean}
type Form={revision:string|null;connections:Edit[];tasks:ConnectionTasks}
const formOf=(c:Config|null):Form=>({revision:c?.revision??null,connections:c?.connections.map(r=>({id:r.id,name:r.name,base:r.base,model:r.model,key:'',clear_key:false}))??[],tasks:c?.tasks??{}})
const endpoint='/api/admin/ai/connections',queryKey=['admin','ai-connections']
export function AiConnections(){
 const client=useQueryClient(),dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement>(null)
 const [opened,setOpened]=useState(false),[form,setForm]=useState<Form|null>(null),[notice,setNotice]=useState(''),[pane,setPane]=useState<'connections'|'tasks'>('connections'),[selected,setSelected]=useState(''),[testTask,setTestTask]=useState<AiTask>('generation')
 const query=useQuery({queryKey,queryFn:()=>api<State>(endpoint),enabled:opened,retry:false})
 const values=form??formOf(query.data?.draft??null),saved=query.data?.draft,dirty=JSON.stringify(values)!==JSON.stringify(formOf(saved??null))
 const reset=(data:State)=>{client.setQueryData(queryKey,data);setForm(null);void client.invalidateQueries({queryKey:['admin','ai']})}
 const save=useMutation({mutationFn:()=>api<State>(endpoint,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(values)}),onSuccess:data=>{reset(data);setNotice('草稿已保存。启用后才会改变实际调用。')}})
 const action=useMutation({mutationFn:(kind:'activate'|'disable')=>api<State>(endpoint+'/'+kind,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:kind==='activate'?saved?.revision:query.data?.active?.revision})}),onSuccess:(data,kind)=>{reset(data);setNotice(kind==='activate'?'用途分配已生效。各用途使用所选连接的地址、模型和密钥。':'已恢复原有配置，连接草稿保留。')}})
 const test=useMutation({mutationFn:()=>api<{structured:boolean;model:string;elapsed_ms:number}>(endpoint+'/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:saved?.revision,task:testTask})}),onSettled:()=>client.invalidateQueries({queryKey:['admin','ai']})})
 const busy=save.isPending||action.isPending||test.isPending
 const change=(f:Form)=>{setForm(f);setNotice('');save.reset();action.reset();test.reset()}
 const update=(id:string,part:Partial<Edit>)=>change({...values,connections:values.connections.map(r=>r.id===id?{...r,...part}:r)})
 const add=(name='新连接')=>{const id=(name==='Jev'?'jev-':'conn-')+crypto.randomUUID().slice(0,8);change({...values,connections:[...values.connections,{id,name,base:name==='Jev'?'https://api.typesafe.ai/v1/systemone':'',model:name==='Jev'?'jev-1.13.0':'',key:'',clear_key:false}]});setSelected(id);setPane('connections')}
 const close=()=>{if(busy)return;dialog.current?.close();setOpened(false);setForm(null);opener.current?.focus()}
 const catalog=query.data?.catalog??[],all:Connection[]=[...catalog,...values.connections.map(r=>({...r,ready:!!r.base&&!!r.model&&!!(r.key||!r.clear_key&&saved?.connections.find(c=>c.id===r.id)?.has_key),has_key:!!saved?.connections.find(c=>c.id===r.id)?.has_key}))]
 const compatible=(task:AiTask,c:Connection)=>!isTypeSafe(c.base)||supportsTypeSafeTask(task)
 const chosen=all.find(c=>c.id===selected)??all[0],edit=values.connections.find(c=>c.id===chosen?.id)
 return <section className="ai-guess-model"><h2>模型连接与用途</h2><p>分别选择出题、线索、判题和普通对话使用的连接。每个连接拥有独立的服务地址、模型和密钥。</p>
  <button ref={opener} onClick={()=>{setOpened(true);setNotice('');save.reset();action.reset();test.reset();dialog.current?.showModal()}}>管理模型连接</button>
  <dialog ref={dialog} className="ai-model-dialog ai-connections-dialog" aria-labelledby="ai-connections-title" onCancel={e=>{e.preventDefault();close()}}>
   <div className="ai-model-dialog-head"><h2 id="ai-connections-title">模型连接与用途</h2><button disabled={busy} onClick={close}>关闭</button></div>
   {query.isPending?<p role="status">正在读取连接…</p>:query.error?<><p role="alert">{query.error.message}</p><button onClick={()=>query.refetch()}>重新读取</button></>:query.data&&<>
    <p className="ai-model-current">{query.data.active?'独立用途分配已启用':'当前沿用原有配置'}{dirty?' · 有未保存修改':''}</p>
    {query.data.active&&<details><summary>当前生效的用途分配</summary><ul>{AI_TASKS.map(task=>{const id=query.data!.active!.tasks[task]?.connection,r=query.data!.runtime?.[task];return <li key={task}>{taskLabels[task]}：{id?[...catalog,...query.data!.active!.connections].find(c=>c.id===id)?.name??id:'沿用原有设置'}{r&&` · ${r.model??'配置不完整'} · ${{closed:'可用',open:'冷却中',half_open:'等待探测',unconfigured:'不可用',invalid:'状态异常'}[r.status]??r.status}`}</li>})}</ul></details>}
    <nav className="ai-connection-tabs" aria-label="模型配置分类"><button aria-pressed={pane==='connections'} onClick={()=>setPane('connections')}>连接目录</button><button aria-pressed={pane==='tasks'} onClick={()=>setPane('tasks')}>用途分配</button></nav>
    <form autoComplete="off" onSubmit={e=>{e.preventDefault();save.mutate()}}>
     {pane==='connections'?<>
      <div className="ai-connection-add"><button type="button" disabled={busy||values.connections.length>=10} onClick={()=>add()}>添加连接</button><button type="button" disabled={busy||values.connections.length>=10} onClick={()=>add('Jev')}>添加 Jev 连接</button><span>{values.connections.length}/10 个自定义连接</span></div>
      <div className="ai-connection-workspace"><nav aria-label="已配置连接" className="ai-connection-list">{all.map(c=><button type="button" key={c.id} aria-pressed={chosen?.id===c.id} onClick={()=>setSelected(c.id)}><strong>{c.name}</strong><span>{c.ready?'配置完整':'待补充'} · {c.readonly?'只读引用':'独立密钥'}</span></button>)}</nav>
       <section className="ai-connection-editor" aria-label="连接详情">{chosen&&(edit?<>
        <label>连接名称<input value={edit.name} maxLength={60} disabled={busy} onChange={e=>update(edit.id,{name:e.target.value})}/></label>
        <label>服务基础地址<input type="url" value={edit.base} maxLength={512} disabled={busy} placeholder="https://服务域名/v1" onChange={e=>update(edit.id,{base:e.target.value})}/></label>
        <label>模型 ID<input value={edit.model} maxLength={100} disabled={busy} placeholder="服务方提供的完整模型 ID" onChange={e=>update(edit.id,{model:e.target.value})}/></label>
        <label>API Key<input type="password" autoComplete="new-password" value={edit.key} maxLength={512} disabled={busy||!query.data.can_store_key} placeholder={chosen.has_key?'已加密保存，留空保留':'可先保存空白草稿'} onChange={e=>update(edit.id,{key:e.target.value,clear_key:false})}/></label>
        {chosen.has_key&&<label className="ai-toggle"><input type="checkbox" checked={edit.clear_key} disabled={busy} onChange={e=>update(edit.id,{clear_key:e.target.checked,key:''})}/>清除草稿密钥</label>}
        <p className="hint">每个连接单独加密保存。更换地址须重新填写密钥；尚未填写完整的 Jev 等连接可以保存草稿，不能用于正式调用。官方 api.typesafe.ai 地址使用 Jev 原生协议，仅支持相关度和是非判断；其余连接须支持 OpenAI Chat Completions。</p>
        <button type="button" disabled={busy||Object.values(query.data.active?.tasks??{}).some(r=>r.connection===edit.id)||Object.values(values.tasks).some(r=>r.connection===edit.id)} onClick={()=>{change({...values,connections:values.connections.filter(r=>r.id!==edit.id)});setSelected('')}}>删除此连接</button>
        <p className="hint">如需删除正在使用的连接，先更改用途分配并启用。</p>
       </>:<><h3>{chosen.name}</h3><dl><dt>服务基础地址</dt><dd>{chosen.base||'未配置'}</dd><dt>模型 ID</dt><dd>{chosen.model||'未配置'}</dd><dt>密钥</dt><dd>{chosen.has_key?'已配置，不回显':'未配置'}</dd></dl><p>此连接引用{chosen.id==='legacy-guess'?'原猜词专用配置':'Cloudflare 参数'}。在“用途分配”中可直接选择，不会改写已有密钥。</p>{chosen.id==='cf-vision'&&<p className="hint">服务方须支持文字调用；配置完整不等于能力验证通过。</p>}</>)}</section>
      </div>
     </>:<section className="ai-connection-tasks" aria-label="按用途选择连接"><p>“沿用原有设置”保留既有路由。选择连接后使用该连接自己的地址、密钥和模型，不自动跨连接兜底。</p>{AI_TASKS.map(task=>{const row=values.tasks[task]??connectionTaskDefault(task),native=isTypeSafe(all.find(c=>c.id===row.connection)?.base??''),updateTask=(part:Partial<typeof row>)=>change({...values,tasks:{...values.tasks,[task]:{...row,...part}}});return <fieldset key={task} disabled={busy} className="ai-task-row"><legend>{taskLabels[task]}</legend>
      <label>使用连接<select aria-label={`${taskLabels[task]}使用连接`} value={row.connection} onChange={e=>updateTask({connection:e.target.value,...(isTypeSafe(all.find(c=>c.id===e.target.value)?.base??'')?{stream:false,thinking:false}:{})})}><option value="">沿用原有设置</option>{all.map(c=><option value={c.id} key={c.id} disabled={!compatible(task,c)}>{c.name}{compatible(task,c)?'':'（不支持此用途）'}{c.ready?'':'（待补充）'}</option>)}</select></label>
      <label>响应方式<select aria-label={`${taskLabels[task]}响应方式`} disabled={!row.connection||native} value={!native&&row.stream?'stream':'json'} onChange={e=>updateTask({stream:e.target.value==='stream'})}><option value="stream">流式</option><option value="json">非流式</option></select></label>
      <label className="ai-toggle"><input type="checkbox" aria-label={`${taskLabels[task]}开启 DeepSeek 思考`} disabled={!row.connection||native} checked={!native&&row.thinking} onChange={e=>updateTask({thinking:e.target.checked,...(e.target.checked&&row.maxTokens<2048?{maxTokens:2048}:{})})}/>开启 DeepSeek 思考</label>
      <label>输出上限（Token）<input aria-label={`${taskLabels[task]}输出上限`} type="number" min={64} max={16000} disabled={!row.connection||native} value={row.maxTokens} onChange={e=>updateTask({maxTokens:Number(e.target.value)})}/></label>
     {native&&<p className="hint">Jev 原生结构化判断，不使用流式、思考或输出 Token 上限。{!supportsTypeSafeTask(task)&&'此用途不支持 Jev，请选择文字生成模型。'}</p>}
     </fieldset>})}<p className="hint">思考参数仅对支持的 DeepSeek 模型发送。开启会增加延时和输出消耗。普通对话包括群内欢欢和私有助手；摘要、看图、鞭打与日报保持原设置。</p></section>}
     {!query.data.can_store_key&&<p role="alert">服务端加密配置未就绪，暂不能保存新密钥。</p>}
     {saved&&!saved.ready&&!dirty&&<p role="alert">以下用途的连接尚未配置完整，不能启用：{AI_TASKS.filter(t=>saved.tasks[t]&&!all.find(c=>c.id===saved.tasks[t]?.connection&&c.ready&&compatible(t,c))).map(t=>taskLabels[t]).join('、')}。请补齐连接，或选择其他已配置连接。</p>}
     <div className="ai-connection-footer"><button type="submit" disabled={busy||!!saved&&!dirty}>{save.isPending?'保存中…':'保存草稿'}</button><button type="button" className="primary" disabled={busy||dirty||!saved?.ready||saved.revision===query.data.active?.revision} onClick={()=>action.mutate('activate')}>启用用途分配</button>{query.data.active&&<button type="button" disabled={busy||dirty} onClick={()=>action.mutate('disable')}>恢复原有设置</button>}</div>
    </form>
    <div className="ai-connection-test"><label>测试用途<select value={testTask} disabled={busy} onChange={e=>{setTestTask(e.target.value as AiTask);test.reset()}}>{AI_TASKS.map(t=><option value={t} key={t}>{taskLabels[t]}</option>)}</select></label><button disabled={busy||dirty||!saved?.tasks[testTask]||!all.find(c=>c.id===saved.tasks[testTask]?.connection&&c.ready&&compatible(testTask,c))} onClick={()=>test.mutate()}>{test.isPending?'测试中…':'测试已保存配置'}</button></div>
    <p className="hint">测试调用一次模型并计入全站额度，不会启用草稿，也不证明出题与判题质量。</p>
    {test.data&&<p role="status">{test.data.structured?'结构化响应正常':'响应格式需核对'} · {test.data.model} · {(test.data.elapsed_ms/1000).toFixed(2)} 秒</p>}
    {notice&&<p role="status">{notice}</p>}{(save.error||action.error||test.error)&&<p role="alert">{(save.error||action.error||test.error)?.message} <button onClick={()=>{setForm(null);query.refetch();save.reset();action.reset();test.reset()}}>重新读取</button></p>}
   </>}
  </dialog>
  <details className="ai-legacy-settings"><summary>原猜词专用配置（兼容入口）</summary><p>独立用途分配优先于此配置；只有选择“沿用原有设置”或“原猜词专用连接”的用途受此处影响。</p><LegacyGuessModel/></details>
 </section>
}
