import {emojiInvitePath} from './emoji-invite.js';
// Share only public identifiers. Never serialize the round or its answer fields.
export function guessRoundLink(origin,gid,messageId){
 if(!Number.isSafeInteger(gid)||gid<1||!Number.isSafeInteger(messageId)||messageId<1)throw Error('轮次信息尚未就绪');
 const base=new URL(origin);if(!['https:','http:'].includes(base.protocol))throw Error('分享地址无效');
 return base.origin+emojiInvitePath(gid,messageId);
}
export function invitedRound(search){const raw=new URLSearchParams(search).get('message_id');return raw&&/^[1-9]\d*$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):0}
export function winnerSlots(round){
 const total=Number(round?.count)||0,claimed=Array.isArray(round?.recipients)?round.recipients.filter(r=>!r.purpose||r.purpose==='winner').length:Number(round?.claimed_count)||0;
 const won=Math.min(total,Math.max(0,claimed)),remaining=Math.max(0,total-won);
 return {total,won,remaining,text:total<2?'':round.state==='open'?`剩余 ${remaining} 个获奖名额 · 已中 ${won}/${total}`:`本局已结束 · 获奖 ${won}/${total}${remaining?' · '+remaining+' 个名额已关闭':''}`};
}
export function openGuessInvite({h,gid=1,messageId,created=false,anchor,doc=document}){
 const win=doc.defaultView,url=guessRoundLink(win.location.origin,gid,Number(messageId));
 const previous=anchor||doc.activeElement,status=h('p',{class:'gm-invite-status',role:'status','aria-live':'polite'});
 const input=h('input',{class:'gm-invite-url',type:'url',readonly:true,value:url,'aria-label':'本局邀请链接',onclick:e=>e.currentTarget.select()});
 const close=h('button',{type:'button',onclick:()=>dialog.close(),'aria-label':'关闭邀请窗口'},'关闭');
 const copy=h('button',{type:'button',class:'gm-invite-copy',onclick:async()=>{
  try{if(!win.navigator.clipboard?.writeText)throw Error('clipboard');await win.navigator.clipboard.writeText(url);status.textContent='链接已复制，可以发送给好友。'}
  catch{input.focus();input.select();status.textContent='未能自动复制，请长按或使用 Ctrl/Cmd+C 复制已选链接。'}
 }},'复制链接');
 const dialog=h('dialog',{class:'game-dialog gm-invite-dialog','aria-label':created?'猜词已创建，邀请参与':'邀请参与本局'},h('header',null,h('h2',null,created?'猜词已创建':'邀请参与本局'),close),h('p',null,'分享后可直接打开这一局；登录后仍会返回本局。'),h('label',null,'本局邀请链接',input),h('div',{class:'gm-invite-actions'},copy),status);
 dialog.addEventListener('close',()=>{dialog.remove();if(previous?.isConnected)previous.focus()},{once:true});doc.body.append(dialog);dialog.showModal();copy.focus();return dialog;
}
