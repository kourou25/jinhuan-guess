import {shiguangCeremony} from '/shiguang-host.js'
import {dcoinAmount} from '/dcoin.js'
import {titleBadgeSource} from '/title-visuals.js'
const BASE='/instant-cards'
const permanent=r=>r.reward_kind==='title'||(!r.reward_kind&&!!r.won)
const money=(h,n)=>dcoinAmount(h,n)
const date=t=>new Date(t*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})
export function openInstantCards({anchor,api,h,legacy,preview}){
 const doc=anchor.ownerDocument;if(doc.querySelector('.ic-dialog'))return
 if(!doc.querySelector('link[data-instant-cards]'))doc.head.append(h('link',{rel:'stylesheet',href:'/instant-cards.css?v=20261021','data-instant-cards':''}))
 const body=h('div',{class:'ic-body'}),nav=h('nav',{class:'ic-tabs','aria-label':'抽卡分类'}),dialog=h('dialog',{class:'ic-dialog','aria-label':'抽卡'},h('header',null,h('h2',null,'抽卡'),h('button',{class:'ic-close','aria-label':'关闭抽卡',onclick:()=>dialog.close()},'×')),nav,body)
 let data,selected='',tab='draw',poolKind='standard',busy=false,pending=null,cleanup=()=>{},epoch=0
 const storage=()=>`instant-card-pending:${data.user_id}`
 const remember=value=>{pending=value;try{if(value)sessionStorage.setItem(storage(),JSON.stringify(value));else sessionStorage.removeItem(storage())}catch{}}
 const live=()=>dialog.isConnected
 dialog.addEventListener('close',()=>{epoch++;cleanup();dialog.remove();anchor.isConnected&&anchor.focus()},{once:true});doc.body.append(dialog);dialog.showModal()
 const name=id=>data?.titles.find(x=>x.id===id)?.name||id
 const btn=(text,fn,extra={})=>h('button',{type:'button',onclick:fn,...extra},text)
 function tabs(){nav.replaceChildren(...[['draw','抽卡'],['records','参与记录'],...(data?.can_manage?[['manage','站长管理']]:[])].map(([id,label])=>btn(label,()=>{if(busy)return;tab=id;render()},{'aria-pressed':String(tab===id)})),...(legacy?[btn('旧场次',()=>{dialog.close();legacy()})]:[]))}
 async function load(){const n=++epoch;body.replaceChildren(h('p',{role:'status'},'正在整理牌堆…'));try{data=await api(BASE);if(!live()||n!==epoch)return;selected=data.pools.some(x=>x.title===selected)?selected:data.pools.find(x=>x.active&&x.enabled&&x.available)?.title||data.pools[0]?.title||'';try{pending=JSON.parse(sessionStorage.getItem(storage())||'null')}catch{pending=null}render()}catch(e){if(live())body.replaceChildren(h('p',{role:'alert'},e.message),btn('重新加载',load))}}
 function render(){cleanup();cleanup=()=>{};tabs();if(tab==='draw')draw();else if(tab==='records')records();else manage()}
 function errorBox(e,retry){return h('div',{class:'ic-error',role:'alert'},e.message,retry&&btn('重试该笔',retry))}
 async function pay(payload){
  if(busy)return;const previousClaude=Number(data.owned_levels?.claude||data.pools.find(p=>p.title==='claude')?.owned_level||0);busy=true;remember(payload);draw()
  try{const result=await api(BASE+'/settle',{method:'POST',body:payload});remember(null);try{data=await api(BASE)}catch{}if(!live())return;busy=false;tabs();showResult(result.receipts||result.receipt);const receipts=[result.receipts||result.receipt].flat().filter(Boolean);if(previousClaude<5200&&receipts.some(r=>permanent(r)&&(r.reward_id||r.title)==='claude'&&Number(r.reward_level)>=5200)){const host=h('div',{class:'sg-cer-host'}),life=new AbortController();dialog.append(host);dialog.addEventListener('close',()=>life.abort(),{once:true});shiguangCeremony({document:doc,container:host,from:previousClaude,signal:life.signal}).finally(()=>host.remove())}}
  catch(e){busy=false;if(!live())return;if([400,401,403,409].includes(e.status))remember(null);draw();body.prepend(errorBox(e,pending?()=>pay(pending):null))}
 }
 function draw(){
  const choices=data.pools.filter(p=>!!data.titles.find(t=>t.id===p.title)?.limited===(poolKind==='limited')&&(poolKind!=='limited'||p.available));if(!choices.some(p=>p.title===selected))selected=choices.find(p=>p.active&&p.enabled)?.title||choices[0]?.title||''
  const title=data.titles.find(t=>t.id===selected),pity=poolKind==='limited'?data.limited_pity:data.pity
  const pool=data.pools.find(x=>x.title===selected),available=pool?.active&&pool.enabled&&pool.available,blocked=busy||!!pending||!available||data.balance<100
  const select=h('select',{'aria-label':'选择奖池',onchange:e=>{selected=e.target.value;draw()},disabled:busy||!!pending},choices.map(p=>h('option',{value:p.title,selected:p.title===selected},name(p.title)+(p.active&&p.enabled?'':' · 暂停'))))
  const action=(count=1)=>pay({id:crypto.randomUUID(),title:selected,kind:'draw',count,level:data.level,revision:pool.revision})
  const deck=h('div',{class:'ic-deck'},[0,1,2].map((n)=>h('button',{class:'ic-card-back',style:`--card-i:${n-1}`,'aria-label':`支付100 D币抽第${n+1}张卡，称号率${data.chance}%`,disabled:blocked,onclick:()=>action()},h('img',{class:'ic-deck-mascot',src:titleBadgeSource(selected),alt:'',width:80,height:80}),h('strong',null,name(selected)||'等待开池'),h('small',null,'点选立即开奖'))))
  const finger=h('section',{class:'ic-finger'},h('span',{class:'ic-hand','aria-hidden':'true'},'☝'),h('div',null,h('strong',null,'金手指 Lv'+data.level),h('p',null,`永久加成 +${data.chance-10}个百分点 · 最高25%`)),data.next_price!==null?btn([money(h,data.next_price),' 升至 Lv'+(data.level+1)],()=>pay({id:crypto.randomUUID(),title:selected,kind:'finger',level:data.level,revision:pool.revision}),{disabled:busy||!!pending||!pool?.active||!pool.enabled||data.balance<data.next_price}):h('span',null,'已满级'))
  body.replaceChildren(h('nav',{class:'ic-pool-types','aria-label':'奖池类型'},...[["standard","常驻星匣"],["limited","限定巡展"]].map(([id,label])=>btn(label,()=>{poolKind=id;draw()},{'aria-pressed':String(poolKind===id),disabled:busy||!!pending}))),h('p',{class:'ic-season'},poolKind==='limited'?'本期至 '+date(data.exhibit.ends_at)+' · 保底随限定展期继承':'随时相遇 · 永久开放的主题收藏'),h('div',{class:'ic-top'},h('label',null,'牌堆 ',select),h('span',null,'余额 ',money(h,data.balance))),
   ...(data.newcomer?.eligible&&!data.newcomer.claimed?[h('section',{class:'ic-newcomer'},h('strong',null,'新人见面礼 · 初见欢欢'),btn('免费领取新人称号',async()=>{if(busy)return;busy=true;try{await api(BASE+'/newcomer',{method:'POST',body:{}});busy=false;await load()}catch(e){body.prepend(errorBox(e))}finally{busy=false}},{disabled:busy}))]:[]),
   h('section',{class:'ic-play','data-pool':poolKind,style:title?`--pool-color:${title.color};--pool-accent:${title.accent}`:''},h('h3',null,name(selected)||'暂无开放奖池'),h('p',{class:'ic-odds'},'每抽 ',money(h,100),h('strong',null,`中奖率 ${data.chance}%`)),preview&&titlePreview(selected),deck,
   h('div',{class:'ic-result-actions'},btn(busy?'正在结算…':!available?'奖池未开放':data.balance<100?'余额不足':['抽取一张 · ',money(h,100)],()=>action(),{class:'ic-primary',disabled:blocked}),btn(['十连立即开奖 · ',money(h,1000)],()=>action(10),{class:'ic-primary',disabled:blocked||data.balance<1000})),
   h('p',{class:'ic-pity'},`最多再 ${Math.max(1,data.pity_limit-(pity||0))} 抽必得称号 · 已连续 ${pity||0} 抽未获称号`),
   h('p',{class:'ic-note'},'同类牌堆共享60抽保底，永久称号中奖后重置。体验卡不重置保底。重复称号 +1 / +2 / +5 级，最高5200；满级仍保留收藏记录。'),
   h('details',{class:'ic-rules'},h('summary',null,'奖池与概率'),h('p',{class:'ic-note'},`永久称号率 ${data.chance}%；命中时75%为所选、25%为当前同类池内随机称号。第60抽必为所选。等级+1/+2/+5概率80%/18%/2%。未中永久时：20%得20–50 D币、30%得1–3枚种子、30%得一天体验卡、20%为空卡。体验卡中限定占0.1%；等级区间1–50/50–300/300–1600/1600–5200权重60%/30%/9%/1%，区间内均匀随机。一天从获得时开始，重复卡取较高等级和较晚有效期。D币奖励从本站长本次收入中返还。`))),
   pending?h('div',{class:'ic-pending',role:'status'},'上一笔结果待核对，请先恢复。',btn('恢复上一笔',()=>pay(pending),{disabled:busy})):h('span'),finger,
   h('p',{class:'ic-note'},`抽卡及金手指费用全部转入 ${pool?.owner_name||pool?.owner_username||'奖池站长'} 的D币账户。金手指价格：1000 / 3000 / 5000 / 7000 / 9000。`))
 }
 function titlePreview(id){
  const view=h('div',{class:'ic-title-preview'}),select=h('select',{'aria-label':'预览称号等级'},data.stages.map((n,i)=>h('option',{value:n},'Lv'+n+' · '+data.stage_names[i])))
  const draw=()=>view.replaceChildren(preview(id,Number(select.value)));select.onchange=draw;draw()
  return h('section',{class:'ic-preview'},h('div',{class:'ic-preview-heading'},h('strong',null,'样式预览'),select),view)
 }
 const seeds={carrot:'胡萝卜',cabbage:'包菜',wheat:'小麦',tomato:'番茄',corn:'玉米',pumpkin:'南瓜'}
 function prizeName(r){return r.reward_kind==='trial'?name(r.reward_id)+' · Lv'+r.reward_amount+' · 1天':r.reward_kind==='coin'?r.reward_amount+' D币':r.reward_kind==='seed'?(seeds[r.reward_id]||r.reward_id)+'种子 ×'+r.reward_amount:r.won?name(r.reward_id||r.title)+' +'+(r.reward_amount||1)+'级':'本次未中奖'}
 function showResult(value){
  cleanup();cleanup=()=>{};const results=Array.isArray(value)?value:[value],r=results[0]
  if(r.kind==='finger'){body.replaceChildren(h('section',{class:'ic-result'},h('span',{class:'ic-hand'},'☝'),h('h3',null,'金手指已升至 Lv'+r.finger_level),h('p',null,'永久称号率 '+r.chance+'%'),h('p',null,'已付 ',money(h,r.price),'，已计入站长账户。'),btn('返回牌堆',load,{class:'ic-primary'})));return}
  const cards=results.map(x=>h('article',{class:'ic-revealed '+(x.won?'is-title':x.reward_kind&&x.reward_kind!=='none'?'is-prize':'is-empty')},h('small',null,x.guaranteed?'60抽保底':x.won?'永久称号':x.reward_kind==='trial'?'一天体验卡':x.reward_kind==='seed'?'农场种子':x.reward_kind==='coin'?'D币奖励':'空卡'),h('strong',null,prizeName(x)),(x.won||x.reward_kind==='trial')&&preview?preview(x.reward_id||x.title,x.reward_kind==='trial'?x.reward_amount:Math.min(5200,(data.pools.find(p=>p.title===(x.reward_id||x.title))?.owned_level||1))):h('span',{class:'ic-prize-icon','aria-hidden':'true'},x.reward_kind==='coin'?money(h,x.reward_amount):x.reward_kind==='seed'?'🌱':'◇')))
  body.replaceChildren(h('section',{class:'ic-result'},h('h3',null,results.length===10?'十连结果':'本次结果'),h('p',{class:'ic-odds'},'已付 ',money(h,results.reduce((n,x)=>n+x.price,0))),h('div',{class:'ic-result-grid'},cards),h('p',{class:'ic-note',role:'status'},'结果已保存，奖励已到账；称号可在我的装扮中佩戴。'),h('div',{class:'ic-result-actions'},btn('返回牌堆',load,{class:'ic-primary'}),btn('查看记录',()=>{tab='records';render()}))))
 }
 async function records(before=null,mine=false){
  const n=++epoch;body.replaceChildren(h('p',{role:'status'},'正在读取参与记录…'))
  try{const d=await api(BASE+'/records?mine='+(mine?'1':'0')+(before?'&before='+before:''));if(!live()||n!==epoch)return
   body.replaceChildren(h('div',{class:'ic-record-controls'},btn(mine?'查看全部':'只看我的',()=>records(null,!mine)),before&&btn('返回最新',()=>records(null,mine))),
   h('div',{class:'ic-records'},h('div',{class:'ic-record-head'},h('span',null,'参与者 / 卡片'),h('span',null,'投入'),h('span',null,'结果')),
   d.records.length?d.records.map(r=>h('article',null,h('div',null,h('strong',null,r.name||r.username),h('small',null,(r.kind==='finger'?'金手指 Lv'+r.finger_level:name(r.title))+' · '+date(r.created_at))),money(h,r.price),h('div',{class:r.won?'ic-won':''},h('strong',null,r.kind==='finger'?'升级成功':prizeName(r)),h('small',null,r.kind==='draw'?r.chance+'%':'永久'),r.mine&&r.kind==='draw'&&btn('查看卡片',()=>showResult(r))))):h('p',null,'暂无参与记录')),
   d.next?btn('更早记录',()=>records(d.next,mine)):h('span'),h('p',{class:'ic-note'},'显示每笔投入与结果。新抽卡及金手指费用全部进入奖池站长账户。'))
  }catch(e){if(live())body.replaceChildren(errorBox(e,()=>records(before,mine)))}
 }
 async function manage(){
  const n=++epoch;body.replaceChildren(h('p',{role:'status'},'正在读取管理信息…'))
  try{const {totals}=await api(BASE+'/management');if(!live()||n!==epoch)return
   const save=async(title,active,revision)=>{if(busy)return;busy=true;try{await api(BASE+'/pools',{method:'POST',body:{title,active,revision}});busy=false;await load()}catch(e){body.prepend(errorBox(e))}finally{busy=false}}
   body.replaceChildren(h('div',{class:'ic-summary'},h('span',null,'累计入账 ',money(h,totals.income)),h('span',null,`${totals.draws||0} 次抽卡 · ${totals.wins||0} 次中奖`)),h('p',{class:'ic-note'},'开启或暂停牌堆。暂停不影响已支付卡片与到账称号。价格100，永久称号基础10%，金手指最高25%，60抽保底。限定称号按双周展期轮换；未在展期时暂停新抽取，体验卡仍有极低概率掉落。'),
    h('div',{class:'ic-pool-list'},data.titles.filter(t=>t.enabled&&!t.newcomer).map(t=>{const p=data.pools.find(p=>p.title===t.id);return h('article',null,h('div',null,h('strong',null,t.name),h('small',null,t.limited?'限定巡展':'常驻星匣')),preview&&preview(t.id,1),h('span',null,p?.active?(p.available?'开放中':'等待展期'):'未开放'),btn(p?.active?'暂停':'开放',()=>save(t.id,p?.active?0:1,p?.revision||0),{disabled:p&&p.owner_id!==data.user_id}))})))
  }catch(e){if(live())body.replaceChildren(errorBox(e,manage))}
 }
 load()
}
