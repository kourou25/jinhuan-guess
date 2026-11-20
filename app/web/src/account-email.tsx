import {useState} from 'react'
import {useMutation,useQuery} from '@tanstack/react-query'
import {api} from './api'
import {Challenge,Shell,useConfig} from './auth'
import {passwordInput} from '../../src/shared/schemas'
export function EmailChange(){
 const config=useConfig(),account=useQuery({queryKey:['me','account'],queryFn:()=>api<{username:string;has_password:boolean}>('/api/me/account'),retry:false})
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[turnstile,setTurnstile]=useState(''),[attempt,setAttempt]=useState(0),[validation,setValidation]=useState('')
 const submit=useMutation({mutationFn:()=>api('/api/auth/email/change',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,new_password:newPassword,turnstile})}),onSuccess:()=>{setPassword('');setNewPassword('')},onError:()=>{setTurnstile('');setAttempt(n=>n+1)}})
 return <Shell title="设置登录邮箱">{account.isPending||config.isPending?<p role="status">正在读取账号…</p>:account.error?<><p role="alert">{account.error.message}</p><a href="/login?next=%2Fme%2Faccount%2Femail">登录当前账号</a></>:config.error?<><p role="alert">{config.error.message}</p><button onClick={()=>config.refetch()}>重试</button></>:!config.data?.email?<p>邮箱登录暂未开放。</p>:submit.isSuccess?<div role="status"><h2>请查看新邮箱</h2><p>在当前浏览器打开验证链接，确认后生效。</p><button onClick={()=>{submit.reset();setTurnstile('');setAttempt(n=>n+1)}}>重新发送</button></div>:<form onSubmit={event=>{event.preventDefault();setValidation('');if(!account.data?.has_password){try{passwordInput(newPassword,email.trim().normalize('NFKC').toLowerCase(),account.data?.username)}catch(error){setValidation((error as Error).message);return}}submit.mutate()}}>
  <label htmlFor="change-email">新登录邮箱</label><input id="change-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={submit.isPending}/>
  {account.data?.has_password?<><label htmlFor="current-password">当前密码</label><input id="current-password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} disabled={submit.isPending}/></>:<><label htmlFor="bind-password">设置登录密码</label><input id="bind-password" type="password" autoComplete="new-password" required value={newPassword} onChange={e=>setNewPassword(e.target.value)} disabled={submit.isPending}/><p className="hint">8～128 个字符；请在重新登录后五分钟内操作。</p></>}
  <Challenge key={attempt} sitekey={config.data.turnstile_site_key!} action="email_change" onToken={setTurnstile}/><button className="primary" disabled={submit.isPending||!turnstile}>{submit.isPending?'正在发送…':'发送确认邮件'}</button>
  {(validation||submit.error)&&<p role="alert">{validation||submit.error?.message}</p>}
  {!account.data?.has_password&&<a href="/login?next=%2Fme%2Faccount%2Femail">重新登录当前账号</a>}
 </form>}<nav className="auth-links"><a href="/me/account">返回账号安全</a></nav></Shell>
}
export function EmailChangeConfirm(){
 const token=new URLSearchParams(location.search).get('t')??'',config=useConfig()
 const check=useQuery({queryKey:['auth','email-change',token],queryFn:()=>api<{valid:boolean;email:string|null}>('/api/auth/email/change/check?t='+encodeURIComponent(token)),retry:false,enabled:!!config.data?.email})
 const submit=useMutation({mutationFn:()=>api('/api/auth/email/change/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({t:token})}),onSuccess:()=>location.assign('/me/account?bound=email')})
 return <Shell title="确认登录邮箱">{config.isPending||check.isFetching?<p role="status">正在检查链接…</p>:config.error?<><p role="alert">{config.error.message}</p><button onClick={()=>config.refetch()}>重试</button></>:!config.data?.email?<p>邮箱登录暂未开放。</p>:check.error?<><p role="alert">{check.error.message}</p><a href={'/login?next='+encodeURIComponent('/auth/email/change?t='+token)}>登录当前账号</a></>:!check.data?.valid?<p>链接已失效，请在发起操作的浏览器中重新申请。</p>:<form onSubmit={e=>{e.preventDefault();submit.mutate()}}><p>将登录邮箱设为 <strong>{check.data.email}</strong>，其他设备会退出。</p><button className="primary" disabled={submit.isPending}>{submit.isPending?'正在确认…':'确认登录邮箱'}</button>{submit.error&&<p role="alert">{submit.error.message}</p>}</form>}<nav className="auth-links"><a href="/me/account/email">重新申请</a><a href="/me/account">返回账号安全</a></nav></Shell>
}
