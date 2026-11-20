// Open the copied guessing component as the primary page.
const seen=new WeakSet();
function openOriginalGuess(){for(const button of document.querySelectorAll('.cm-guess-open')){if(seen.has(button))continue;seen.add(button);button.click()}}
const observer=new MutationObserver(openOriginalGuess);observer.observe(document.querySelector('#main')||document.body,{childList:true,subtree:true});openOriginalGuess();
window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
const banner=document.createElement('aside');banner.className='standalone-notice';
const label=document.createElement('span');label.textContent='独立副本 · 原猜词逻辑 · 外部 AI / 支付尚未接入';
fetch('/__standalone/status').then(r=>r.json()).then(s=>{if(s.external==='fish-only')label.textContent='独立副本 · Fish 积分接口已启用 · AI 尚未接入'}).catch(()=>{});
const login=document.createElement('a');login.href='/auth/dev?next=%2Fchat%2F1';login.textContent='本地测试登录';banner.append(label,login);document.body.prepend(banner);
