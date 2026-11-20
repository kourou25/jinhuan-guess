import {useEffect,useRef,useState} from 'react'
import type {ReactNode} from 'react'
import {useMutation,useQuery} from '@tanstack/react-query'
import {useLocation,useParams} from 'react-router'
import {api} from './api'
import {HandleEditor} from './account-handle'
import {safeNext} from '../../src/shared/navigation'
import {passwordInput} from '../../src/shared/schemas'
type AuthConfig={open:boolean;email:boolean;google:boolean;register_mode:'open'|'invite';turnstile_site_key:string|null}
type TurnstileAPI={render:(element:HTMLElement,options:Record<string,unknown>)=>string;remove:(id:string)=>void}
declare global{interface Window{turnstile?:TurnstileAPI}}
let script:Promise<void>|undefined
function loadTurnstile(){
 if(window.turnstile)return Promise.resolve()
 if(!script)script=new Promise<void>((resolve,reject)=>{const tag=document.createElement('script');tag.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';tag.async=true;tag.onload=()=>resolve();tag.onerror=()=>{tag.remove();script=undefined;reject(new Error('验证码未能加载，请重试'))};document.head.append(tag)})
 return script
}
export function Challenge({sitekey,action,onToken}:{sitekey:string;action:string;onToken:(value:string)=>void}){
 const ref=useRef<HTMLDivElement>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0)
 useEffect(()=>{let active=true,id:string|undefined
  onToken('');loadTurnstile().then(()=>{if(active&&ref.current)id=window.turnstile!.render(ref.current,{sitekey,action,size:'compact',theme:'auto',callback:(value:string)=>onToken(value),'expired-callback':()=>onToken(''),'error-callback':()=>{onToken('');setError('验证暂不可用，请重试')}})}).catch(e=>{if(active)setError(e.message)})
  return()=>{active=false;if(id&&window.turnstile)window.turnstile.remove(id)}
 },[sitekey,action,retry,onToken])
 return <div className="challenge"><div ref={ref}/>{error&&<p role="alert">{error} <button type="button" onClick={()=>{setError('');setRetry(x=>x+1)}}>重试</button></p>}</div>
}
export function Shell({title,children}:{title:string;children:ReactNode}){
 useEffect(()=>{document.title=title+' · 尽欢'},[title])
 return <div className="page"><header><a className="brand" href="/"><img src="/logo.svg" alt=""/>尽欢</a><a href="/">返回图廊</a></header><main className="auth-page"><h1>{title}</h1>{children}</main></div>
}
export const useConfig=()=>useQuery({queryKey:['auth','config'],queryFn:()=>api<AuthConfig>('/api/auth/config'),retry:false})
export function AuthForm(){
 const path=useLocation().pathname,mode=path==='/register'?'register':path==='/reset'?'reset':'login',config=useConfig()
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[handle,setHandle]=useState(''),[nick,setNick]=useState(''),[invite,setInvite]=useState(new URLSearchParams(location.search).get('invite')??''),[turnstile,setTurnstile]=useState(''),[attempt,setAttempt]=useState(0)
 const next=safeNext(new URLSearchParams(location.search).get('next'))
 const [validation,setValidation]=useState('')
 const submit=useMutation({mutationFn:()=>api('/api/auth/'+(mode==='reset'?'reset/request':mode),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,handle,nick,invite,turnstile})}),onSuccess:()=>{setPassword('');if(mode==='login')location.assign(next)},onError:()=>{setTurnstile('');setAttempt(x=>x+1)}})
 const title=mode==='register'?'加入尽欢':mode==='reset'?'找回密码':'欢迎回来'
 if(config.isPending)return <Shell title={title}><p role="status">正在读取登录方式…</p></Shell>
 if(config.error)return <Shell title={title}><p role="alert">{config.error.message}</p><button onClick={()=>config.refetch()}>重试</button></Shell>
 const available=config.data!.email
 return <Shell title={title}>
  {mode!=='reset'&&<a className="oauth-button" href={'/auth/login?next='+encodeURIComponent(next)+(invite?'&invite='+encodeURIComponent(invite):'')}>使用 Linux.DO 登录</a>}
  {mode!=='reset'&&config.data!.google&&<a className="oauth-button" href={'/auth/google/start?next='+encodeURIComponent(next)+(invite?'&invite='+encodeURIComponent(invite):'')}>使用 Google 登录</a>}
  {!available?<p className="hint">{config.data!.open?'邮箱登录暂未开放。':'新登录方式即将开放。'}{mode!=='login'&&<a href="/login"> 前往登录</a>}</p>:submit.isSuccess&&mode!=='login'?<div role="status"><h2>请查看邮箱</h2><p>{mode==='register'?'请点击验证邮件中的链接，再确认完成注册。':'如果这个邮箱已有账号，会收到重设密码的链接。'}</p><button onClick={()=>{submit.reset();setAttempt(x=>x+1)}}>重新发送</button></div>:<form onSubmit={event=>{event.preventDefault();setValidation('');if(mode==='register'){try{passwordInput(password,email.trim().normalize('NFKC').toLowerCase(),handle.trim())}catch(error){setValidation((error as Error).message);return}}submit.mutate()}}>
   <label htmlFor="email">邮箱</label><input id="email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={e=>setEmail(e.target.value)} disabled={submit.isPending}/>
   {mode==='register'&&<><label htmlFor="handle">用户名</label><input id="handle" autoComplete="username" minLength={3} maxLength={20} pattern="[A-Za-z0-9_][A-Za-z0-9_.\-]{1,18}[A-Za-z0-9_]" required value={handle} onChange={e=>setHandle(e.target.value)} disabled={submit.isPending} aria-describedby="handle-hint"/><p id="handle-hint" className="hint">用于 @ 提及，3～20 位字母、数字或 _ . -</p><label htmlFor="nick">昵称（选填）</label><input id="nick" maxLength={40} value={nick} onChange={e=>setNick(e.target.value)} disabled={submit.isPending}/></>}
   {mode!=='reset'&&<><label htmlFor="password">密码</label><input id="password" type="password" autoComplete={mode==='login'?'current-password':'new-password'} required value={password} onChange={e=>setPassword(e.target.value)} disabled={submit.isPending} aria-describedby="password-hint"/><p className="hint" id="password-hint">8～128 个字符</p></>}
   {mode==='register'&&<><label htmlFor="invite">邀请码{config.data!.register_mode==='open'?'（选填）':''}</label><input id="invite" autoComplete="off" maxLength={8} required={config.data!.register_mode==='invite'} value={invite} onChange={e=>setInvite(e.target.value.toUpperCase())} disabled={submit.isPending}/></>}
   <Challenge key={attempt} sitekey={config.data!.turnstile_site_key!} action={mode} onToken={setTurnstile}/>
   <button className="primary" disabled={submit.isPending||!turnstile}>{submit.isPending?'正在处理…':mode==='register'?'发送验证邮件':mode==='reset'?'发送重设链接':'登录'}</button>
   {(validation||submit.error)&&<p role="alert">{validation||submit.error?.message}</p>}
  </form>}
  {available&&<nav className="auth-links" aria-label="账号操作">{mode!=='login'&&<a href="/login">已有账号，去登录</a>}{mode!=='register'&&<a href="/register">注册账号</a>}{mode!=='reset'&&<a href="/reset">忘记密码</a>}</nav>}
 </Shell>
}
export function EmailConfirm(){
 const resetting=useLocation().pathname==='/reset',token=new URLSearchParams(location.search).get('t')??'',config=useConfig()
 const [password,setPassword]=useState(''),[invite,setInvite]=useState('')
 const [validation,setValidation]=useState('')
 const check=useQuery({queryKey:['auth','token',token,resetting],queryFn:()=>api<{valid:boolean}>('/api/auth/token/check?kind='+(resetting?'reset':'signup')+'&t='+encodeURIComponent(token)),retry:false,enabled:!!config.data?.email})
 const submit=useMutation({mutationFn:()=>api('/api/auth/'+(resetting?'reset/confirm':'email/verify'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(resetting?{token,password}:{t:token,...(invite?{invite}:{})})}),onSuccess:()=>location.assign(resetting?'/me':'/welcome')})
 const title=resetting?'设置新密码':'确认加入尽欢'
 return <Shell title={title}>{config.isPending||check.isFetching?<p role="status">正在检查链接…</p>:config.error?<><p role="alert">{config.error.message}</p><button onClick={()=>config.refetch()}>重试</button></>:!config.data?.email?<p>邮箱登录暂未开放。<a href="/login">前往登录</a></p>:check.error?<><p role="alert">{check.error.message}</p><button onClick={()=>check.refetch()}>重试</button></>:!check.data?.valid?<p>链接已失效。<a href={resetting?'/reset':'/register'}>重新申请</a></p>:<form onSubmit={event=>{event.preventDefault();setValidation('');if(resetting){try{passwordInput(password,'')}catch(error){setValidation((error as Error).message);return}}submit.mutate()}}>
  {resetting?<><label htmlFor="new-password">新密码</label><input id="new-password" type="password" autoComplete="new-password" required value={password} onChange={e=>setPassword(e.target.value)} disabled={submit.isPending}/><p className="hint">8～128 个字符；设置后其他登录设备会退出。</p></>:<><p>点击下方按钮完成邮箱验证和注册。</p><label htmlFor="replacement-invite">更换邀请码（原码失效时填写）</label><input id="replacement-invite" maxLength={8} value={invite} onChange={e=>setInvite(e.target.value.toUpperCase())} disabled={submit.isPending}/></>}
  <button className="primary" disabled={submit.isPending}>{submit.isPending?'正在处理…':resetting?'设置新密码':'完成注册'}</button>{(validation||submit.error)&&<p role="alert">{validation||submit.error?.message}</p>}
 </form>}</Shell>
}
export function ResetPage(){return new URLSearchParams(location.search).has('t')?<EmailConfirm/>:<AuthForm/>}
export function Invitation(){
 const code=useParams().code??'',query=useQuery({queryKey:['invite',code],queryFn:()=>api<{valid:boolean;inviter:string|null}>('/api/invites/'+encodeURIComponent(code)),retry:false})
 return <Shell title="朋友邀你来尽欢">{query.isPending?<p role="status">正在检查邀请码…</p>:query.error?<><p role="alert">{query.error.message}</p><button onClick={()=>query.refetch()}>重试</button></>:query.data?.valid?<><p>{query.data.inviter} 邀请你一起看图、聊天、摸鱼。</p><p className="invite-code">{code.toUpperCase()}</p><a className="oauth-button" href={'/register?invite='+encodeURIComponent(code)}>使用邀请码注册</a><a href="/login">已有账号，直接登录</a></>:<><p>这个邀请码已使用、过期或撤销。</p><a href="/login">前往登录</a></>}</Shell>
}
export function GoogleComplete(){
 const config=useConfig(),[invite,setInvite]=useState('')
 const pending=useQuery({queryKey:['auth','google','pending'],queryFn:()=>api<{valid:boolean;name:string;email:string|null;invite:string;required:boolean}>('/api/auth/google/pending'),enabled:!!config.data?.google,retry:false})
 useEffect(()=>{if(pending.data)setInvite(pending.data.invite)},[pending.data])
 const submit=useMutation({mutationFn:()=>api<{next:string}>('/api/auth/google/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({invite})}),onSuccess:result=>location.assign(safeNext(result.next))})
 return <Shell title="填写邀请码加入尽欢">{config.isPending||pending.isFetching?<p role="status">正在检查授权…</p>:config.error?<><p role="alert">{config.error.message}</p><button onClick={()=>config.refetch()}>重试</button></>:!config.data?.google?<p>Google 登录暂未开放。<a href="/login">返回登录</a></p>:pending.error?<><p role="alert">{pending.error.message}</p><a className="oauth-button" href="/auth/google/start">重新用 Google 登录</a></>:pending.data&&<form onSubmit={event=>{event.preventDefault();submit.mutate()}}><p>Google 已授权：{pending.data.name||pending.data.email||'你的账号'}</p><label htmlFor="google-invite">邀请码{pending.data.required?'':'（选填）'}</label><input id="google-invite" autoComplete="off" maxLength={8} pattern="[A-HJ-NP-Z2-9]{8}" required={pending.data.required} value={invite} onChange={event=>setInvite(event.target.value.toUpperCase())} disabled={submit.isPending}/><button className="primary" disabled={submit.isPending}>{submit.isPending?'正在加入…':'完成注册'}</button>{submit.error&&<p role="alert">{submit.error.message}</p>}</form>}</Shell>
}
export function Welcome(){const next=safeNext(new URLSearchParams(location.search).get('next'));return <Shell title="欢迎来到尽欢"><p>账号已创建。去看看今天的图，或完善你的个人资料。</p><HandleEditor welcome/><nav className="auth-links">{next!=='/'&&<a href={next}>继续访问</a>}<a href="/">逛图廊</a><a href="/chat">去群聊</a><a href="/me">个人中心</a></nav></Shell>}
