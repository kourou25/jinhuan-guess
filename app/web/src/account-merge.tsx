import {useRef,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {api} from './api'
import {Shell} from './auth'

type Confirmation={valid:boolean;source:{id:number;username:string};target:{id:number;username:string};providers:string[]}
type RequestError=Error&{status?:number;code?:string}
const methods:Record<string,string>={google:'Google',linuxdo:'Linux.DO',email:'邮箱与密码'}
export function MergeConfirm({token}:{token:string}){
 const client=useQueryClient(),flight=useRef(false),[password,setPassword]=useState(''),[finished,setFinished]=useState<'merged'|'cancelled'|null>(null)
 const check=useQuery({queryKey:['merge',token],queryFn:()=>api<Confirmation>('/api/me/merge?token='+encodeURIComponent(token)),retry:false,refetchOnWindowFocus:false,enabled:!finished})
 const account=useQuery({queryKey:['me','account'],queryFn:()=>api<{has_password:boolean}>('/api/me/account'),retry:false,enabled:!!check.data?.valid&&!finished})
 const finish=(state:'merged'|'cancelled')=>{setPassword('');setFinished(state);history.replaceState(history.state,'','/me/account');client.removeQueries({queryKey:['merge',token]});if(state==='merged')client.removeQueries({queryKey:['me']})}
 const submit=useMutation({mutationFn:()=>api('/api/me/merge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,password})}),onSuccess:()=>finish('merged'),onSettled:()=>{flight.current=false}})
 const cancel=useMutation({mutationFn:()=>api('/api/me/merge',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({token})}),onSuccess:()=>finish('cancelled'),onSettled:()=>{flight.current=false}})
 const start=(kind:'submit'|'cancel')=>{if(flight.current)return;flight.current=true;(kind==='submit'?submit:cancel).mutate()}
 const busy=submit.isPending||cancel.isPending,error=submit.error as RequestError|null
 const reauth=error?.code==='reauth_required',invalid=error?.status===409||error?.status===403||error?.status===503
 const signedOut=(check.error as RequestError|null)?.status===401||(account.error as RequestError|null)?.status===401||(error?.status===401&&error.message==='请先登录')
 const back=<nav className="auth-links"><a href="/me/account">返回账号安全</a></nav>
 if(finished)return <Shell title={finished==='merged'?'账号已合并':'已取消合并'}><p role="status">{finished==='merged'?'登录方式已迁入当前账号，其他设备已退出。':'两个账号均已保留。'}</p>{back}</Shell>
 return <Shell title="合并空账号">{check.error?<><p role="alert">{check.error.message}</p><p>请返回账号安全，重新发起关联。</p><button onClick={()=>check.refetch()} disabled={check.isFetching}>重新检查</button></>:check.isPending||account.isPending?<p role="status">正在检查账号…</p>:account.error?<><p role="alert">{account.error.message}</p><button onClick={()=>account.refetch()}>重试</button></>:check.data?.valid&&<>
  <div className="merge-summary"><div><span>并入的空账号</span><strong>@{check.data.source.username}</strong></div><span className="merge-arrow" aria-hidden="true">↓</span><div><span>保留的当前账号</span><strong>@{check.data.target.username}</strong></div></div>
  <p>迁入登录方式：<strong>{check.data.providers.map(p=>methods[p]??p).join('、')}</strong></p>
  <ul className="merge-effects"><li>保留当前账号的资料与内容。</li><li>空账号将注销，其浏览记录、群成员身份和未用邀请码会清理。</li><li>两个账号的旧设备都会退出，当前浏览器继续登录。</li></ul>
  {reauth?<><p role="alert">{error.message}</p><p>重新登录当前账号后，请再次发起关联。</p><a className="merge-reauth" href="/login?next=%2Fme%2Faccount">重新登录当前账号</a></>:invalid||signedOut?<p role="alert">{error?.message}</p>:<form onSubmit={event=>{event.preventDefault();start('submit')}}>
   {account.data?.has_password?<><label htmlFor="merge-password">当前账号密码</label><input id="merge-password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></>:<p className="hint">请在重新登录当前账号后五分钟内确认。</p>}
   <button className="primary" type="submit" disabled={busy}>{submit.isPending?'正在合并…':'合并到当前账号'}</button>{submit.error&&<><p role="alert">{submit.error.message}</p>{!error?.status&&<p>网络中断，结果可能已生效。请先返回账号安全查看登录方式。</p>}</>}
  </form>}
  <button className="merge-cancel" disabled={busy} onClick={()=>start('cancel')}>{cancel.isPending?'正在取消…':'取消合并'}</button>{cancel.error&&<p role="alert">{cancel.error.message}</p>}
 </>}{signedOut&&<p><a href="/login?next=%2Fme%2Faccount">登录当前账号</a>后，请重新发起关联。</p>}{!busy&&back}</Shell>
}
