import {rewardRequired} from './reward-required';
import {settlePredictions} from '../app/src/ldc/predictions';
import {configureOutbound} from './outbound';
import original from '../app/src/worker';
import type {Env} from '../app/src/env';
import {incomingCookies,outgoingCookie} from './cookies';
import {runGuessEscalation} from '../app/src/ldc/escalation';
import {settlePendingEscalationAwards,settleCompensationAwards,settlePacketDraws} from '../app/src/routes/native-ldc';
import {settleCloseVotes} from '../app/src/ldc/cancel';
import {expireGuessGames} from '../app/src/ldc/expiry';
import {runGuessQueue} from '../app/src/ldc/queue';
import {settlePacketLuck} from '../app/src/ldc/luck';
import {settleDailyRanks} from '../app/src/services/rank-settlement';
import {settleCoinPools} from '../app/src/ldc/coin-funding';
import {runAnswerExplanations} from '../app/src/ldc/answer-explanation';
import {runGuessReviews} from '../app/src/ldc/review';
type IsolatedEnv=Env&{STANDALONE_LOCAL?:string};
export default {
 async fetch(request:Request,env:IsolatedEnv,ctx:ExecutionContext){
  const fishEnabled=configureOutbound(env);
  const url=new URL(request.url);
  if(url.pathname==='/')return Response.redirect(new URL('/chat/1',url).href,302);
  if(url.pathname==='/__standalone/status')return Response.json({version:'0.5.0',engine:'original-source-copy',local:env.STANDALONE_LOCAL==='1',external:fishEnabled?'fish-only':'disabled'});
  // Do not expose fixture/dev auth on an accidentally deployed host.
  if(url.pathname==='/auth/dev'&&(env.STANDALONE_LOCAL!=='1'||!['localhost','127.0.0.1'].includes(url.hostname)))return new Response('Not found',{status:404});
  const headers=new Headers(request.headers);headers.set('cookie',incomingCookies(headers.get('cookie')||'',url));
  if(!['GET','HEAD','OPTIONS'].includes(request.method)&&headers.get('origin')!==url.origin)return Response.json({error:'非法来源'},{status:403});
 const denied=await rewardRequired(request);if(denied)return denied;
  let response:Response;
  const backend=/^\/(api\/|auth\/|img\/|ext$|m\/|s\/)/.test(url.pathname);
  if(backend)response=await original.fetch(new Request(request,{headers}),env,ctx);
  else {const asset=url.pathname.includes('.');const admin=/^\/(login|register|reset|welcome|admin(?:\/|$)|me\/(?:account|invites)|i\/)/.test(url.pathname);response=await env.ASSETS.fetch(new Request(new URL(asset?url.pathname:admin?'/app.html':'/index.html',url),request));}
  const out=new Headers(response.headers);out.delete('set-cookie');for(const c of response.headers.getSetCookie())out.append('set-cookie',outgoingCookie(c,url));
  out.set('x-guess-instance','standalone');out.set('referrer-policy','same-origin');out.set('x-content-type-options','nosniff');
  if(out.get('content-type')?.includes('text/html'))out.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; font-src 'self' data:; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  return new Response(response.body,{status:response.status,headers:out});
 },
 async scheduled(event:ScheduledController,env:Env){
  configureOutbound(env);
  // Same original jobs, on the independent database only. No main-site farm/image jobs.
  const t=Math.floor(event.scheduledTime/1000);
  if(event.cron==='* * * * *'){
   for(const job of [()=>runGuessEscalation(env),()=>settlePendingEscalationAwards(env),()=>settleCloseVotes(env),()=>settleCompensationAwards(env),()=>expireGuessGames(env,t),()=>runGuessQueue(env),()=>settlePacketDraws(env,t),()=>settlePacketLuck(env.DB,t),()=>settleDailyRanks(env.DB,t),()=>settleCoinPools(env.DB,t),()=>runAnswerExplanations(env,t),()=>runGuessReviews(env),()=>settlePredictions(env)])await job().catch(()=>console.error('standalone_guess_job_failed'));
  }
 }
};
