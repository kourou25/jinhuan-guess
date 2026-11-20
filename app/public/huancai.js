import {dcoinAmount} from '/dcoin.js'
import {captureChatScroll} from '/chat-scroll-anchor.js'
export function createHuancai({pane,chat,scroller,opener,userId,h,api}){
 const doc=pane.ownerDocument,win=doc.defaultView
 if(!doc.querySelector('link[data-huancai]'))doc.head.append(h('link',{rel:'stylesheet',href:'/huancai.css?v=20261023','data-huancai':''}))
 let opened=false,dead=false,data=null,tab='lotto',busy=false,epoch=0,controller=null,pending=null,cleanup=()=>{},restoreChat=null
 let front=new Set(),back=new Set(),quantity=1,theme='banana',shownOrder=null
 const key=`huancai-pending:${userId}`,btn=(text,fn,attrs={})=>h('button',{type:'button',onclick:fn,...attrs},text),money=n=>dcoinAmount(h,n)
 try{pending=JSON.parse(win.sessionStorage.getItem(key)||'null')}catch{}
 function remember(x){pending=x;try{x?win.sessionStorage.setItem(key,JSON.stringify(x)):win.sessionStorage.removeItem(key)}catch{}}
 const status=h('p',{class:'hc-status',role:'status','aria-live':'polite'}),body=h('div',{class:'hc-body'}),nav=h('nav',{class:'hc-tabs','aria-label':'欢彩玩法'}),balance=h('div',{class:'hc-balance'})
 const panel=h('section',{class:'hc-panel',hidden:true,'aria-label':'欢彩'},h('header',null,h('h2',null,'欢彩'),balance,btn('↻',()=>load(),{'aria-label':'刷新欢彩'}),btn('×',close,{'aria-label':'关闭欢彩'})),nav,status,body)
 pane.append(panel)
 const date=t=>new Date(t*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})
 function layout(){const wasHidden=chat.inert,wide=pane.clientWidth>=800,hide=opened&&!wide;if(hide&&!wasHidden)restoreChat=captureChatScroll(scroller);pane.classList.toggle('hc-open',opened);pane.classList.toggle('hc-wide',opened&&wide);panel.hidden=!opened;if(opened||!pane.classList.contains('gr-open'))chat.inert=hide;opener.setAttribute('aria-expanded',String(opened));if(wasHidden&&!hide){restoreChat?.();restoreChat=null}}
 const observer=new win.ResizeObserver(()=>{if(!dead)layout()});observer.observe(pane)
 const live=()=>opened&&!dead
 async function load(){if(busy||!live())return;controller?.abort();controller=new AbortController();const n=++epoch;status.textContent='正在读取…';try{data=await api('/huancai',{signal:controller.signal});if(!live()||n!==epoch)return;status.textContent='';render()}catch(e){if(live()&&n===epoch&&e.name!=='AbortError')status.textContent=e.message}}
 function render(){++epoch;controller?.abort();cleanup();cleanup=()=>{};balance.replaceChildren(money(data.balance));nav.replaceChildren(...[['lotto','大乐透'],['scratch','刮刮乐'],['records','我的票夹']].map(([id,label])=>btn(label,()=>{if(busy)return;tab=id;shownOrder=null;render()},{'aria-pressed':String(id===tab)})));body.replaceChildren();if(pending){body.append(h('div',{class:'hc-pending'},h('p',null,'上次购买结果待确认，请先恢复原订单。'),btn('确认原订单',()=>purchase(pending),{class:'hc-primary'})));return}if(shownOrder&&tab==='scratch'){scratchResult(shownOrder);return}if(tab==='lotto')lotto();else if(tab==='scratch')scratch();else records()}
 function balls(a,b){return h('div',{class:'hc-balls'},...a.map(n=>h('b',null,String(n).padStart(2,'0'))),...b.map(n=>h('b',{class:'hc-blue'},String(n).padStart(2,'0'))))}
 function rules(){const legacy=data.round?.rules_version===1;return h('details',{class:'hc-rules'},h('summary',null,'概率、奖金与规则'),h('p',null,'仅使用本站D币。每天北京时间21:30开奖；无个人日限。每次最多10注或20张，余额不足时不能购买。'),h('p',null,legacy?'当前期为升级前旧规则：前20选5、后8选2，销售额80%按原权重分配；已售专场仍按原必出奖规则开奖。下一新期使用35+12新规则。':'前35选5、后12选2，号码均匀随机；每注10D币，总组合21,425,712，任意奖级约6.6705%。不按售票号码调整开奖结果。'),h('table',{class:'hc-prize-table'},h('thead',null,h('tr',null,h('th',null,'命中'),h('th',null,'参考奖励'),h('th',null,'概率'))),h('tbody',null,data.prizes.map(p=>h('tr',null,h('td',null,p.match),h('td',null,p.prize),h('td',null,(p.ways/data.lotto_rules.space*100).toFixed(p.tier<3?6:3)+'%'))))),h('p',null,'新期奖金预算为销售额80%。三至七等奖按参考倍率计算；有一、二等奖时先为低档预留最多70%预算，不足时同比例缩放。剩余预算由一、二等奖按85%/15%分配，只有一个档中奖则独享；同档均分并取整。参考倍率不等于保底到账金额。未分配预算回收。'),h('p',null,'刮刮乐独立开奖，中奖率40.02%，理论返还率65%。倍率及概率：'+data.scratch_prizes.map(p=>p.multiple+'倍 '+(p.weight/100)+'%').join('；')+'。整本不保证中奖；展示方式不会改变已保存结果。旧票保留购买时的奖励。'))}

 function lotto(){
  const r=data.round,hero=h('div',{class:'hc-lotto-hero'},h('span',null,r.day+' 期'),h('h3',null,r.special?'今晚，必出奖专场':'选七个数字，等一份惊喜'),h('p',null,'北京时间 21:30 开奖 · 已购 '+r.tickets+' 注'),h('p',{class:'hc-prize-budget'},'本期奖金预算 ',money(Math.floor(r.sales*.8))),h('small',null,r.rules_version===1?'旧期按原规则结算':'35选5 + 12选2 · 均匀开奖'))
  body.append(hero)
  const selected=h('div',{class:'hc-selected'}),counts=h('small'),purchaseButton=btn('',()=>{if(front.size!==5||back.size!==2)return;purchase({id:crypto.randomUUID(),kind:'lotto',day:r.day,tickets:Array.from({length:quantity},()=>({front:[...front],back:[...back]}))})},{class:'hc-primary'})
  const sync=()=>{selected.replaceChildren(balls([...front].sort((a,b)=>a-b),[...back].sort((a,b)=>a-b)));counts.textContent=`已选 ${front.size}/5 + ${back.size}/2`;purchaseButton.replaceChildren('确认购买 '+quantity+' 注 ',money(quantity*10));purchaseButton.disabled=front.size!==5||back.size!==2||quantity*10>data.balance}
  function grid(max,set,n,label){const grid=h('div',{class:'hc-number-grid','aria-label':label});for(let i=1;i<=max;i++)grid.append(btn(String(i).padStart(2,'0'),e=>{if(set.has(i))set.delete(i);else if(set.size<n)set.add(i);else{status.textContent=label+'最多选择'+n+'个号码';return}e.currentTarget.setAttribute('aria-pressed',String(set.has(i)));sync()},{'aria-pressed':String(set.has(i))}));body.append(h('h4',null,label),grid)}
  const fmax=r.rules_version===1?20:35,bmax=r.rules_version===1?8:12;grid(fmax,front,5,'前区 · 选5个');grid(bmax,back,2,'后区 · 选2个')
  const q=h('input',{type:'number',min:1,max:10,value:quantity,'aria-label':'投注注数',onchange:e=>{quantity=Math.max(1,Math.min(10,Math.floor(Number(e.target.value)||1)));e.target.value=quantity;sync()}})
  body.append(h('div',{class:'hc-pick-tools'},btn('机选一组',()=>{const pick=(max,n)=>{const a=Array.from({length:max},(_,i)=>i+1);for(let i=0;i<n;i++){const j=i+Math.floor(Math.random()*(max-i));[a[i],a[j]]=[a[j],a[i]]}return new Set(a.slice(0,n))};front=pick(fmax,5);back=pick(bmax,2);render()}),h('label',{class:'hc-quantity'},'注数 ',btn('−',()=>{quantity=Math.max(1,quantity-1);q.value=quantity;sync()},{'aria-label':'减少注数'}),q,btn('+',()=>{quantity=Math.min(10,quantity+1);q.value=quantity;sync()},{'aria-label':'增加注数'}))),selected,counts,purchaseButton,rules());sync()
  if(data.history.length)body.append(h('h3',null,'近期开奖'),...data.history.map(x=>h('div',{class:'hc-history'},h('small',null,x.day+(x.special?' · 必出奖':'')),balls(JSON.parse(x.front),JSON.parse(x.back)))))
 }
 function scratch(){body.append(h('h3',null,'选一张好彩头'),h('p',{class:'hc-muted'},'单张 / 整本20张 · 中奖40.02% · 理论返还65% · 无日限'))
  const themes=h('div',{class:'hc-themes'});for(const x of data.themes)themes.append(btn(h('div',{'data-theme':x.id,class:'hc-ticket-art'},h('span',{class:'hc-ticket-stamp','aria-hidden':'true'},({banana:'蕉',whale:'鲸',meme:'梗',farm:'丰',star:'星',huan:'欢'})[x.id]),h('strong',null,x.name),money(x.price)),()=>{theme=x.id;render()},{class:'hc-theme','aria-pressed':String(theme===x.id)}));body.append(themes)
  const x=data.themes.find(x=>x.id===theme);body.append(h('div',{class:'hc-buy-row'},...[[1,'买一张'],[20,'买整本 · 20张']].map(([count,label])=>btn(h('span',null,label,' ',money(count*x.price)),()=>purchase({id:crypto.randomUUID(),kind:'scratch',theme,count}),{class:'hc-primary',disabled:count*x.price>data.balance}))),rules())
 }
 async function purchase(input){if(busy||!live())return;busy=true;remember(input);controller?.abort();++epoch;cleanup();cleanup=()=>{};body.inert=true;status.textContent='正在结算，请勿重复操作…';let result
  try{result=await api('/huancai/buy',{method:'POST',body:input});remember(null)}catch(e){if(e.status===409||e.status===400)remember(null);if(live())status.textContent=e.message+'；未确认订单可安全重试。'}finally{busy=false;body.inert=false}
  if(!live())return
  if(result){shownOrder=result.order;tab=input.kind==='scratch'?'scratch':'records';await load();if(live())status.textContent=input.kind==='scratch'?'已购买，奖励已到账；刮开查看结果。':'已购票，开奖后在票夹查看到账结果。'}else render()
 }
 function scratchResult(order){
  const x=data.themes.find(x=>x.id===order.payload.theme),cards=order.payload.cards;let index=0,revealed=new Set(),canvas=null
  const title=h('h3'),ticket=h('div',{class:'hc-scratch-ticket','data-theme':x.id}),result=h('div',{class:'hc-scratch-result'}),list=h('div',{class:'hc-book-list'}),reveal=btn('直接揭晓',()=>show()),next=btn('下一张',()=>{index=(index+1)%cards.length;draw()})
  const summary=h('p',null,`${x.name} · ${cards.length}张 · 总奖励 `,money(order.payload.reward))
  function show(){revealed.add(index);canvas?.remove();canvas=null;list.querySelectorAll('button')[index]?.setAttribute('data-revealed','true');reveal.disabled=true}
  function draw(){cleanup();canvas=null;const c=cards[index];title.textContent=`${x.name} · 第 ${index+1}/${cards.length} 张`;result.replaceChildren(h('strong',null,c.payout?'好彩！':'下次好运'),money(c.payout),h('small',null,c.payout?`${c.multiple}倍奖励 · 已到账`:'本张未中奖'),c.multiple>=5&&h('span',{class:'hc-win-burst','aria-hidden':'true'},'✦'));ticket.replaceChildren(result);reveal.disabled=revealed.has(index);next.hidden=cards.length===1;if(revealed.has(index))return
   canvas=h('canvas',{'aria-label':'刮开票面，或点击直接揭晓',width:600,height:280});ticket.append(canvas);const ctx=canvas.getContext('2d');if(!ctx){show();return}const gradient=ctx.createLinearGradient(0,0,600,280);gradient.addColorStop(0,'#d8d5c8');gradient.addColorStop(1,'#a9b2ab');ctx.fillStyle=gradient;ctx.fillRect(0,0,600,280);ctx.fillStyle='#374c43';ctx.font='bold 28px sans-serif';ctx.textAlign='center';ctx.fillText('刮一刮 · 好彩揭晓',300,150);ctx.globalCompositeOperation='destination-out';let strokes=0
   const erase=e=>{if(!canvas||!canvas.hasPointerCapture(e.pointerId))return;const rect=canvas.getBoundingClientRect();ctx.beginPath();ctx.arc((e.clientX-rect.left)*600/rect.width,(e.clientY-rect.top)*280/rect.height,32,0,Math.PI*2);ctx.fill();if(++strokes>=24)show()};canvas.onpointerdown=e=>{if(e.button!==0)return;canvas.setPointerCapture(e.pointerId);erase(e)};canvas.onpointermove=erase;canvas.onpointerup=e=>{if(canvas?.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId)}
   const owned=canvas;cleanup=()=>{owned.onpointerdown=owned.onpointermove=owned.onpointerup=null;owned.width=owned.height=1;owned.remove()}
  }
  cards.forEach((c,i)=>list.append(btn(String(i+1),()=>{index=i;draw()},{'aria-label':'第'+(i+1)+'张'})))
  body.append(title,summary,ticket,h('div',{class:'hc-buy-row'},reveal,next,btn('整本揭晓',()=>{cards.forEach((_,i)=>revealed.add(i));draw();list.replaceChildren(...cards.map(c=>h('span',null,c.n+'号 ',money(c.payout))))},{hidden:cards.length===1})),list,btn('返回选票',()=>{shownOrder=null;render()}));draw()
 }
 async function records(before){const n=++epoch;controller?.abort();controller=new AbortController();body.append(h('p',{class:'hc-muted'},'记录仅本人可见；已结算奖励直接进入余额。'))
  try{const d=await api('/huancai/orders'+(before?'?before='+before:''),{signal:controller.signal});if(!live()||n!==epoch)return
   if(!before){body.append(h('h3',null,'大乐透 · 最近30注'));if(!data.tickets.length)body.append(h('p',null,'还没有购票。'));for(const t of data.tickets)body.append(h('div',{class:'hc-history'},h('small',null,t.day+' · '+(t.settled_at?(t.payout?'已中奖':'未中奖'):'待开奖 / 结算中')),balls(JSON.parse(t.front),JSON.parse(t.back)),...(t.settled_at?[money(t.payout)]:[])));body.append(h('h3',null,'购买记录'))}
   for(const o of d.orders)body.append(h('div',{class:'hc-order'},h('span',null,date(o.created_at)+' · '+(o.kind==='lotto'?'大乐透 '+o.payload.tickets.length+'注':data.themes.find(x=>x.id===o.payload.theme)?.name+' '+o.payload.cards.length+'张')),money(o.price),...(o.kind==='scratch'?[btn('查看票面',()=>{shownOrder=o;tab='scratch';render()})]:[])))
   if(d.next)body.append(btn('更早记录',e=>{e.currentTarget.remove();records(d.next)}));if(!d.orders.length)body.append(h('p',null,'暂无购买记录。'))
  }catch(e){if(live()&&n===epoch&&e.name!=='AbortError')status.textContent=e.message}
 }
 function open(){if(dead)return;const restore=captureChatScroll(scroller);opened=true;layout();restore();load()}
 function close(){const restore=captureChatScroll(scroller);opened=false;++epoch;controller?.abort();cleanup();cleanup=()=>{};body.replaceChildren();layout();restore();opener.focus({preventScroll:true})}
 function destroy(){close();dead=true;observer.disconnect();panel.remove()}
 return {open,close,destroy}
}
