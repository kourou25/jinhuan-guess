import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {api} from './api'
type Row={invitee_id:number;inviter_id:number;username:string;inviter_name:string;created_at:number;qualified_at:number|null;revoked:number;qualified_count:number;method:string}
export function AdminInvites(){
 const client=useQueryClient(),[input,setInput]=useState(''),[inviter,setInviter]=useState(''),[pages,setPages]=useState<number[]>([]),[message,setMessage]=useState('')
 const before=pages.at(-1),query=useQuery({queryKey:['admin','invites',inviter,before],queryFn:()=>api<{items:Row[];next:number|null}>('/api/admin/invites?inviter='+encodeURIComponent(inviter)+(before?'&before='+before:'')),retry:false})
 const revoke=useMutation({mutationFn:(id:number)=>api('/api/admin/invites/'+id,{method:'DELETE'}),onSuccess:()=>{setMessage('邀请已作废，徽章已重算，已解锁装扮保留。');return client.invalidateQueries({queryKey:['admin','invites']})}})
 return <div className="page"><header><a className="brand" href="/"><img src="/logo.svg" alt=""/>尽欢</a><a href="/me/invites">返回邀请</a></header><main className="invites-page"><h1>邀请管理</h1>
 <form onSubmit={e=>{e.preventDefault();setInviter(input);setPages([])}}><label htmlFor="inviter-id">邀请人编号（留空查看全部）</label><input className="invite-link" id="inviter-id" inputMode="numeric" pattern="[0-9]*" value={input} onChange={e=>setInput(e.target.value)}/><button type="submit">筛选邀请</button></form>
 {query.isPending?<p role="status">正在读取邀请…</p>:query.error?<><p role="alert">{query.error.message}</p><button onClick={()=>query.refetch()}>重试</button></>:query.data&&<><ul className="invite-list">{query.data.items.map(row=><li key={row.invitee_id}><div className="invite-line"><strong>@{row.inviter_name} → @{row.username}</strong><span>{row.revoked?'已作废':row.qualified_at?'已合格':'待达标'}</span></div><span>邀请人 #{row.inviter_id} · 合格 {row.qualified_count} 人 · {row.method} · {new Date(row.created_at*1000).toLocaleDateString('zh-CN')}</span><button disabled={!!row.revoked||revoke.isPending} onClick={()=>{if(confirm('作废这条邀请并重算徽章？已解锁的装扮会保留。'))revoke.mutate(row.invitee_id)}}>作废邀请</button></li>)}</ul>{!query.data.items.length&&<p>没有符合条件的邀请。</p>}<nav className="auth-links"><button disabled={!pages.length} onClick={()=>setPages(x=>x.slice(0,-1))}>上一页</button><button disabled={!query.data.next} onClick={()=>setPages(x=>[...x,query.data!.next!])}>下一页</button></nav></>}
 {revoke.error&&<p role="alert">{revoke.error.message}</p>}{message&&<p role="status">{message}</p>}
 </main></div>
}
