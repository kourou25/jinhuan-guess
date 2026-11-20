const endpoint='/api/guess-sidebar/starter';
const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text)n.textContent=text;for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n};
const messages={ended:'领取活动已结束。',inactive:'领取活动暂未开放。',ineligible:'此账号暂时无法领取，请重新登录后重试。',unavailable:'当前余额无法入账，请联系站长。'};
async function request(claim=false){
 const r=await fetch(endpoint,{cache:'no-store',...(claim?{method:'POST',headers:{'content-type':'application/json'},body:'{}'}:{})});
 const data=await r.json();if(!r.ok)throw Error(data.error||'领取状态读取失败，请稍后重试');return data;
}
export async function installStarterGift(){
 if(document.querySelector('[data-starter-entry]'))return;
 let state;try{state=await request()}catch{return}
 if(state.state!=='eligible')return;
 const entry=el('button','领取 D币',{type:'button','data-starter-entry':'',class:'gm-starter-entry'});
 let timer;
 const open=()=>{
  clearTimeout(timer);
  if(document.querySelector('.gm-starter-dialog'))return;
  const previous=document.activeElement,dialog=el('dialog',null,{class:'game-dialog gm-starter-dialog','aria-labelledby':'gm-starter-title'}),head=el('header'),close=el('button','关闭',{type:'button','aria-label':'关闭起始资金窗口'});
  head.append(el('h2','登录起始资金',{id:'gm-starter-title'}),close);
  const amount=el('p',null,{class:'gm-starter-amount'});amount.append(el('strong','10,000'),document.createTextNode(' D币'));
  const detail=el('p','10月25日22:00起登录或继续访问猜词页，新老账号均可领取一次。奖励直接存入与主站共用的 D币钱包。');
  const deadline=el('p','请在 2026 年 11 月 1 日 00:00 前领取（北京时间）。',{class:'gm-starter-deadline'});
  const status=el('p','',{'role':'status','aria-live':'polite',class:'gm-starter-status'}),actions=el('footer'),later=el('button','稍后领取',{type:'button'}),claim=el('button','领取 10,000 D币',{type:'button',class:'gm-starter-claim'});
  actions.append(later,claim);dialog.append(head,amount,detail,deadline,status,actions);
  close.onclick=later.onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{dialog.remove();if(previous?.isConnected)previous.focus()},{once:true});
  claim.onclick=async()=>{
   if(claim.disabled)return;claim.disabled=true;claim.textContent='正在领取…';status.textContent='';
   try{
    state=await request(true);
    if(state.state==='claimed'){
     entry.remove();head.querySelector('h2').textContent='起始资金已到账';
     status.textContent='已领取 10,000 D币，当前余额 '+Number(state.balance).toLocaleString('zh-CN')+' D币。';
     claim.textContent='开始猜词';claim.disabled=false;claim.onclick=()=>dialog.close();later.remove();
     window.dispatchEvent(new CustomEvent('guess-wallet-updated',{detail:{balance:state.balance}}));
    }else{status.textContent=messages[state.state]||'尚未入账，请稍后重试。';claim.textContent='领取 10,000 D币';claim.disabled=state.state!=='eligible';if(state.state!=='eligible')entry.remove()}
   }catch(e){status.textContent=e instanceof TypeError||e instanceof SyntaxError?'网络暂时不可用，请重试；重复领取不会重复发放。':e.message||'领取失败，请稍后重试。';claim.textContent='重试领取';claim.disabled=false}
  };
  document.body.append(dialog);dialog.showModal();claim.focus();
 };
 entry.onclick=open;document.querySelector('.game-presence')?.append(entry);
 // Existing welcome tours and other dialogs finish first, so only one modal owns focus.
 timer=setTimeout(function showWhenReady(){
  if(!entry.isConnected)return;
  if(document.querySelector('.modal,dialog[open]')||document.hidden){timer=setTimeout(showWhenReady,800);return}
  open();
 },2200);
 addEventListener('pagehide',()=>clearTimeout(timer),{once:true});
}
