import {gameSeconds} from '../app/src/games/drawing-engine';
import {rewardRequired} from './reward-required';
import {emojiInviteRedirect} from './emoji-invite';
async function gameBody(request:Request){if(Number(request.headers.get('content-length')||0)>10000)throw Error('操作内容过大');if(!request.body)throw Error('缺少操作内容');const reader=request.body.getReader();let size=0,text='';const decoder=new TextDecoder();try{while(true){const v=await reader.read();if(v.done)break;size+=v.value.byteLength;if(size>10000){await reader.cancel();throw Error('操作内容过大')}text+=decoder.decode(v.value,{stream:true})}return JSON.parse(text+decoder.decode())}finally{reader.releaseLock()}}
type Env={ASSETS:Fetcher;MAIN:Fetcher;GAME_SERVICE_SECRET?:string;GAME_ROOMS?:DurableObjectNamespace};
async function gameService(env:Env,path:string,request:Request,body?:unknown){const headers=new Headers({'x-game-service':env.GAME_SERVICE_SECRET||'',cookie:request.headers.get('cookie')||'',origin:new URL(request.url).origin});if(body!==undefined)headers.set('content-type','application/json');const r=await env.MAIN.fetch(new Request('https://play.jinhuan.example/api/game-runtime/'+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));const data=await r.json<any>();if(!r.ok)throw Error(data.error||'请先登录');return data}
async function games(request:Request,env:Env){
 try{if(!env.GAME_ROOMS||!env.GAME_SERVICE_SECRET)return Response.json({error:'新玩法尚未启用'},{status:503});const url=new URL(request.url),auth=await gameService(env,'auth',request),player=auth.user;
  const roomId=url.pathname.split('/')[3],headers=new Headers({'x-game-player':encodeURIComponent(JSON.stringify(player)),cookie:request.headers.get('cookie')||'','content-type':'application/json'});
  const slot=async(mode:string,body:any)=>{const r=await env.GAME_ROOMS!.get(env.GAME_ROOMS!.idFromName('current-session-v1:'+mode)).fetch(new Request('https://room/slot',{method:'POST',headers,body:JSON.stringify({...body,mode})}));const data=await r.json<any>();if(!r.ok)throw Error(data.error||'候场服务不可用');return data};
  if(!roomId){
   if(request.method==='GET'){const mode=url.searchParams.get('mode');if(mode&&['drawing','arena'].includes(mode))return Response.json(await slot(mode,{type:'current'}));const all=await Promise.all(['drawing','arena'].map(mode=>slot(mode,{type:'current'})));return Response.json({items:all.map(d=>d.room).filter(Boolean)})}
   if(request.method!=='POST')throw Error('请选择对局');const b=await gameBody(request);if(!['drawing','arena'].includes(b.mode))throw Error('请选择玩法');
   gameSeconds(b.wait_seconds,60);if(b.mode==='drawing')gameSeconds(b.draw_seconds,20);
   const reservation=await slot(b.mode,{type:'reserve'}),id=reservation.id,stub=env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(id));let initialized=false;
   try{
    await gameService(env,'room-record',request,{id,mode:b.mode});
    if(b.mode==='arena'){
     b.consent=await gameService(env,'consent',request,{room_id:id,role:'host',max_calls:300});
     if(b.answer_source==='ai'){const generation=await gameService(env,'consent',request,{room_id:id,role:'host',max_calls:1});const generated=await gameService(env,'execute',request,{id:generation.id,token:generation.token,operation:crypto.randomUUID(),task:'generate',context:{language:'中文'}});if(generated.state!=='done')throw Error(generated.result?.error||'AI出题失败');b.answer=generated.result.answer;b.hint=generated.result.hint}
    }else if(b.word_source!=='manual'){const words=await gameService(env,'words',request);b.words=words.words}
    const response=await stub.fetch(new Request('https://room/init',{method:'POST',headers,body:JSON.stringify({...b,id})}));
    if(!response.ok)throw Error((await response.json<any>()).error||'发起失败');initialized=true;
    await gameService(env,'room-record',request,{id,mode:b.mode,ready:true});await slot(b.mode,{type:'commit',...reservation});return response;
   }catch(e){if(initialized)await stub.fetch(new Request('https://room/action',{method:'POST',headers,body:JSON.stringify({type:'finish',nonce:crypto.randomUUID()})}));await slot(b.mode,{type:'release',...reservation});throw e}
  }
  if(!/^[-a-f0-9]{36}$/i.test(roomId))throw Error('房间编号无效');const stub=env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(roomId));
  if(url.pathname.endsWith('/socket')){if(request.headers.get('origin')!==url.origin)throw Error('连接来源无效');headers.set('upgrade','websocket');return stub.fetch(new Request('https://room/socket',{headers}))}
  if(request.method==='GET')return stub.fetch(new Request('https://room/view',{headers}));
  const b=await gameBody(request);if(JSON.stringify(b).length>10000)throw Error('操作过大');
  if(b.type==='join'){
   const current=await(await stub.fetch(new Request('https://room/view',{headers}))).json<any>();if(!current.room)throw Error('房间不存在');if(current.room.mode==='arena'){if(!current.room.can_join)throw Error('当前不能参与');b.consent=await gameService(env,'consent',request,{room_id:roomId,role:'player',max_calls:b.max_calls})}
  }
  delete b.player;return stub.fetch(new Request('https://room/action',{method:'POST',headers,body:JSON.stringify(b)}));
 }catch(e){return Response.json({error:e instanceof Error?e.message:'新玩法暂不可用'},{status:400})}
}
export default {async fetch(request:Request,env:Env){
 const invitation=emojiInviteRedirect(request);if(invitation)return invitation;
 const url=new URL(request.url),path=url.pathname;
 if(path.startsWith('/api/game-runtime/'))return new Response('Not found',{status:404});
 if(!['GET','HEAD','OPTIONS'].includes(request.method)&&request.headers.get('origin')!==url.origin)return Response.json({error:'非法来源'},{status:403});
 if(path==='/api/game-presence'){
  if(!env.GAME_ROOMS||request.headers.get('upgrade')?.toLowerCase()!=='websocket'||request.headers.get('origin')!==url.origin)return new Response('连接无效',{status:400});
  const browser=url.searchParams.get('browser')||'';if(!/^[-a-f0-9]{36}$/i.test(browser))return new Response('连接标识无效',{status:400});const r=await env.MAIN.fetch(new Request('https://play.jinhuan.example/api/me',{headers:{cookie:request.headers.get('cookie')||''}}));const me=await r.json<any>();const key=me.user?.id?'u:'+me.user.id:'v:'+browser;
  return env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName('web-presence-v1')).fetch(new Request('https://room/presence',{headers:{upgrade:'websocket','x-game-player':encodeURIComponent(JSON.stringify(me.user?{id:me.user.id,name:me.user.nick||me.user.name||me.user.username||'玩家',avatar:me.user.avatar||null}:{id:0,name:'访客',avatar:null})),'x-presence-key':key}}));
 }
 if(/^\/api\/game-rooms(?:\/|$)/.test(path))return Response.json({code:'game_retired',error:'AI对抗和卧底画家已下线，请参与普通猜词。'},{status:410,headers:{'cache-control':'no-store'}});
 if(/^\/games\/(?:arena|drawing)\/?$/.test(path)||(path==='/chat/1'&&['arena','drawing'].includes(url.searchParams.get('game')||'')))return Response.redirect(url.origin+'/chat/1',302);
 if(path==='/'||path==='/chat')return Response.redirect(url.origin+'/chat/1',302);
 if(path==='/__standalone/status')return Response.json({version:'0.7.0',engine:'shared-main',external:'main-services',chat:'isolated'});
 if(path==='/login'||path==='/auth/login')return Response.redirect(url.origin+'/auth/guess/start',302);
 if(path.startsWith('/auth/')&&!['/auth/guess/start','/auth/guess/callback','/auth/logout'].includes(path))return new Response('Not found',{status:404});
 if(/^\/api\/notifs(?:\/|$)/.test(path))return Response.json({items:[],unread:0});
 if(path==='/api/chat/groups')url.pathname='/api/guess-sidebar/groups';
 else if(/^\/api\/chat\/messages\/\d+$/.test(path)&&['PATCH','DELETE'].includes(request.method))url.pathname=path.replace('/api/chat/messages/','/api/guess-sidebar/messages/');
 else if(path.startsWith('/api/chat/')&&!/^\/api\/chat\/(?:groups\/1\/(?:guess-|sender-stats|packet-luck-stats|redpacks$|ldc\/)|messages\/\d+\/(?:guess-|prediction|redpack))/.test(path))return Response.json({error:'此页面仅提供猜词和独立聊天'},{status:404});
 else if(path.startsWith('/api/dm'))return Response.json({error:'此页面不提供私信'},{status:404});
 const denied=await rewardRequired(request);if(denied)return denied;
 let response:Response;
 if(/^\/(?:api\/|auth\/|img\/|ext$)/.test(path)){
  const headers=new Headers(request.headers);headers.delete('x-guess-internal');headers.delete('x-game-service');
  if(env.GAME_SERVICE_SECRET&&(path.startsWith('/api/chat/')||path.startsWith('/api/guess-sidebar/')))headers.set('x-game-service',env.GAME_SERVICE_SECRET);
  response=await env.MAIN.fetch(new Request(url, new Request(request,{headers})));
 }else if(['/chat/1','/me/ai','/games/arena','/games/drawing','/games/review'].includes(path)||path.includes('.'))response=await env.ASSETS.fetch(new Request(new URL(['/chat/1','/me/ai','/games/arena','/games/drawing','/games/review'].includes(path)?'/index.html':path,url),request));
 else return Response.redirect('https://jinhuan.example'+path+url.search,302);
 const headers=new Headers(response.headers);headers.set('x-guess-instance','shared');headers.set('referrer-policy','same-origin');headers.set('x-content-type-options','nosniff');
 if(path.startsWith('/auth/guess'))headers.set('referrer-policy','no-referrer');
 if(headers.get('content-type')?.includes('text/html'))headers.set('content-security-policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self' wss://play.jinhuan.example; media-src 'self' blob:; font-src 'self' data:; frame-src 'self'; frame-ancestors https://hb.lafi.sh https://staging.hb.lafi.sh; base-uri 'self'; form-action 'self'");
 return new Response(response.body,{status:response.status,headers});
}};
