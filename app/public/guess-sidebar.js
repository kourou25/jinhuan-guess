import {currencyBadge} from '/guess-currency.js';
import {avatarImage} from '/avatar-view.js?v=20261019a';
export function createGuessSidebar({h,api,userId,chat,onRefresh}){
 const doc=chat.ownerDocument,btn=(text,run,attrs={})=>h('button',{type:'button',onclick:run,...attrs},text);
 let round=null,selected=null,busy=false,nonce=null,dead=false;
 const ranking=h('ol',{class:'gm-ranking'}),betInfo=h('p',{class:'gm-bet-info',role:'status'}),mine=h('p',{class:'gm-bet-mine'});
 const amount=h('input',{type:'number','aria-label':'下注金额',inputmode:'decimal',required:true}),chosen=h('strong',null,'先选择排名中的玩家');
 const submit=h('button',{type:'submit'},'确认下注'),cancel=btn('取消选择',()=>{selected=null;form.hidden=true});
 const form=h('form',{class:'gm-bet-form',hidden:true,onsubmit:async e=>{e.preventDefault();if(busy||!round?.prediction?.can_bet||!selected)return;busy=true;submit.disabled=true;nonce??=crypto.randomUUID();betInfo.textContent='正在提交…';try{await api(`/chat/messages/${round.message_id}/prediction`,{method:'POST',body:{target_id:selected.id,amount:amount.value,nonce}});selected=null;form.hidden=true;await onRefresh()}catch(e){betInfo.textContent=e.message}finally{busy=false;submit.disabled=false}}},chosen,h('label',null,'下注金额',amount),h('small',null,'每局一次，不可追加、改押或撤回。'),h('div',null,submit,cancel));
 const currency=h('span',{class:'gm-sidebar-currency'});
 const rankToggle=btn('展开',()=>{const open=top.dataset.expanded!=='true';top.dataset.expanded=String(open);rankToggle.textContent=open?'收起':'展开';rankToggle.setAttribute('aria-expanded',String(open))},{class:'gm-rank-toggle','aria-label':'展开或收起全部排名与下注','aria-expanded':'false'});
 const top=h('section',{class:'gm-rank-section','aria-label':'本局排名与下注'},h('header',null,h('h2',null,'本局排名'),currency,rankToggle),ranking,betInfo,mine,form);
 const element=h('aside',{class:'gm-sidebar','aria-label':'排名与聊天'},top,h('header',{class:'gm-chat-title'},h('h2',null,'聊天'),h('small',null,'一起讨论，别泄露谜底')),chat);
 function select(p){if(busy||!round?.prediction?.can_bet)return;selected=p;nonce=null;chosen.textContent='押 '+p.name+' 首位猜中';amount.value=String(round.prediction.min);form.hidden=false;amount.focus()}
 function update(value){if(dead)return;if(round?.id!==value?.id){selected=null;nonce=null;form.hidden=true}round=value;currency.replaceChildren(...(round?[currencyBadge(h,round)]:[]));const pool=round?.prediction;
  ranking.replaceChildren(...(round?.players?.length?round.players.map((p,i)=>h('li',{class:p.winner_rank?'is-winner':''},h('span',{class:'gm-place'},String(i+1).padStart(2,'0')),p.avatar?avatarImage(h,p.avatar,'',32,'gm-avatar'):h('span',{class:'gm-avatar'},p.name?.slice(0,1)||'·'),h('span',{class:'gm-player'},h('strong',null,p.name),p.title&&h('small',null,p.badge+' '+p.title)),h('b',null,p.winner_rank?'已猜中':p.score==null?'待评分':p.score+'%'),pool?.can_bet&&p.id!==userId&&!p.winner_rank?btn('押TA',()=>select(p),{'aria-label':'下注 '+p.name}):null)):[h('li',{class:'gm-empty'},'还没有有效猜测，参与后进入本局榜。')]));
  const format=n=>pool?.currency==='ldc'?(n/100).toFixed(2):String(n);
  betInfo.textContent=!pool?.enabled?'本局未开启下注':!pool.available?pool.unavailable_reason:pool.state==='refunded'?'已原额退款':pool.state==='settled'?'本局下注已结算':pool.closed?'已封盘 · '+(pool.winner_id?'首位已猜中':'已开始揭字'):`押首位猜中者 · ${pool.label}${pool.simulated?'（模拟）':''} · 总池 ${format(pool.total)} · ${pool.count} 人`;
  const m=pool?.mine;
  const detail=m?.collection_state==='rejected'?'收取未成功，本笔未成立':m?.collection_state&&m.collection_state!=='accepted'?'收取结果待核对':m?.payout_state&&m.payout_state!=='accepted'?(m.result_kind==='refund'?'退款':'派奖')+'处理中，到账待确认':m?.result_kind==='refund'?'已退款':m?.result_kind==='win'?'已到账 '+format(m.result_amount):m?.result_kind==='loss'?'未押中':'等待结算';
  mine.textContent=m?`我的下注：${format(m.amount)} ${pool.label} · ${detail}`:'';
  if(!pool?.can_bet){form.hidden=true;selected=null}else{amount.min=pool.min;amount.max=pool.max;amount.step=pool.currency==='ldc'?'0.01':'1'}
 }
 return {element,update,destroy(){dead=true;element.remove()}};
}

export function openGuessAchievements({h,api,host,onRefresh}){
 const doc=host.ownerDocument,dialog=h('dialog',{class:'gm-achievements'}),body=h('div'),status=h('p',{role:'status'}),close=h('button',{type:'button',onclick:()=>dialog.close(),'aria-label':'关闭成就'},'关闭');
 dialog.append(h('header',null,h('h2',null,'猜词成就'),close),body,status);doc.body.append(dialog);dialog.addEventListener('close',()=>{dialog.remove();onRefresh?.()},{once:true});dialog.showModal();
 async function draw(){status.textContent='正在读取…';try{const data=await api('/me'),u=data.user;if(!u){status.textContent='请先登录';return}const rewards=[...(data.guess_rewards||[]),...(data.activity_rewards||[]).filter(r=>r.series?.startsWith('guess_'))];
  body.replaceChildren(...rewards.map(r=>{const series=r.series||'guess',count=u.badges?.find(b=>b.id===series)?.n||0,unlocked=u.unlocks?.includes(series+':'+r.level),worn=u.deco?.gr===r.id;const wear=h('button',{type:'button',disabled:!unlocked||worn,onclick:async()=>{wear.disabled=true;status.textContent='正在佩戴…';try{await api('/me/profile',{method:'PATCH',body:{deco:{...u.deco,gr:r.id,ot:null,rt:null,ft:null,fn:null,pt:null}}});await draw();status.textContent='已佩戴称号、徽章与对应气泡。'}catch(e){status.textContent=e.message;wear.disabled=false}}},worn?'已佩戴':unlocked?'佩戴':'未解锁');return h('article',null,h('span',{class:'gm-achievement-symbol'},r.symbol),h('div',null,h('strong',null,r.name+' · Lv'+r.level),h('p',null,r.desc||'累计猜中获得称号、徽章与气泡'),h('progress',{max:r.wins,value:Math.min(count,r.wins),'aria-label':r.name+'进度'}),h('small',null,`${count} / ${r.wins} 次`)),wear)}));status.textContent='称号、徽章与气泡使用原有成长记录，达到条件后解锁。';
 }catch(e){status.textContent=e.message}}
 draw();return dialog;
}
