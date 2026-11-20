import {createFarmWorld} from './farm-world.js'
import {iconButton} from '/farm-ui.js'
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
const button=(text,fn)=>{const b=el('button','',text);b.type='button';b.onclick=fn;return b}
export function createFarmSocial(parent,{request,catalog,userId,onChanged,canAct,onOpen=()=>{},onClose=()=>{}}){
 const dialog=el('dialog','farm-social'),head=el('header'),title=el('h2','','农友互访'),close=button('回我的农场',()=>dialog.close()),nav=el('nav'),content=el('div','farm-social-content'),feedback=el('div','farm-social-feedback'),status=el('p','farm-social-status'),retry=button('↻',()=>void submit())
 retry.className='farm-visit-retry';retry.setAttribute('aria-label','确认上次互动结果');retry.title='确认上次互动结果';retry.style.visibility='hidden';feedback.append(status,retry)
 title.id='farm-social-title';dialog.setAttribute('aria-labelledby',title.id);status.setAttribute('role','status');status.setAttribute('aria-live','polite');head.append(title,close)
 dialog.addEventListener('close',async()=>{stopWorld();content.replaceChildren();await worldTask;if(!disposed)onClose()});let view='neighbors',farm=null,cursor=null,items=[],pending=null,busy=false,disposed=false,opening=false,sequence=0,world=null,worldOwner=null,worldLoading=false,worldTask=null,stage=null,visitPlace='home',clockAt=Date.now()
 const key='farm.visit.pending.v1:'+userId
 const neighbors=button('农友',()=>void load('neighbors')),logs=button('来访消息',()=>void load('visits')),refresh=button('刷新',()=>void load(view,view==='farm'?farm?.owner.id:null))
 nav.append(neighbors,logs,button('被偷榜',()=>void load('loss-ranking')),refresh);dialog.append(head,nav,content,feedback);parent.append(dialog)
 let moreFrame=0,loadFailed=false
 function loadMore(){if(dialog.open&&!disposed&&!busy&&!pending&&!loadFailed&&view==='neighbors'&&cursor!==null&&content.scrollHeight-content.scrollTop-content.clientHeight<120)void load(view,null,cursor)}
 content.addEventListener('scroll',loadMore,{passive:true})
 function message(text){if(!disposed)status.textContent=text}
 function cropName(id){return catalog.crops.find(c=>c.id===id)?.name||'作物'}
 function clearPending(){sessionStorage.removeItem(key);pending=null}
 function state(){for(const b of nav.children)b.disabled=busy||!!pending;retry.disabled=busy||!pending;retry.style.visibility=pending?'visible':'hidden';retry.title=busy?'正在确认互动…':'确认上次互动结果';neighbors.setAttribute('aria-pressed',String(view==='neighbors'));logs.setAttribute('aria-pressed',String(view==='visits'));draw()}

 function sceneState(){return {plots:farm.plots.map(p=>{const c=catalog.crops.find(x=>x.id===p.crop);return {...p,wateredAt:p.mature_at===null?null:p.mature_at-(c?.seconds??0),visitStatus:p.status}}),trees:[],ranch:farm.ranch??{animals:[]}}}
 function stopWorld(){world?.destroy();world=null;worldOwner=null;worldLoading=false;stage=null}
 function draw(){
  if(disposed||!dialog.open)return;title.textContent=view==='farm'&&farm?farm.owner.name+(visitPlace==='ranch'?'的牧场':'的农场'):view==='visits'?'来访记录':view==='loss-ranking'?'被偷榜':'农友互访';dialog.classList.toggle('is-visiting',view==='farm')
  if(view==='farm'&&farm){
   if(worldOwner!==farm.owner.id||!stage){stopWorld();content.replaceChildren();worldOwner=farm.owner.id;const owner=worldOwner
    const tabs=el('nav','farm-visit-stage-nav'),field=iconButton('seed','农田',()=>{visitPlace='home';world?.travel('home');draw()}),ranch=iconButton('ranch','牧场',()=>{visitPlace='ranch';world?.travel('ranch');draw()});field.setAttribute('aria-label','查看好友农场');ranch.setAttribute('aria-label','查看好友牧场');tabs.append(field,ranch);content.append(tabs)
    stage=el('div','farm-map farm-visit-stage');content.append(stage);const target=stage;worldLoading=true
    worldTask=Promise.resolve(worldTask).then(()=>{if(disposed||stage!==target||worldOwner!==owner)return null;return createFarmWorld(target,{state:sceneState(),catalog,visitor:true,now:()=>farm.server_time+Math.floor((Date.now()-clockAt)/1000),onMessage:message,onBrush:async targets=>{
     const owner=farm.owner.id
     for(const target of targets){
      if(disposed||!dialog.open||worldOwner!==owner||pending||busy)break
      if(target.kind==='plot'){const p=farm.plots[target.index];if(p&&['dry','stealable'].includes(p.status)&&p.cycle&&!await interact(p))break}
      else if(target.kind==='animal'){const a=farm.ranch?.animals[target.index];if(a?.status==='stealable'&&!await interactAnimal(a))break}
     }
    },onPlace:p=>{visitPlace=p;message(p==='ranch'?'点击标有“摘1份”的动物收取畜产':'点击作物摘取或帮忙浇水');draw()},onTarget:target=>{
     if(target.kind==='plot'){const p=farm.plots[target.index];if(['dry','stealable'].includes(p.status)&&p.cycle)void interact(p);else message(({guarded:'农场守护中，暂不可摘取',growing:'作物还在生长',protected:'刚成熟，保护30秒',reserved:'本茬已摘取，等待下一茬',legacy:'本茬暂不可摘',empty:'这块田地还没有作物'})[p.status]||'目前无法操作')}
     else{const a=farm.ranch?.animals[target.index];if(a?.status==='stealable')void interactAnimal(a);else message(a?.status==='guarded'?'牧场守护中，暂不可摘取':a?.status==='protected'?'新产出保护30秒':a?.status==='dead'?'动物已死亡':a?'暂无可摘产物，等待新产出':'这个栏位暂时空着')}
    }})}).then(w=>{if(disposed||stage!==target||worldOwner!==owner){w?.destroy();return}world=w;worldLoading=false;w?.travel(visitPlace)}).catch(()=>{if(stage!==target)return;worldLoading=false;world?.destroy();world=null;target.replaceChildren(el('p','','场景加载失败，云存档仍然保留。'),button('重新加载场景',()=>{stopWorld();draw()}))})
    content.append(el('p','farm-visit-guide','点作物摘取或帮忙浇水，点动物摘取畜产；获得的物产进入自己的仓库。仅标记当前可摘的物产，可点“刷新”查看新产出。'))
   }else world?.updateState(sceneState())
   const picker=content.querySelector('.farm-visit-picker');if(picker){picker.replaceChildren(new Option('⌖',''));(visitPlace==='ranch'?farm.ranch?.animals??[]:farm.plots).forEach((x,i)=>picker.add(new Option((visitPlace==='ranch'?'动物 ':'田地 ')+(i+1),String(i))))}
   for(const [i,b] of [...content.querySelectorAll('.farm-visit-stage-nav button')].entries())b.setAttribute('aria-pressed',String(visitPlace===(i?'ranch':'home')))
   return
  }
  const scrollTop=content.scrollTop;stopWorld();content.replaceChildren()
  if(view==='loss-ranking')content.append(el('p','farm-small','累计被摘走的份数 · 前30位。包含上线时仍保留的历史互动，此后持续累计。'))
  if(!items.length&&!busy)content.append(el('p','farm-small',view==='visits'?'最近30天还没有来访互动。':'还没有可互访的农场。'))
  for(const item of items){
   if(view==='neighbors'){const b=button('',()=>void load('farm',item.id));b.className='farm-neighbor';b.disabled=busy||!!pending;b.append(el('strong','',item.name),el('span','farm-small',[item.available_crops?`🌱 ${item.available_crops} 块可摘`:'',item.available_products?`🐔 ${item.available_products} 份可摘`:''].filter(Boolean).join(' · ')||'暂无可摘'));content.append(b)}
   else if(view==='loss-ranking'){const row=el('article','farm-visit-log');row.append(el('strong','',`${items.indexOf(item)+1}. ${item.name}`),el('p','',`被摘 ${item.total} 份 · 作物 ${item.crops} · 畜产 ${item.products}`));content.append(row)}
   else{const row=el('article','farm-visit-log'),when=new Date(item.created_at*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});row.append(el('strong','',item.actor_name||'农友'),el('p','',item.kind==='visit'?'来农场看了看':item.kind==='animal_steal'?`摘取${catalog.animals.find(x=>x.id===item.crop)?.product||'畜产'} ×${item.amount}`:item.kind==='steal'?`从田地${item.plot+1}摘取${cropName(item.crop)} ×${item.amount}`:`为田地${item.plot+1}的${cropName(item.crop)}浇水`),el('time','farm-small',when));content.append(row)}
  }
  if(cursor!==null){const more=button(loadFailed?'加载失败，点击重试':busy?'正在加载…':view==='visits'?'较早记录':'继续下拉加载',()=>{loadFailed=false;void load(view,null,cursor)});more.disabled=busy||!!pending;content.append(more)}
  content.scrollTop=scrollTop
 }

 async function load(next,owner=null,page=null){
  if(disposed||busy||pending)return;busy=true;loadFailed=false;view=next;if(page===null){items=[];cursor=null;content.scrollTop=0}if(next==='farm'&&farm?.owner.id!==owner)farm=null;const seq=++sequence;state();message('正在读取…')
  const arriving=next==='farm'&&farm?.owner.id!==owner,path=next==='farm'?`visit/${owner}${arriving?'/arrive':''}`:(next==='visits'?'activity':next)+(page===null?'':`?${next==='neighbors'?'after':'before'}=${encodeURIComponent(page)}`)
  try{const r=await request('/api/farm/'+path,arriving?{}:undefined);if(disposed||seq!==sequence)return;if(!r.ok)throw Error(r.data?.error||'暂时无法读取');if(next==='farm'){farm=r.data;clockAt=Date.now()}else{const ids=new Set(items.map(x=>x.id));items=page===null||next==='visits'?r.data.items:[...items,...r.data.items.filter(x=>!ids.has(x.id))];cursor=r.data.next===page?null:r.data.next??null}message('')}
  catch(e){loadFailed=true;message(e.message||'读取失败，请刷新重试')}
  finally{if(!disposed&&seq===sequence){busy=false;state();cancelAnimationFrame(moreFrame);moreFrame=requestAnimationFrame(loadMore)}}
 }
 async function interact(plot){
  if(busy||pending||!canAct())return message('请先确认自己的云存档，再进行互动')
  const operation={owner:farm.owner.id,body:{id:crypto.randomUUID(),type:plot.status==='dry'?'water':'steal',plot:plot.index,cycle:plot.cycle,revision:farm.revision}}
  try{sessionStorage.setItem(key,JSON.stringify(operation));pending=operation}catch{return message('浏览器无法保存重试凭据，本次未发送')}
  return await submit()
 }
 async function interactAnimal(animal){
  if(busy||pending||!canAct())return message('请先确认自己的云存档，再进行互动')
  const operation={owner:farm.owner.id,body:{id:crypto.randomUUID(),type:'animal_steal',animal_id:animal.id,cycle:animal.cycle,revision:farm.revision}}
  try{sessionStorage.setItem(key,JSON.stringify(operation));pending=operation}catch{return message('浏览器无法保存重试凭据，本次未发送')}
  return await submit()
 }
 async function submit(){
  if(disposed||busy||!pending)return;busy=true;state();message('正在确认互动…');const operation=pending
  try{
   const r=await request('/api/farm/visit/'+operation.owner,operation.body)
   if(r.ok){const index=farm?.ranch?.animals.findIndex(a=>a.id===operation.body.animal_id);clearPending();if(r.data.farm){farm=r.data.farm;clockAt=Date.now();view='farm';world?.updateState(sceneState());world?.feedback([{...operation.body,...operation.body.type==='animal_steal'?{animal:index}:{}}])}else{const fresh=await request('/api/farm/visit/'+operation.owner);if(fresh.ok){farm=fresh.data;clockAt=Date.now();view='farm'}}message(r.data.message||'互动完成');await onChanged()}
   else if([400,401,403,404,409].includes(r.status)){clearPending();const fresh=await request('/api/farm/visit/'+operation.owner);if(fresh.ok){farm=fresh.data;clockAt=Date.now()}message(r.data.error||'互动未完成，请刷新农场')}
   else message((r.data.error||'暂时无法确认')+'，请使用确认按钮重试同一次操作')
   return r.ok
  }catch{message('连接中断，请确认上次互动结果；重试不会重复结算')}
  finally{busy=false;if(!disposed)state()}
 }
 return {async open(){if(disposed||opening||dialog.open)return;opening=true;try{await worldTask;await onOpen();if(disposed)return;dialog.showModal();try{pending=JSON.parse(sessionStorage.getItem(key)||'null')}catch{message('待确认记录无法读取，请联系管理员');return}if(pending){state();message('请先确认上次互动结果')}else await load('neighbors')}finally{opening=false}},destroy(){disposed=true;sequence++;cancelAnimationFrame(moreFrame);content.removeEventListener('scroll',loadMore);stopWorld();dialog.close();dialog.remove()}}
}
