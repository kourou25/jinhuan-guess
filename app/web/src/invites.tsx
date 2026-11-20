import {useEffect,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {api} from './api'
type Code={code:string;created_at:number;expires_at:number;used_by:number|null;used_at:number|null;revoked:number}
type Invites={reward:{count:number;level:number};can_manage:boolean;codes:Code[];quota:{total:number;used:number;active:number};invited:{username:string;name:string|null;created_at:number;qualified_at:number|null;revoked:number}[];unlimited:boolean;now:number}
const date=(n:number)=>new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(n*1000)
function state(code:Code,now:number){return code.used_by?'已使用':code.revoked?'已撤销':code.expires_at<=now?'已过期':'可使用'}
export function MyInvites(){
 const client=useQueryClient(),[message,setMessage]=useState(''),[filter,setFilter]=useState('全部'),[clock,setClock]=useState(Date.now())
 const query=useQuery({queryKey:['me','invites'],queryFn:()=>api<Invites>('/api/me/invites'),retry:false})
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),30000);return()=>clearInterval(timer)},[])
 const refresh=()=>client.invalidateQueries({queryKey:['me','invites']})
 const create=useMutation({mutationFn:()=>api('/api/invites',{method:'POST'}),onSuccess:()=>{setMessage('邀请码已生成');revoke.reset();return refresh()}})
 const revoke=useMutation({mutationFn:(code:string)=>api('/api/invites/'+code,{method:'DELETE'}),onSuccess:()=>{setMessage('邀请码已撤销');create.reset();return refresh()}})
 const data=query.data,now=data?data.now+Math.max(0,clock-query.dataUpdatedAt)/1000:clock/1000
 const available=data?Math.max(0,data.quota.total-data.quota.used-data.quota.active):0
 const copy=async(code:string)=>{try{await navigator.clipboard.writeText(location.origin+'/i/'+code);setMessage('邀请链接已复制')}catch{setMessage('未能复制，请选中邀请码旁的链接手动复制')}}
 return <div className="page"><header><a className="brand" href="/"><img src="/logo.svg" alt=""/>尽欢</a><a href="/me">返回个人中心</a></header><main className="invites-page">
  <h1>拉个朋友来摸鱼</h1>
  {query.isPending?<p role="status">正在读取邀请…</p>:query.error?<div role="alert"><p>{query.error.message}</p><button onClick={()=>query.refetch()}>重试</button><a className="login" href="/auth/login?next=%2Fme%2Finvites">登录</a></div>:data&&<>
   <div className="invite-toolbar"><p>可生成 <strong>{data.unlimited?'不限':available}</strong> 个 · 使用中 {data.quota.active} 个</p><button className="primary" disabled={create.isPending||(!data.unlimited&&available===0)} onClick={()=>{setMessage('');create.mutate()}}>{create.isPending?'生成中…':'＋ 生成邀请码'}</button></div>
   <p className="hint">每个码限一人使用，30 天有效。未使用的码撤销或过期后返还名额。</p>
   {(create.error||revoke.error)&&<p role="alert">{create.error?.message||revoke.error?.message}</p>}
   <p className="feedback" role="status" aria-live="polite">{message}</p>
   <div className="invite-filters" aria-label="邀请码状态">{['全部','可使用','已使用','已过期','已撤销'].map(value=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{value}</button>)}</div>
   <ul className="invite-list">{data.codes.filter(code=>filter==='全部'||state(code,now)===filter).map(code=><li key={code.code}><div className="invite-line"><strong className="invite-code">{code.code}</strong><span className={state(code,now)==='可使用'?'available':'hint'}>{state(code,now)}</span></div><div className="invite-line"><span>{code.used_at?date(code.used_at)+' 使用':date(code.expires_at)+' 到期'}</span>{state(code,now)==='可使用'&&<div className="invite-actions"><button onClick={()=>copy(code.code)}>复制链接</button><button disabled={revoke.isPending} onClick={()=>{if(confirm('撤销这个尚未使用的邀请码？'))revoke.mutate(code.code)}}>撤销</button></div>}</div>{state(code,now)==='可使用'&&<input className="invite-link" aria-label={code.code+' 的邀请链接'} readOnly value={location.origin+'/i/'+code.code} onFocus={event=>event.target.select()}/>}</li>)}</ul>
   {!data.codes.some(code=>filter==='全部'||state(code,now)===filter)&&<p className="empty">{data.codes.length?'暂无这个状态的邀请码':'还没有邀请码，生成一个邀请好友。'}</p>}
   {data.codes.length===100&&<p className="hint">显示最近 100 个邀请码。</p>}
   <section className="invite-rewards"><h2>引路人{data.reward.level?' · Lv'+data.reward.level:''}</h2><p>合格邀请 {data.reward.count} 人 · 1 / 3 / 10 / 30 人升级</p><p className="hint">好友注册满 7 天、30 天内回来互动后，每日结算奖励。</p><p>3 人：广结善缘称号 · 10 人：引路气泡</p><a href="/me">去个人中心佩戴</a>{data.can_manage&&<a className="login" href="/admin/invites">管理邀请</a>}</section>
   <h2>受邀好友</h2>{data.invited.length?<ul className="invite-friends">{data.invited.map(person=><li key={person.username}><a href={'/u/'+encodeURIComponent(person.username)}>{person.name||person.username}</a><span>{person.revoked?'邀请已作废':person.qualified_at?'已合格':person.created_at+2592000<now?'未达标（已超期）':'待活跃达标'}</span></li>)}</ul>:<p className="empty">还没有通过邀请加入的好友。</p>}
  </>}
 </main></div>
}
