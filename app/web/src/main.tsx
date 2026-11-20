import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './style.css'
import {api} from './api'
import {MyInvites} from './invites'
import {AdminInvites} from './admin-invites'
import {AdminAi} from './admin-ai'
import {MyAccount} from './account'
import {EmailChange,EmailChangeConfirm} from './account-email'
import {PasswordChange} from './account-password'
import {AuthForm,EmailConfirm,ResetPage,Invitation,GoogleComplete,Welcome} from './auth'
type Flags = {owner:boolean;can_manage_ai:boolean;flags:{'ui.next':string[];plan:'free'|'paid'}}
function AdminFlags() {
  const queryClient = useQueryClient()
  const flags = useQuery({queryKey:['admin','flags'],queryFn:()=>api<Flags>('/api/admin/flags'),retry:false})
  const [plan,setPlan] = useState<'free'|'paid'>('free')
  useEffect(()=>{if(flags.data)setPlan(flags.data.flags.plan)},[flags.data])
  const save = useMutation({mutationFn:()=>api('/api/admin/flags',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({key:'plan',value:plan})}),onSuccess:()=>queryClient.invalidateQueries({queryKey:['admin','flags']})})
  const preview=useMutation({mutationFn:()=>api('/api/admin/auth-preview',{method:'POST'}),onSuccess:()=>queryClient.invalidateQueries({queryKey:['auth','config']})})
  return <div className="page"><header><a className="brand" href="/"><img src="/logo.svg" alt=""/>尽欢</a><a href="/me">返回个人中心</a></header>
    <main><h1>管理设置</h1>{flags.data?.can_manage_ai&&<p><a className="account-password" href="/admin/ai">AI 接入与设置</a></p>}
      {flags.isPending?<p role="status">正在读取设置…</p>:flags.error?<div role="alert"><p>{flags.error.message}</p><button onClick={()=>flags.refetch()}>重试</button><a className="login" href="/auth/login?next=%2Fadmin%2Fflags">登录</a></div>:flags.data&&<form onSubmit={event=>{event.preventDefault();save.mutate()}}>
        <label htmlFor="plan">Workers 套餐</label><select id="plan" value={plan} disabled={!flags.data.owner||save.isPending} onChange={event=>{setPlan(event.target.value as 'free'|'paid');save.reset()}}><option value="free">Free</option><option value="paid">Paid</option></select>
        <p className="hint">与 Cloudflare 后台已开通的套餐保持一致。修改这里不会购买或升级服务。</p>
        <p>已切换的页面：{flags.data.flags['ui.next'].length?flags.data.flags['ui.next'].join('、'):'无'}</p>
        {flags.data.owner?<button className="primary" type="submit" disabled={save.isPending||plan===flags.data.flags.plan}>{save.isPending?'保存中…':'保存设置'}</button>:<p>只有站长可以修改设置。</p>}
        {save.isError&&<p role="alert">{save.error.message}</p>}{save.isSuccess&&<p role="status">已保存</p>}
        {flags.data.owner&&<section><h2>账号功能预览</h2><p>仅为当前浏览器开启 24 小时预览，其他用户的登录方式不变。</p><button type="button" onClick={()=>preview.mutate()} disabled={preview.isPending}>{preview.isPending?'正在开启…':'开启预览'}</button>{preview.error&&<p role="alert">{preview.error.message}</p>}{preview.isSuccess&&<p role="status">预览已开启。<a href="/login">查看登录页</a></p>}</section>}
      </form>}
    </main></div>
}
const router=createBrowserRouter([{path:'/admin/ai',Component:AdminAi},{path:'/admin/invites',Component:AdminInvites},{path:'/admin/flags',Component:AdminFlags},{path:'/app.html',Component:AdminFlags},{path:'/me/invites',Component:MyInvites},{path:'/me/account',Component:MyAccount},{path:'/me/account/password',Component:PasswordChange},{path:'/me/account/email',Component:EmailChange},{path:'/auth/email/change',Component:EmailChangeConfirm},{path:'/login',Component:AuthForm},{path:'/register',Component:AuthForm},{path:'/reset',Component:ResetPage},{path:'/auth/email/verify',Component:EmailConfirm},{path:'/i/:code',Component:Invitation},{path:'/i',Component:GoogleComplete},{path:'/welcome',Component:Welcome}])
const client=new QueryClient({defaultOptions:{queries:{staleTime:15000,refetchOnWindowFocus:false}}})
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider></StrictMode>)
