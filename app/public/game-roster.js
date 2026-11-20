const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text)n.textContent=text;for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n};
let source={key:null,players:[]},count=0,dialog=null,mode=null,requestOnline=null,onlineCount=null,revision=0,abort=null,waiting=null,syncTimer=0;
const safePlayers=items=>(items||[]).map(p=>({id:p.id,name:p.name||'玩家',avatar:p.avatar||null}));
export function setParticipants(n,options={}){
 const signature=JSON.stringify(safePlayers(options.players)),changed=source.key!==options.key||count!==n||source.signature!==signature;count=Number.isInteger(n)?n:0;source={...options,signature};
 const button=document.querySelector('[data-game-participants]');if(button)button.textContent='当局参与 '+count+' 人';
 if(dialog&&mode==='participants'&&changed)void load(false);
}
export function bindRoster(online,participants,send){
 requestOnline=send;
 for(const[b,type]of[[online,'online'],[participants,'participants']]){b.classList.add('game-people-button');b.setAttribute('aria-haspopup','dialog');b.setAttribute('aria-expanded','false');b.onclick=()=>open(type,b)}
}
export function receiveRoster(data){if(data.type==='online')onlineCount=data.count;if(data.type==='roster'&&waiting&&data.request===waiting.id){const resolve=waiting.resolve;clearTimeout(waiting.timer);waiting=null;resolve(data)}}
function onlinePage(offset){return new Promise((resolve,reject)=>{if(!requestOnline?.(offset,revision)){reject(Error('在线连接暂时中断，请稍后重试'));return}waiting={id:revision,resolve,reject,timer:setTimeout(()=>{waiting=null;reject(Error('读取超时，请重试'))},7000)}})}
function stop(){revision++;clearTimeout(syncTimer);syncTimer=0;abort?.abort();abort=null;if(waiting){clearTimeout(waiting.timer);waiting.reject(Error('已关闭'));waiting=null}}
function open(type,trigger){
 if(dialog)dialog.close();mode=type;const panel=el('dialog',null,{class:'game-dialog game-roster','aria-label':type==='online'?'当前在线玩家':'本局参与玩家'});dialog=panel;
 const header=el('header'),title=el('h2',type==='online'?'当前在线':'本局参与'),close=el('button','关闭',{type:'button','aria-label':'关闭玩家名单'});
 header.append(title,close);panel.append(header,el('p','',{class:'game-roster-status',role:'status'}),el('ul','',{class:'game-roster-list','aria-label':'玩家名单'}));
 const footer=el('footer'),refresh=el('button','刷新',{type:'button'}),more=el('button','加载更多',{type:'button',hidden:''});refresh.onclick=()=>load(false);more.onclick=()=>load(true);footer.append(refresh,more);panel.append(footer);
 close.onclick=()=>panel.close();panel.addEventListener('click',e=>{if(e.target===panel){const r=panel.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)panel.close()}});
 panel.addEventListener('close',()=>{if(dialog===panel){stop();dialog=null;mode=null}trigger.setAttribute('aria-expanded','false');panel.remove();trigger.focus()},{once:true});
 document.body.append(panel);trigger.setAttribute('aria-expanded','true');panel.showModal();void load(false);
}
async function load(append){
 const panel=dialog;if(!panel)return;stop();const current=revision,kind=mode,info=source,status=panel.querySelector('[role=status]'),list=panel.querySelector('ul'),[refresh,more]=panel.querySelectorAll('footer button');
 const offset=append?Number(more.dataset.next)||0:0;if(!append)list.replaceChildren();status.textContent='正在读取玩家名单…';refresh.disabled=more.disabled=true;more.hidden=true;
 try{
  let data;if(kind==='online')data=await onlinePage(offset);
  else if(info.url){abort=new AbortController();const r=await fetch(info.url+'&offset='+offset,{signal:abort.signal,credentials:'same-origin',cache:'no-store'});data=await r.json();if(!r.ok)throw Error(data.error||'读取失败，请重试')}
  else{const players=safePlayers(info.players);data={items:players.slice(offset,offset+100),total:players.length,next:players.length>offset+100?offset+100:null}}
  if(dialog!==panel||revision!==current)return;
  for(const p of safePlayers(data.items)){const row=el('li'),avatar=el('span',p.name.slice(0,1),{class:'game-roster-avatar','aria-hidden':'true'});if(p.avatar){const img=el('img',null,{src:p.avatar,alt:'',loading:'lazy',referrerpolicy:'no-referrer'});img.onerror=()=>img.remove();avatar.append(img)}row.append(avatar,el('span',p.name,{class:'game-roster-name'}));list.append(row)}
  const total=data.total??(kind==='online'?onlineCount:count)??0,guests=data.guests||0;
  status.textContent=kind==='online'?(total?'共 '+total+' 人在线'+(guests?'，其中 '+guests+' 位访客（无昵称）':''):'当前暂无在线玩家'):(total?'本局共 '+total+' 人参与':'本局暂无参与者');
  more.hidden=data.next===null||data.next===undefined;more.dataset.next=String(data.next??0);
  if(kind==='online'&&data.pending){status.textContent+='，正在同步昵称与头像…';syncTimer=setTimeout(()=>load(false),1500)}
 }catch(e){if(dialog===panel&&revision===current&&e.name!=='AbortError'){status.textContent=e.message==='Failed to fetch'?'网络暂时中断，请点击刷新重试':e.message;more.hidden=true}}
 finally{if(dialog===panel&&revision===current)refresh.disabled=more.disabled=false}
}
