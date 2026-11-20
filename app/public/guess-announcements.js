import {avatarImage} from '/avatar-view.js?v=20261019a'
import {createAnnouncementWindow} from '/announcement-window.js'
import {captureChatScroll} from '/chat-scroll-anchor.js'

export function createGuessAnnouncements({h,api,gid,chat}){
 const doc=chat.ownerDocument,win=doc.defaultView
 const toast=h('div',{class:'gm-announcement-toasts','aria-live':'polite','aria-label':'即时公告',hidden:true})
 const pins=h('section',{class:'gm-announcement-pins','aria-label':'聊天置顶公告',hidden:true})
 doc.body.append(toast);chat.prepend(pins)
 let dead=false,running=false,again=false,pinKey=''
 let mainItems=[],extraItems=[]
 const signals=new Map()
 const lifetime=createAnnouncementWindow({now:()=>win.performance.now(),setTimer:(fn,ms)=>win.setTimeout(fn,ms),clearTimer:id=>win.clearTimeout(id),onChange:({toasts,pins:items})=>{
  toast.hidden=!toasts.length
  toast.replaceChildren(...toasts.slice(0,3).map(item=>row(item,false)))
  const key=JSON.stringify(items)
  if(key!==pinKey){
   pinKey=key
   const scroller=chat.querySelector('.cm-scroll'),restore=scroller?captureChatScroll(scroller,{viewport:true}):()=>{}
   pins.hidden=!items.length;pins.replaceChildren(...items.map(item=>row(item,true)))
   restore()
  }
 }})
 function row(item,pinned){return h('div',{class:'gm-announcement-item','data-announcement':item.id},
  h('div',{class:'gm-announcement-copy'},item.players.map(player=>h('span',{class:'gm-announcement-player'},
   player.avatar?avatarImage(h,player.avatar,player.name,24,'gm-announcement-avatar'):h('span',{class:'gm-announcement-avatar gm-avatar-fallback','aria-label':player.name+'的默认头像'},(player.name||'玩').slice(0,1)),h('strong',null,player.name))),h('span',null,item.text)),
  h('button',{type:'button',class:'gm-announcement-close','aria-label':(pinned?'关闭置顶公告':'关闭即时公告')+' '+item.id,onclick:()=>lifetime.dismiss(item.id)},'×'))}
 async function refresh(){
  if(dead)return
  if(running){again=true;return}
  running=true
  try{
   const data=await api(`/chat/groups/${gid}/guess-room?view=announcements`)
   if(dead)return
   mainItems=data.items;lifetime.ingest([...mainItems,...extraItems],data.now)
  }catch{ /* Reuse the next room update; no persistent error banner or extra polling. */ }
  finally{running=false;if(again&&!dead){again=false;refresh()}}
 }
 function signal(messages){
  let changed=false
  for(const m of messages){
   if(!m.system_kind&&!m.redpack)continue
   const value=JSON.stringify([m.updated_at,m.deleted,m.body,m.redpack?.guess_revision])
   if(signals.get(m.id)!==value){signals.set(m.id,value);changed=true}
  }
  while(signals.size>200)signals.delete(signals.keys().next().value)
  if(changed)refresh()
 }
 return {refresh,signal,extra(items,now,silent=false){extraItems=items;lifetime.ingest([...mainItems,...extraItems],now,silent)},destroy(){dead=true;lifetime.destroy();toast.remove();pins.remove()}}
}
