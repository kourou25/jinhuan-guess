import {avatarImage} from '/avatar-view.js?v=20261019a'

export function createGuessLuckybag({h,announcements}){
 let bag=null,dialog=null,body=null,primed=false
 const heading=h('strong',{class:'gm-luckybag-heading'}),description=h('span',{class:'gm-luckybag-description'})
 const button=h('button',{type:'button',class:'gr-link gm-luckybag-open',hidden:true,onclick:open,'aria-haspopup':'dialog'},
  h('span',{class:'gm-luckybag-icon','aria-hidden':'true'},'💰'),h('span',{class:'gm-luckybag-copy'},heading,description))
 const person=p=>h('span',{class:'gm-luckybag-person'},p.avatar?avatarImage(h,p.avatar,p.name,28):h('span',{class:'gm-avatar-fallback','aria-hidden':'true'},(p.name||'玩').slice(0,1)),h('span',null,p.name||'玩家'))
 function render(){
  if(!body||!bag)return
  const settled=bag.state==='settled',refunded=bag.state==='refunded',pending=['closing','allocating'].includes(bag.state)
  body.replaceChildren(h('p',{class:'gm-luckybag-total'},h('strong',null,String(bag.total)),h('span',null,' D币')),
   h('p',null,`${bag.participants} / ${bag.capacity} 人 · ${settled?'已分发':refunded?'无人参加，已退回':pending?'正在分发':'本局结束后拼手气分发'}`),
   h('p',{class:'gm-luckybag-mine',role:'status'},bag.mine.amount!==null?`你获得 ${bag.mine.amount} D币`:bag.mine.pending?'你的份额正在入账':bag.mine.joined?'你已自动参加':settled||refunded||pending?'你未进入本局福袋名单':bag.participants>=bag.capacity?'福袋名额已满':'有效猜测或是非作答后自动参加'),
   h('p',{class:'gm-luckybag-sponsor'},'本袋由 ',person(bag.sponsor),' 提供'),
   ...(bag.leaders.length?[h('h3',null,'手气榜 · 前20名'),h('ol',{class:'gm-luckybag-leaders'},...bag.leaders.map(p=>h('li',null,person(p),h('strong',null,p.amount+' D币'))))]:[]))
 }
 function open(){if(!bag)return;if(dialog){dialog.showModal();return}const close=h('button',{type:'button',onclick:()=>dialog.close()},'关闭');body=h('div',{class:'gm-luckybag-body'});dialog=h('dialog',{class:'game-dialog gm-luckybag-dialog','aria-label':'D币福袋详情'},h('header',null,h('h2',null,'D币福袋'),close),body);dialog.addEventListener('close',()=>{dialog.remove();dialog=null;body=null;button.focus()},{once:true});document.body.append(dialog);render();dialog.showModal()}
 return {button,update(value,now){bag=value||null;button.hidden=!bag;if(!bag){if(dialog)dialog.close();announcements.extra([],now,!primed);primed=true;return}
  const finished=['settled','refunded'].includes(bag.state),distributing=['closing','allocating'].includes(bag.state)
  heading.textContent=finished?'本局福袋已结束':distributing?'本局福袋正在分发':'本局出现随机福袋'
  description.textContent=bag.state==='refunded'?'本局无人参加，D币已退回':finished?(bag.mine.amount!==null?`你获得 ${bag.mine.amount} D币 · 点击查看手气榜`:'随机D币已发放 · 点击查看手气榜'):distributing?'本局已结束，随机D币正在发放':bag.participants>=bag.capacity?'名额已满，已参加玩家将在结束后获得随机D币':'参与猜词即可在结束后获得随机D币'
  button.dataset.state=bag.state
  button.title=`${bag.total} D币 · ${bag.participants}人 · 点击查看福袋`;render()
  const items=[{id:'luckybag-open-'+bag.id,kind:'luckybag',created_at:bag.funded_at,text:`送出 ${bag.total} D币福袋，有效作答自动参加，本局结束后分发。`,players:bag.sponsor?[bag.sponsor]:[]}]
  if(bag.settled_at)items.push({id:'luckybag-end-'+bag.id,kind:'luckybag',created_at:bag.settled_at,text:bag.state==='refunded'?'本局福袋无人参加，已原额退回。':`本局 ${bag.total} D币福袋已分发给 ${bag.participants} 人。${bag.mine.amount!==null?'你获得 '+bag.mine.amount+' D币。':''}`,players:bag.leaders.slice(0,3)})
  announcements.extra(items,now,!primed);primed=true
 },destroy(){dialog?.close()}}
}
