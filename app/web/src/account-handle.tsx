import {useEffect,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {api} from './api'
import {handleInput} from '../../src/shared/schemas'

export function HandleEditor({welcome=false}:{welcome?:boolean}){
 const client=useQueryClient(),query=useQuery({queryKey:['me','account'],queryFn:()=>api<{username:string;can_change_handle:boolean;handle_setup_pending:boolean;handle_at:number|null}>('/api/me/account'),retry:false})
 const [handle,setHandle]=useState(''),[validation,setValidation]=useState(''),[feedback,setFeedback]=useState('')
 useEffect(()=>{if(query.data)setHandle(query.data.username)},[query.data?.username])
 const save=useMutation({mutationFn:()=>api('/api/me/handle',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({handle})}),onSuccess:()=>{setFeedback('用户名已更新');return client.invalidateQueries({queryKey:['me']})}})
 if(query.isPending)return <p role="status">正在读取用户名…</p>
 if(query.error)return <div><p role="alert">{query.error.message}</p><button onClick={()=>query.refetch()}>重试</button></div>
 const account=query.data!
 if(!account.can_change_handle||(welcome&&!account.handle_setup_pending))return null
 const waiting=!account.handle_setup_pending&&account.handle_at!==null&&account.handle_at+2592000>Date.now()/1000
 return <section className="handle-editor"><form onSubmit={e=>{e.preventDefault();setValidation('');setFeedback('');try{handleInput(handle)}catch(error){setValidation((error as Error).message);return}save.mutate()}}>
  <label htmlFor="account-handle">{account.handle_setup_pending?'设置你的用户名':'修改用户名'}</label>
  <input id="account-handle" autoComplete="username" minLength={3} maxLength={20} required value={handle} disabled={save.isPending||waiting} onChange={e=>{setHandle(e.target.value);setValidation('');setFeedback('');save.reset()}} aria-describedby="account-handle-hint"/>
  <p id="account-handle-hint" className="hint">用于 @ 提及，3～20 位字母、数字或 _ . -。旧消息中的 @ 不会改变。</p>
  <p className="hint">{account.handle_setup_pending?'首次设置不占用 30 天修改间隔。':waiting?'下次可修改：'+new Date((account.handle_at!+2592000)*1000).toLocaleDateString('zh-CN'):'每 30 天可以修改一次。'}</p>
  <button disabled={waiting||save.isPending||handle.trim()===account.username}>{save.isPending?'正在保存…':'保存用户名'}</button>
  {(validation||save.error)&&<p role="alert">{validation||save.error?.message}</p>}
 </form>{feedback&&<p role="status">{feedback}</p>}</section>
}
