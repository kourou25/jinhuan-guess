import {useEffect,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {api} from './api'
import {HandleEditor} from './account-handle'
import {MergeConfirm} from './account-merge'
type Account={username:string;has_password:boolean;can_change_password:boolean;can_bind_linuxdo:boolean;can_bind_google:boolean;can_bind_email:boolean;can_unlink:boolean;identities:{provider:string;email:string|null;username:string|null;verified_at:number|null;created_at:number}[]}
type Session={id:string;method:string|null;ua:string|null;created_at:number;seen_at:number;current:number}
const methods:Record<string,string>={linuxdo:'Linux.DO',google:'Google',email:'邮箱',dev:'测试登录'}
const time=(value:number)=>value?new Date(value*1000).toLocaleString('zh-CN'):'历史会话'
function device(ua:string|null){if(!ua)return '历史登录设备';const platform=/iPhone|iPad/.test(ua)?'iOS':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Macintosh/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'设备';const browser=/Edg\//.test(ua)?'Edge':/Firefox\//.test(ua)?'Firefox':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'浏览器';return platform+' · '+browser}
export function MyAccount(){
 const token=new URLSearchParams(location.search).get('merge')
 return token!==null?<MergeConfirm token={token}/>:<AccountDetails/>
}
function AccountDetails(){
 useEffect(()=>{document.title='账号安全 · 尽欢'},[])
 const client=useQueryClient(),account=useQuery({queryKey:['me','account'],queryFn:()=>api<Account>('/api/me/account'),retry:false}),sessions=useQuery({queryKey:['me','sessions'],queryFn:()=>api<{sessions:Session[]}>('/api/me/sessions'),retry:false})
 const remove=useMutation({mutationFn:(id:string|null)=>api<{current:boolean}>('/api/me/sessions'+(id?'/'+id:''),{method:'DELETE'}),onSuccess:result=>{if(result.current)location.assign('/login?next=%2Fme%2Faccount');else return client.invalidateQueries({queryKey:['me','sessions']})}})
 const bind=useMutation({mutationFn:(provider:'linuxdo'|'google')=>api<{url:string}>('/api/me/bind/'+provider,{method:'POST'}),onSuccess:result=>location.assign(result.url)})
 const [unlinkProvider,setUnlinkProvider]=useState(''),[password,setPassword]=useState(''),[feedback,setFeedback]=useState('')
 const unlink=useMutation({mutationFn:()=>api('/api/me/identities/'+unlinkProvider,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({password})}),onSuccess:()=>{setFeedback(methods[unlinkProvider]+' 已解绑，其他设备已退出。');setUnlinkProvider('');setPassword('');return client.invalidateQueries({queryKey:['me']})}})
 const exit=(id:string|null)=>{if(confirm(id?'退出这台登录设备？':'退出所有登录设备，包括当前浏览器？'))remove.mutate(id)}
 return <div className="page"><header><a className="brand" href="/"><img src="/logo.svg" alt=""/>尽欢</a><a href="/me">返回个人中心</a></header><main className="account-page"><h1>账号安全</h1>
 {account.isPending?<p role="status">正在读取账号…</p>:account.error?<><p role="alert">{account.error.message}</p><button onClick={()=>account.refetch()}>重试</button><a className="login" href="/login?next=%2Fme%2Faccount">登录</a></>:account.data&&<><p>@{account.data.username}</p><h2>登录方式</h2><ul className="identity-list">{account.data.identities.map(identity=><li key={identity.provider+identity.email+identity.username}><strong>{methods[identity.provider]||identity.provider}</strong><span>{identity.email||identity.username||'已关联'}</span></li>)}</ul>{!account.data.identities.length&&<p className="hint">当前账号使用历史登录方式。</p>}{account.data.has_password&&<a className="account-password" href="/reset">通过邮箱重设密码</a>}</>}
 {account.data?.can_change_password&&<a className="account-password-change" href="/me/account/password">修改密码</a>}
 {account.data?.can_bind_linuxdo&&!account.data.identities.some(i=>i.provider==='linuxdo')&&<><button className="account-bind" disabled={bind.isPending} onClick={()=>bind.mutate('linuxdo')}>{bind.isPending&&bind.variables==='linuxdo'?'正在前往授权…':'关联 Linux.DO'}</button><p className="hint">关联后用户名跟随 Linux.DO，已发布内容保留。</p></>}
 {account.data?.can_bind_google&&!account.data.identities.some(i=>i.provider==='google')&&<button className="account-bind" disabled={bind.isPending} onClick={()=>bind.mutate('google')}>{bind.isPending&&bind.variables==='google'?'正在前往授权…':'关联 Google'}</button>}
 {bind.error&&<p role="alert">{bind.error.message}</p>}
 {account.data?.can_bind_email&&<a className="account-password" href="/me/account/email">{account.data.identities.some(i=>i.provider==='email')?'更换登录邮箱':'关联邮箱与密码'}</a>}
 {account.data?.can_unlink&&<section className="account-unlink"><h2>移除登录方式</h2>{!unlinkProvider?<div className="unlink-actions">{account.data.identities.filter(i=>['email','google','linuxdo'].includes(i.provider)).map(i=><button key={i.provider} disabled={account.data!.identities.length<2} onClick={()=>{setFeedback('');unlink.reset();setPassword('');setUnlinkProvider(i.provider)}}>解绑 {methods[i.provider]}</button>)}</div>:<form onSubmit={e=>{e.preventDefault();unlink.mutate()}}><p>确认解绑 {methods[unlinkProvider]}？其他设备会退出。</p>{account.data.has_password?<><label htmlFor="unlink-password">当前密码</label><input autoFocus id="unlink-password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} disabled={unlink.isPending}/></>:<p className="hint">请在重新登录后五分钟内操作。<a href="/login?next=%2Fme%2Faccount">重新登录</a></p>}<div className="unlink-actions"><button type="submit" disabled={unlink.isPending}>{unlink.isPending?'正在解绑…':'确认解绑'}</button><button type="button" disabled={unlink.isPending} onClick={()=>{setUnlinkProvider('');setPassword('');unlink.reset()}}>取消</button></div>{unlink.error&&<p role="alert">{unlink.error.message}</p>}</form>}{feedback&&<p role="status">{feedback}</p>}</section>}
 {new URLSearchParams(location.search).get('bound')==='email'&&account.data?.identities.some(i=>i.provider==='email')&&<p role="status">登录邮箱已更新，其他设备已退出。</p>}
 {new URLSearchParams(location.search).get('bound')==='linuxdo'&&account.data?.identities.some(i=>i.provider==='linuxdo')&&<p role="status">Linux.DO 已关联，可用它登录当前账号。</p>}
 {new URLSearchParams(location.search).get('bound')==='google'&&account.data?.identities.some(i=>i.provider==='google')&&<p role="status">Google 已关联，可用它登录当前账号。</p>}
 {account.data&&<HandleEditor/>}
 <h2>登录设备</h2>{sessions.isPending?<p role="status">正在读取设备…</p>:sessions.error?<><p role="alert">{sessions.error.message}</p><button onClick={()=>sessions.refetch()}>重试</button></>:<><ul className="session-list">{sessions.data?.sessions.map(session=><li key={session.id}><div className="session-title"><strong>{device(session.ua)}</strong>{!!session.current&&<span className="available">当前设备</span>}</div><p>{methods[session.method??'']||'历史登录'} · {time(session.created_at)} 登录</p><div className="session-bottom"><span>最近活跃：{time(session.seen_at)}</span><button disabled={remove.isPending} onClick={()=>exit(session.id)}>退出此设备</button></div></li>)}</ul>{sessions.data?.sessions.length===100&&<p className="hint">显示最近 100 个有效会话，全部退出会同时撤销其余会话。</p>}<button className="session-exit-all" disabled={remove.isPending||!sessions.data?.sessions.length} onClick={()=>exit(null)}>退出所有设备</button></>}
 {remove.error&&<p role="alert">{remove.error.message}</p>}
 </main></div>
}
