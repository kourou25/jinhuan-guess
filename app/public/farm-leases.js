import {cropMatureAt,cropHasPests,cropMaxSeconds} from './farm-crop-care.js'
import {el,button,coin,sprite,duration} from '/farm-ui.js'
export function createFarmLeases(root,{request,userId,getFarm,onChanged}){
 const dialog=el('dialog','farm-social farm-leases'),head=el('header'),nav=el('nav'),body=el('div','farm-social-content'),status=el('p','farm-lease-status'),retry=button('确认上次操作',()=>void send())
 head.append(el('h2','','地块租赁'),button('关闭',()=>dialog.close()));dialog.setAttribute('aria-label','地块租赁');status.setAttribute('role','status');retry.hidden=true
 for(const [id,label] of [['mine','我的租地'],['market','找地租'],['offer','出租空地']]){const b=button(label,()=>{tab=id;void load()});b.dataset.tab=id;nav.append(b)}
 nav.append(button('刷新',()=>void load()))
 dialog.append(head,nav,body,status,retry);root.append(dialog)
 const key='farm.lease.pending:'+userId;let tab='mine',data=null,market=[],next=null,busy=false,pending=null,disposed=false
 let serverTime=Math.floor(Date.now()/1000),receivedAt=performance.now()
 const clock=()=>serverTime+Math.floor(Math.max(0,performance.now()-receivedAt)/1000),date=t=>new Date(t*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})
 function controls(){for(const b of dialog.querySelectorAll('button,input,select'))b.disabled=busy||!!pending;head.querySelector('button').disabled=false;retry.hidden=!pending;retry.disabled=busy;for(const b of nav.children)b.setAttribute('aria-pressed',String(b.dataset.tab===tab))}
 async function load(after=null){
  if(disposed||busy||pending)return;busy=true;controls();status.textContent='正在读取…'
  try{const r=await request(tab==='market'?'/api/farm/leases/market'+(after===null?'':'?after='+after):'/api/farm/leases');if(!r.ok)throw Error(r.data.error);if(disposed)return;serverTime=r.data.server_time;receivedAt=performance.now()
   if(tab==='market'){market=after===null?r.data.items:[...market,...r.data.items.filter(x=>!market.some(y=>y.owner_id===x.owner_id&&y.plot===x.plot))];next=r.data.next}else data=r.data
   status.textContent='';draw()
  }catch(e){status.textContent=e.message||'读取失败，请重试';if(!body.children.length)body.append(button('重新读取',()=>void load()))}finally{busy=false;controls()}
 }
 async function mutate(path,operation){
  if(busy||pending)return;try{pending={path,body:operation};sessionStorage.setItem(key,JSON.stringify(pending))}catch{pending=null;status.textContent='无法保存重试凭据，本次未发送';return}await send()
 }
 async function send(){
  if(busy||!pending||disposed)return;busy=true;controls();status.textContent='正在保存…'
  try{const r=await request(pending.path,pending.body);if(r.ok||[400,401,403,404,409].includes(r.status)){sessionStorage.removeItem(key);pending=null;status.textContent=r.ok?'操作已完成':r.data.error||'操作未完成';await onChanged();busy=false;const text=status.textContent;await load();status.textContent=text}else status.textContent=(r.data.error||'暂时无法确认')+'，请确认上次操作，不会重复扣款'}catch{status.textContent='连接中断，请确认上次操作，不会重复扣款'}finally{busy=false;controls()}
 }
 function row(title,detail){const n=el('article','farm-lease-row');n.append(el('strong','',title),el('p','farm-small',detail));body.append(n);return n}
 function amount(text,n,fn){const b=button('',fn);b.append(document.createTextNode(text+' '));const c=el('span');c.innerHTML=coin(n);b.append(c);return b}
 function draw(){
  body.replaceChildren();const {state,catalog}=getFarm()
  if(tab==='market'){
   body.append(el('p','farm-small','租金直接给地主，租用后不退租。闲置满48小时的空地可租1天；不影响对方已有作物。'))
   const groups=new Map();for(const item of market){const k=[item.owner_id,item.price,item.days,item.forced].join(':');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(item)}
   for(const group of groups.values()){
    const item=group[0],n=row(item.name,`${item.forced?'闲置空地':'主动挂牌'} · ${item.days}天 · ${group.length}块可租`),select=el('select');select.setAttribute('aria-label',item.name+'的可租田地');for(const x of group)select.add(new Option('田地 '+(x.plot+1),x.plot))
    const actions=el('div','farm-lease-actions'),rent=amount('租用',item.price,()=>{
     const plot=Number(select.value),confirmation=el('div','farm-lease-confirm');confirmation.append(el('p','',`确认租用 ${item.name} 的田地 ${plot+1}？租期 ${item.days} 天，支付 ${item.price} D币，到期收成自动入仓。`),button('确认支付并租用',()=>void mutate('/api/farm/leases/rent',{id:crypto.randomUUID(),owner_id:item.owner_id,plot,price:item.price,days:item.days,forced:item.forced,confirm:true})),button('取消',()=>confirmation.remove()));n.querySelector('.farm-lease-confirm')?.remove();n.append(confirmation)
    });actions.append(select,rent);n.append(actions)
   }
   if(!market.length)body.append(el('p','','暂无可出租的空地。'))
   if(next!==null)body.append(button('更多农友',()=>void load(next)))
  }else if(tab==='offer'){
   body.append(el('p','farm-small','选择空地挂牌。租客付款前仍可撤下或使用；已出租的土地在到期前不能操作。'))
   const active=new Set(data.leases.filter(l=>l.owner_id===userId&&l.state==='active').map(l=>l.plot)),empty=data.empty.filter(p=>!active.has(p))
   if(empty.length){
    const form=el('form','farm-lease-offer'),plot=el('select'),price=el('input'),days=el('input');for(const p of empty)plot.add(new Option('田地 '+(p+1),p));price.type=days.type='number';price.min=days.min='1';price.max='10000';days.max='7';price.step=days.step='1';price.value='10';days.value='1';price.required=days.required=true
    for(const [text,input] of [['空地',plot],['租金（D币）',price],['天数',days]]){const label=el('label','',text);label.append(input);form.append(label)}
    const submit=el('button','','挂牌');submit.type='submit';form.append(submit);form.onsubmit=e=>{e.preventDefault();if(form.reportValidity())void mutate('/api/farm/leases/offer',{plot:Number(plot.value),price:Number(price.value),days:Number(days.value),remove:false})};body.append(form)
   }else body.append(el('p','','没有可挂牌的空地。'))
   for(const o of data.offers){const n=row('田地 '+(o.plot+1),`${o.days}天 · ${o.price} D币`);n.append(button('撤下挂牌',()=>void mutate('/api/farm/leases/offer',{plot:o.plot,remove:true})))}
   for(const l of data.leases.filter(x=>x.owner_id===userId&&x.state==='active'))row('田地 '+(l.plot+1)+' · 已出租',`${l.tenant_name} 正在经营 · ${date(l.expires_at)}归还 · 租金 ${l.price} D币已入账`)
  }else{
   body.append(el('p','farm-small','使用自己的种子，播种自动浇水，收成与经验归自己。到期自动收获并归还土地。种子列表预留最多10%虫害缓冲，保证收成可在租期内成熟。'))
   const mine=data.leases.filter(x=>x.tenant_id===userId)
   for(const l of mine){
    const p=l.crop_state,c=catalog.crops.find(x=>x.id===p.crop),n=row(`${l.owner_name} · 田地 ${l.plot+1}`,l.state==='ended'?'租约已结束，收成已入仓':`${date(l.expires_at)}到期`)
    if(l.state==='ended')continue
    if(c){n.prepend(sprite(c.frame));const mature=cropMatureAt(p,c)<=clock();n.append(el('p','',c.name+' · '+(mature?'可收获':duration(cropMatureAt(p,c)-clock())+'后成熟')));if(cropHasPests(p,c,clock()))n.append(button('驱虫',()=>void mutate('/api/farm/leases/'+l.id+'/work',{id:crypto.randomUUID(),type:'pest'})));if(mature)n.append(button('收获入仓',()=>void mutate('/api/farm/leases/'+l.id+'/work',{id:crypto.randomUUID(),type:'harvest'})))}
    else if(l.expires_at>clock()){
     const select=el('select');select.setAttribute('aria-label','租地种子');for(const s of catalog.crops.filter(x=>(catalog.allUnlocked||state.xp>=x.unlock)&&clock()+cropMaxSeconds(x.seconds)<=l.expires_at).sort((a,b)=>(state.seeds[b.id]??0)-(state.seeds[a.id]??0)))select.add(new Option(`${s.name} ×${state.seeds[s.id]??0} · 缺种补买 ${s.seedPrice}`,s.id))
     const label=el('label','farm-preference'),auto=el('input');auto.type='checkbox';label.append(auto,document.createTextNode('缺种时按商店价格补买'))
     const actions=el('div','farm-lease-actions');actions.append(select,button('播种并浇水',()=>{if(select.value)void mutate('/api/farm/leases/'+l.id+'/work',{id:crypto.randomUUID(),type:'plant',crop:select.value,autoBuy:auto.checked})}));n.append(actions,label)
    }
   }
   if(!mine.length)body.append(el('p','','还没有租地。到“找地租”选择农友的空地。'))
  }
 }
 return {async open(){if(disposed)return;dialog.showModal();try{pending=JSON.parse(sessionStorage.getItem(key)||'null')}catch{status.textContent='待确认记录无法读取，请联系管理员';return}if(pending){status.textContent='上次操作结果待确认';controls()}else await load()},destroy(){disposed=true;dialog.close();dialog.remove()}}
}
