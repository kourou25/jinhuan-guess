import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {api} from './api'
import {Shell} from './auth'
import {passwordInput} from '../../src/shared/schemas'
export function PasswordChange(){
 const client=useQueryClient(),account=useQuery({queryKey:['me','account'],queryFn:()=>api<{username:string;can_change_password:boolean;identities:{provider:string;email:string|null}[]}>('/api/me/account'),retry:false})
 const [password,setPassword]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState(''),[validation,setValidation]=useState('')
 const submit=useMutation({mutationFn:()=>api('/api/me/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password,new_password:next,confirm_password:confirm})}),onSuccess:()=>{setPassword('');setNext('');setConfirm('');return client.invalidateQueries({queryKey:['me']})}})
 return <Shell title="修改密码">{account.isPending?<p role="status">正在读取账号…</p>:account.error?<><p role="alert">{account.error.message}</p><button onClick={()=>account.refetch()}>重试</button><a href="/login?next=%2Fme%2Faccount%2Fpassword">登录当前账号</a></>:!account.data?.can_change_password?<p>请先开通并验证邮箱登录。<a href="/me/account">前往账号安全</a></p>:submit.isSuccess?<p role="status">密码已更新，其他设备已退出。</p>:<form onSubmit={e=>{e.preventDefault();setValidation('');try{passwordInput(next,account.data.identities.find(i=>i.provider==='email')?.email??'',account.data.username);if(next.normalize('NFKC')!==confirm.normalize('NFKC'))throw Error('两次输入的新密码不一致');if(next.normalize('NFKC')===password.normalize('NFKC'))throw Error('新密码不能与当前密码相同')}catch(error){setValidation((error as Error).message);return}submit.mutate()}}>
  <label htmlFor="current-password">当前密码</label><input id="current-password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} disabled={submit.isPending}/>
  <label htmlFor="new-password">新密码</label><input id="new-password" type="password" autoComplete="new-password" required value={next} onChange={e=>setNext(e.target.value)} disabled={submit.isPending}/>
  <label htmlFor="confirm-password">确认新密码</label><input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={e=>setConfirm(e.target.value)} disabled={submit.isPending}/>
  <p className="hint">8～128 个字符。修改后其他设备会退出。</p><button className="primary" disabled={submit.isPending}>{submit.isPending?'正在保存…':'保存新密码'}</button>{(validation||submit.error)&&<p role="alert">{validation||submit.error?.message}</p>}
 </form>}<nav className="auth-links"><a href="/reset">忘记当前密码</a><a href="/me/account">返回账号安全</a></nav></Shell>
}
