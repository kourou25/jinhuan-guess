import {el,button,coin,duration,icon} from './farm-ui.js'
import {quantityStepper} from './farm-quantity.js'
import {goodsArt,metric,priceChart,marketStyles} from './farm-market-visuals.js'
import {panelClock} from './farm-panel-clock.js'
export function createFarmMarket(root,{request,onChanged,userId}){
 marketStyles()
 const dialog=el('dialog','farm-social farm-market'),head=el('header','farm-social-heading'),body=el('div','farm-social-body'),note=el('p','farm-market-notice'),title=el('h2','','田园集市')
 title.id='farm-market-title';dialog.setAttribute('aria-labelledby',title.id);note.setAttribute('role','status');head.append(title,button('关闭',()=>dialog.close()));dialog.append(head,note,body);root.append(dialog)
 const pendingKey='farm.market.pending:'+userId,histories=new Map(),quantities=new Map()
 let disposed=false,busy=false,data=null,tab='warehouse',filter='',kind='',generation=0,pending=null,chartGeneration=0,selected='',historyError='',historyBusy=false,live=[],sortKey='name',sortDirection=1,period=24
 const clock=panelClock(dialog,()=>{for(const update of live)update()})
 try{const cached=JSON.parse(sessionStorage.getItem(pendingKey)||'null');if(cached?.id&&cached?.payload)pending=cached}catch{}
 const money=c=>coin((c/100).toFixed(2)),date=t=>new Date(t*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}),specFor=key=>data.catalog.find(c=>c.key===key)
 const visible=key=>(!filter||key===filter)&&(!kind||specFor(key)?.kind===kind)
 const serverNow=clock.now
 async function load(before){
  if(disposed)return;const gen=++generation;body.setAttribute('aria-busy','true');if(!data)body.replaceChildren(el('p','farm-empty','正在读取行情…'))
  try{const q=new URLSearchParams();if(filter)q.set('item',filter);if(before)q.set('before',String(before));const r=await request('/api/farm/market?'+q)
   if(disposed||gen!==generation)return;if(!r.ok)throw Error(r.data.error||'行情读取失败')
   data={...r.data,lots:before?[...data.lots,...r.data.lots]:r.data.lots};clock.sync(data.server_time);if(quantities.size>180)quantities.clear();render();if(tab==='prices')void loadChart()
  }catch(e){if(disposed||gen!==generation)return;note.textContent=e.message;if(!data)body.replaceChildren(button('重新读取',()=>load()))}finally{if(gen===generation)body.removeAttribute('aria-busy')}
 }
 async function loadChart(force=false){
  const cached=histories.get(selected)
  if(!selected||disposed||cached&&serverNow()-cached.sampled_at<20&&!force)return
  const item=selected,seq=++chartGeneration;historyBusy=true;historyError='';render()
  try{const r=await request('/api/farm/market/history?item='+encodeURIComponent(item));if(disposed||seq!==chartGeneration)return;if(!r.ok)throw Error(r.data.error||'走势暂不可用');if(histories.size>=6)histories.delete(histories.keys().next().value);histories.set(item,{points:r.data.points,sampled_at:r.data.quotes_at??r.data.server_time})
  }catch(e){if(!disposed&&seq===chartGeneration)historyError=e.message}finally{if(!disposed&&seq===chartGeneration){historyBusy=false;render()}}
 }
 async function trade(payload){
  if(busy||disposed)return
  if(pending&&JSON.stringify(pending.payload)!==JSON.stringify(payload)){note.textContent='上一笔尚未确认，请先重试查询，避免重复交易。';return}
  pending??={payload,id:crypto.randomUUID()};try{sessionStorage.setItem(pendingKey,JSON.stringify(pending))}catch{note.textContent='浏览器无法保存交易编号，请允许本站会话存储后再交易。';pending=null;return}
  busy=true;render();note.dataset.state='pending';note.textContent='正在确认交易…'
  try{const r=await request('/api/farm/market',{...pending.payload,id:pending.id});if(disposed)return
   if(!r.ok){if(r.status<500){sessionStorage.removeItem(pendingKey);pending=null;await load()}throw Error(r.data.error||'交易未确认，请重试')}
   sessionStorage.removeItem(pendingKey);pending=null;note.dataset.state='success';note.textContent=r.data.message||`${r.data.kind==='buy'?'购入':'售出'} ${r.data.quantity} 份 · ${(r.data.total_cents/100).toFixed(2)} D币${r.data.duplicate?'（已确认原交易）':''}`
   await onChanged();await load()
  }catch(e){note.dataset.state='error';note.textContent=e.message||'网络中断，使用原编号重新确认即可。'}finally{busy=false;if(!disposed)render()}
 }
 function render(){
  if(!data||disposed)return;const scroll=body.scrollTop;live=[];body.replaceChildren()
  const tabs=el('nav','farm-market-tabs');tabs.setAttribute('aria-label','集市内容')
  for(const [id,name] of [['warehouse','我的仓库'],['shop','公共商店'],['prices','物产行情']]){const b=button(name,()=>{tab=id;body.scrollTop=0;render();if(id==='prices')void loadChart()});b.setAttribute('aria-pressed',String(tab===id));b.disabled=busy;tabs.append(b)}
  const reload=button('',()=>{histories.clear();void load()},'fm-refresh');reload.innerHTML=icon('refresh');reload.title='刷新';reload.setAttribute('aria-label','刷新');reload.disabled=busy;tabs.append(reload);body.append(tabs)
  if(pending){const retry=button('重新确认上一笔交易',()=>trade(pending.payload));retry.disabled=busy;body.append(retry)}
  if(!data.active){const intro=el('div','fm-intro');intro.append(el('strong','','让收成进入市场'),el('p','','原库存保留旧价。新收成按批次记录保质期，行情每10分钟按实际供需更新。'));const start=button(data.enabled?'开通行情仓库':'市场暂未开放',()=>trade({kind:'enroll'}));start.disabled=!data.enabled||busy;intro.append(start);body.append(intro)}
  const toolbar=el('div','fm-toolbar'),kinds=el('div','fm-kind-tabs');for(const [id,name]of [['','全部'],['crop','作物'],['animal','畜产'],['fish','渔获']]){const b=button(name,()=>{kind=id;render();if(tab==='prices')void loadChart()});b.setAttribute('aria-pressed',String(kind===id));b.disabled=busy;kinds.append(b)}
  const select=el('select');select.setAttribute('aria-label','商品筛选');select.add(new Option('查找物产…',''));for(const c of data.catalog)select.add(new Option(c.name,c.key));select.value=filter;select.disabled=busy;select.onchange=()=>{filter=select.value;kind='';void load()};toolbar.append(kinds,select);body.append(toolbar)
  if(tab==='prices'){prices();body.scrollTop=scroll;return}
  const shop=tab==='shop',lots=(shop?data.shop:data.lots).filter(l=>visible(l.item)).sort((a,b)=>a.expires_at-b.expires_at||a.id.localeCompare(b.id)),summary=el('div','fm-summary'),expiring=metric(shop?'购买溢价':'临期批次',shop?'+10%':'0',shop?'购入后冷却10分钟':'1小时内到期')
  if(!shop)live.push(()=>expiring.querySelector('strong').textContent=String(lots.filter(l=>l.expires_at>serverNow()&&l.expires_at-serverNow()<3600).length))
  summary.append(metric(shop?'在售批次':'当前批次',String(lots.length),shop?'每批保质期不同':'临期批次排在前面'),expiring,metric('零钱结余',(data.remainder_cents/100).toFixed(2),'累计整币自动入钱包'));body.append(summary)
  body.append(el('p','fm-context',shop?'公共商店来自玩家出售的10%新鲜收成。确认前可查看批次寿命；冷却期间仍会腐烂。':'新鲜物产按当前价格出售；腐烂品按现价10%回收。原库存仍在原收成仓库。'))
  if(!lots.length){const empty=el('div','fm-empty');empty.innerHTML=icon('basket');empty.append(el('strong','',shop?'货架等待下一批收成':'这里还没有新收成'),el('p','',shop?'其他农友出售后，新鲜物产会逐步入库。':'收获、摘取或钓鱼后，新的批次会出现在这里。'));body.append(empty)}
  const list=el('div','fm-lot-list');for(const lot of lots){
   const spec=specFor(lot.item),available=lot.quantity-lot.locked_quantity,card=el('article','farm-market-lot'),desc=el('div','fm-lot-detail'),controls=el('div','farm-market-lot-actions');let n=Math.min(available,quantities.get(lot.id)??1),quoted=0,lastTotal=-1
   const price=shop?Math.ceil(lot.price_cents*110/100):lot.price_cents,source=shop?'公共货架':({grown:'自产',stolen:'摘取',market:'购入'}[lot.source]||'收成')
   desc.append(el('h3','',spec?.name??lot.item),el('p','farm-small',`${source} · 可用 ${available}${lot.locked_quantity?' · 冻结 '+lot.locked_quantity:''}`))
   const freshness=el('div','fm-freshness'),bar=el('i'),expiry=el('small','fm-expiry'),cooldown=el('small','fm-cooldown');freshness.append(bar);freshness.title=date(lot.expires_at)+'到期';desc.append(freshness,expiry,cooldown)
   const total=el('strong','fm-trade-total'),action=button(shop?'购入':'出售',()=>trade({kind:shop?'buy':'sell',lot:lot.id,quantity:n,price,expected_total:quoted})),update=()=>{
    const left=lot.expires_at-serverNow(),rotten=left<=0,cool=Math.max(0,lot.cooldown_until-serverNow());quoted=Math.floor(price*(n??0)/(rotten?10:1))
    if(quoted!==lastTotal){total.innerHTML=money(quoted);lastTotal=quoted}card.dataset.freshness=rotten?'rotten':left<3600?'soon':'fresh';bar.style.width=Math.round(Math.max(0,Math.min(1,left/Math.max(1,lot.expires_at-lot.born_at)))*100)+'%'
    expiry.textContent=rotten?(shop?'已到期 · 不可购买':'已腐烂 · 10%回收价'):`${duration(left)}后到期`;cooldown.textContent=cool?'转售冷却 '+duration(cool):'';cooldown.hidden=!cool
    action.disabled=busy||!data.active||!n||!available||!!cool||shop&&(!data.enabled||rotten)
   }
   const stepper=quantityStepper(Math.max(1,n),{label:(spec?.name??'物产')+'交易数量',max:Math.max(1,Math.min(99,available)),onChange:v=>{n=v;if(v!==null)quantities.set(lot.id,v);update()}});if(busy)for(const e of stepper.querySelectorAll('button,input'))e.disabled=true
   controls.append(stepper,total,action);live.push(update);card.append(goodsArt(spec),desc,controls);list.append(card)
  }body.append(list);if(!shop&&data.next)body.append(button('更多批次',()=>load(data.next)));clock.tick();body.scrollTop=scroll
 }
 function prices(){
  const goods=data.goods.filter(g=>visible(g.item));if(!goods.length){body.append(el('p','farm-empty','有新增收成后生成对应行情。'));return}
  goods.sort((a,b)=>sortDirection*(sortKey==='name'?specFor(a.item).name.localeCompare(specFor(b.item).name,'zh-CN'):sortKey==='delta'?a.price_cents/a.base_cents-b.price_cents/b.base_cents:(a[sortKey]??0)-(b[sortKey]??0)))
  if(!goods.some(g=>g.item===selected)){selected=goods[0].item;chartGeneration++;historyBusy=false;historyError=''}
  const g=goods.find(g=>g.item===selected),spec=specFor(selected),pct=(g.price_cents/g.base_cents-1)*100,hero=el('section','fm-price-focus'),info=el('div','fm-price-heading'),text=el('div','fm-price-copy'),value=el('strong','fm-price-value');value.innerHTML=money(g.price_cents);text.append(el('h3','',spec.name),value);const delta=el('span','fm-delta',(pct>0?'+':'')+pct.toFixed(1)+'%');delta.dataset.direction=pct>0?'up':pct<0?'down':'flat';info.append(goodsArt(spec),text,delta);hero.append(info,el('p','fm-context',`较基础价 · 上档折算 ${g.effective_qty??'—'} · 库存 ${g.fresh_qty} · ${date(g.tick_at)} 更新`))
  const periods=el('div','fm-periods');periods.setAttribute('aria-label','走势时间范围');for(const hours of [6,24]){const b=button(hours+'小时',()=>{period=hours;render()});b.setAttribute('aria-pressed',String(period===hours));periods.append(b)}hero.append(periods)
  const points=(histories.get(selected)?.points??[]).filter(p=>p.tick_at>=data.server_time-period*3600)
  if(historyBusy)hero.append(el('div','fm-chart-empty','正在读取真实走势…'));else if(historyError)hero.append(el('p','',historyError),button('重读走势',()=>loadChart(true)));else hero.append(priceChart(points,spec));hero.append(el('small','fm-chart-key','实线为价格 · 虚线为基础价 · 柱形为成交量。拖动时间轴查看记录。'));body.append(hero)
  const table=el('table','farm-market-prices'),h=el('thead'),tr=el('tr');for(const [key,label,short]of [['name','物产','物产'],['price_cents','当前价格','现价'],['delta','较基础价','价差'],['effective_qty','折算库存','折算']]){const th=el('th'),b=button('',()=>{sortDirection=sortKey===key?-sortDirection:key==='name'?1:-1;sortKey=key;render()}),marker=el('span','fm-sort-marker',sortKey===key?(sortDirection===1?'↑':'↓'):'↕');marker.setAttribute('aria-hidden','true');b.append(el('span','fm-column-label',label),el('span','fm-column-short',short),marker);th.scope='col';th.setAttribute('aria-sort',sortKey===key?(sortDirection===1?'ascending':'descending'):'none');b.setAttribute('aria-label','按'+label+'排序');b.title=label;th.append(b);tr.append(th)}h.append(tr);table.append(h);const rows=el('tbody');table.append(rows)
  for(const item of goods){const c=specFor(item.item),r=el('tr'),name=el('td'),choose=button('',()=>{selected=item.item;historyError='';chartGeneration++;historyBusy=false;render();void loadChart()});choose.append(goodsArt(c),el('span','',c.name));choose.setAttribute('aria-label','查看'+c.name+'走势');choose.setAttribute('aria-pressed',String(selected===item.item));name.append(choose);const price=el('td'),change=el('td','fm-delta'),diff=(item.price_cents/item.base_cents-1)*100;price.innerHTML=money(item.price_cents);change.textContent=(diff>0?'+':'')+diff.toFixed(1)+'%';change.dataset.direction=diff>0?'up':diff<0?'down':'flat';r.dataset.selected=String(selected===item.item);r.append(name,price,change,el('td','',item.effective_qty==null?'—':String(item.effective_qty)));rows.append(r)}
  body.append(table,el('p','fm-context','折算库存按剩余保质期计算，临期权重更低。行情快照最多延迟20秒；交易按实时库存与金额再次核对。无交易不随机涨跌。'))
 }
 return {open(){if(disposed)return;if(!dialog.open)dialog.showModal();clock.start();void load()},destroy(){disposed=true;clock.destroy();live=[];generation++;chartGeneration++;histories.clear();quantities.clear();dialog.remove()}}
}
