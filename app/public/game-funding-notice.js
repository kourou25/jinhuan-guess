const states=new WeakMap();
const version='v1';
export function installFundingNotice(userId,doc=document){
 const bar=doc.querySelector('.game-presence');if(!bar)return;
 const win=doc.defaultView,owner=Number.isSafeInteger(userId)&&userId>0?String(userId):'guest',key=`guess-funding-notice:${version}:${owner}`;
 let state=states.get(doc);if(!state){state={closed:new Set(),key:null,node:null,dialog:null};states.set(doc,state)}
 if(state.key===key&&state.node?.isConnected)return state.node;
 state.dialog?.close();state.node?.remove();state.key=key;
 const make=(tag,text,attrs={})=>{const n=doc.createElement(tag);if(text)n.textContent=text;for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n};
 const notice=make('aside',null,{class:'game-funding-notice','aria-label':'游戏币公告'}),icon=make('span','📢',{class:'game-funding-icon','aria-hidden':'true'}),copy=make('p',null,{class:'game-funding-copy'}),close=make('button','×',{type:'button',class:'game-funding-close','aria-label':'关闭游戏币公告','aria-haspopup':'dialog'});
 copy.append(make('strong','LDC',{class:'game-funding-ldc'}),doc.createTextNode('发起游戏可选credit和fish🐟额，但请提前配置商户信息以免收发失败。'),make('strong','D币',{class:'game-funding-coin'}),doc.createTextNode('作为欢站游戏币仅能用于游戏，无任何交易价值'));
 notice.append(icon,copy,close);state.node=notice;
 let saved=false;try{saved=win.localStorage.getItem(key)==='hidden'}catch{}
 notice.hidden=saved||state.closed.has(key);bar.prepend(notice);
 close.onclick=()=>{
  if(state.dialog)return;
  const dialog=make('dialog',null,{class:'game-dialog game-funding-dialog','aria-labelledby':'game-funding-close-title'}),head=make('header'),exit=make('button','×',{type:'button','aria-label':'取消关闭公告'}),status=make('p','',{class:'game-funding-status',role:'status','aria-live':'polite'}),actions=make('footer'),once=make('button','本次关闭',{type:'button'}),forever=make('button','永久关闭',{type:'button'});
  head.append(make('h2','关闭公告',{id:'game-funding-close-title'}),exit);actions.append(once,forever);
  dialog.append(head,make('p','本次关闭后，刷新页面会重新显示。永久关闭仅对当前浏览器中的当前账号生效。'),status,actions);
  const hide=permanent=>{if(permanent){try{win.localStorage.setItem(key,'hidden')}catch{status.textContent='浏览器未允许保存设置，暂时无法永久关闭。你仍可选择“本次关闭”。';return}}state.closed.add(key);notice.hidden=true;dialog.close()};
  once.onclick=()=>hide(false);forever.onclick=()=>hide(true);exit.onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{dialog.remove();if(state.dialog===dialog)state.dialog=null;if(state.key===key){const target=notice.hidden?bar.querySelector('.game-people-button'):close;target?.focus({preventScroll:true})}},{once:true});
  state.dialog=dialog;doc.body.append(dialog);dialog.showModal();once.focus();
 };
 return notice;
}
