import {sessionSlot} from './session-slot';
import {DurableObject} from 'cloudflare:workers';
import {drawingCreate,drawingAction,drawingTick,drawingView,drawingStrokeAllowed,DRAW_COLORS,type DrawingRoom,type Player} from '../app/src/games/drawing-engine';
import {arenaCreate,arenaTick,arenaJoin,arenaAction,arenaNext,arenaView,arenaRecord,type ArenaRoom,type Capability,type ArenaEntry} from '../app/src/games/arena-engine';
export type GameEnv={MAIN:Fetcher;GAME_SERVICE_SECRET:string;GAME_ROOMS:DurableObjectNamespace};
type Room={mode:'drawing';game:DrawingRoom}|{mode:'arena';game:ArenaRoom};
type Presence={kind?:string;key:string;at:number;player?:Player;rosterAt?:number;rosterCount?:number};
const presenceProfile=(p:Presence)=>!!p.player&&p.key==='u:'+p.player.id&&typeof p.player.name==='string'&&!!p.player.name.trim();
export class GameRoom extends DurableObject<GameEnv>{
 room:Room|null=null;handled:string[]=[];running=false;lastOnline=Date.now();
 async retireGames(){await this.ctx.storage.deleteAlarm();for(const ws of this.ctx.getWebSockets()){try{if(ws.deserializeAttachment()?.kind!=='presence')ws.close(1000,'玩法已下线')}catch{}}}
 constructor(ctx:DurableObjectState,env:GameEnv){super(ctx,env);ctx.blockConcurrencyWhile(async()=>{this.room=await ctx.storage.get<Room>('room')??null;this.handled=await ctx.storage.get<string[]>('handled')??[];this.lastOnline=await ctx.storage.get<number>('lastOnline')??Date.now();if(this.room)await this.retireGames()})}
 async save(){await this.retireGames()}
 view(uid:number,canvas=true){if(!this.room)return null;return this.room.mode==='drawing'?drawingView(this.room.game,uid,canvas):arenaView(this.room.game,uid)}
 broadcast(canvas=false){for(const ws of this.ctx.getWebSockets()){try{const {uid}=ws.deserializeAttachment() as {uid:number};ws.send(JSON.stringify({type:'state',room:this.view(uid,canvas),now:Date.now()}))}catch{try{ws.close(1011,'连接已结束')}catch{}}}}
 async runtime(path:string,body:unknown,cookie=''){const r=await this.env.MAIN.fetch(new Request('https://play.jinhuan.example/api/game-runtime/'+path,{method:'POST',headers:{'content-type':'application/json','x-game-service':this.env.GAME_SERVICE_SECRET,cookie,origin:'https://play.jinhuan.example'},body:JSON.stringify(body)}));const data=await r.json<any>();if(!r.ok)throw Error(data.error||'游戏服务暂不可用');return data}
 async fetch(req:Request){
  if(new URL(req.url).pathname!=='/presence'){await this.retireGames();return Response.json({code:'game_retired',error:'AI对抗和卧底画家已下线，请参与普通猜词。'},{status:410,headers:{'cache-control':'no-store'}})}
  try{const url=new URL(req.url),player=JSON.parse(decodeURIComponent(req.headers.get('x-game-player')||'null')) as Player|null;if(!player)throw Error('请先登录');this.lastOnline=Date.now();
   if(url.pathname==='/slot')return sessionSlot(this.ctx,this.env,req);
   if(url.pathname==='/presence'){
    if(this.ctx.getWebSockets().length>=4096)throw Error('在线连接已满');const key=req.headers.get('x-presence-key');if(!key||key.length>100)throw Error('连接标识无效');const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);pair[1].serializeAttachment({kind:'presence',key,at:Date.now(),player:key==='u:'+player.id?{id:player.id,name:player.name,avatar:player.avatar}:null});this.presenceBroadcast();await this.ctx.storage.setAlarm(Date.now()+30000);return new Response(null,{status:101,webSocket:pair[0]});
   }
   if(url.pathname==='/init'){
    if(this.room)throw Error('房间已存在');const b=await req.json<any>();this.room=b.mode==='drawing'?{mode:'drawing',game:drawingCreate({...b,host:player},Date.now())}:{mode:'arena',game:arenaCreate({...b,host:player},Date.now())};await this.save();return Response.json({room:this.view(player.id)})
   }
   if(!this.room)return Response.json({error:'房间不存在'},{status:404});
   await this.settleLobby();
   if(url.pathname==='/socket'){
    if(req.headers.get('upgrade')?.toLowerCase()!=='websocket')throw Error('需要实时连接');const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);pair[1].serializeAttachment({uid:player.id,window:Date.now(),count:0});pair[1].send(JSON.stringify({type:'state',room:this.view(player.id),now:Date.now()}));return new Response(null,{status:101,webSocket:pair[0]})
   }
   if(req.method==='GET')return Response.json({room:url.searchParams.get('summary')==='1'?{id:this.room.game.id,mode:this.room.mode,phase:this.room.game.phase}:this.view(player.id),now:Date.now()});
   const b=await req.json<any>();await this.action(player,b,req.headers.get('cookie')||'');return Response.json({room:this.view(player.id),now:Date.now()});
  }catch(e){return Response.json({error:e instanceof Error?e.message:'操作失败'},{status:400})}
 }
 async settleLobby(){if(this.room?.game.phase!=='lobby')return;const revision=this.room.game.revision;if(this.room.mode==='drawing')drawingTick(this.room.game,Date.now());else arenaTick(this.room.game,Date.now());if(revision!==this.room.game.revision){await this.save();this.broadcast()}}
 async action(player:Player,b:any,cookie=''){
  await this.settleLobby();
  if(!this.room||typeof b.type!=='string'||typeof b.nonce!=='string'||!/^[-a-f0-9]{36}$/i.test(b.nonce))throw Error('操作标识无效');const key=player.id+':'+b.nonce;if(this.handled.includes(key))return;
  if(this.room.mode==='drawing')drawingAction(this.room.game,player.id,b.type,{...b,player},Date.now());
  else if(b.type==='join')arenaJoin(this.room.game,player,b.consent);else arenaAction(this.room.game,player.id,b.type,Date.now());
  this.handled.push(key);this.handled=this.handled.slice(-128);await this.save();this.broadcast(b.type==='undo');
  if(b.type==='stroke'&&this.room.mode==='drawing'){const stroke=this.room.game.strokes.at(-1);for(const ws of this.ctx.getWebSockets())try{ws.send(JSON.stringify({type:'stroke',stroke}))}catch{}}
  if(b.type==='stop'&&this.room.mode==='arena'){const p=this.room.game.players.find(p=>p.id===player.id);if(p)this.ctx.waitUntil(this.runtime('revoke',{id:p.consent.id},cookie).catch(()=>{}))}
 }
 async webSocketMessage(ws:WebSocket,message:string|ArrayBuffer){
  const presence=ws.deserializeAttachment() as Presence;if(presence.kind==='presence'){
   if(this.reconnectPresence(ws,presence))return;
   if(message==='ping'){if(Date.now()-presence.at<10000)return;presence.at=Date.now();ws.serializeAttachment(presence);ws.send(JSON.stringify({type:'online',count:this.presenceCount()}));return}
   try{if(typeof message!=='string'||message.length>200)throw Error();const d=JSON.parse(message);if(d.type!=='roster'||!Number.isSafeInteger(d.offset)||d.offset<0||d.offset>4096||!Number.isSafeInteger(d.request))throw Error();
    const t=Date.now();if(t-(presence.rosterAt||0)>1000){presence.rosterAt=t;presence.rosterCount=0}if((presence.rosterCount=(presence.rosterCount||0)+1)>10)throw Error();ws.serializeAttachment(presence);
    ws.send(JSON.stringify({type:'roster',request:d.request,...this.presenceRoster(d.offset)}));return
   }catch{ws.close(1008,'无效名单请求');return}
  }
  await this.retireGames();
 }
 presenceCount(){return new Set(this.ctx.getWebSockets().map(ws=>ws.deserializeAttachment() as {kind?:string;key:string;at:number}).filter(p=>p.kind==='presence'&&Date.now()-p.at<75000).map(p=>p.key)).size}
 reconnectPresence(ws:WebSocket,p:Presence){if(p.kind==='presence'&&p.key.startsWith('u:')&&!presenceProfile(p)){try{ws.close(1012,'重新同步公开资料')}catch{}return true}return false}
 presenceRoster(offset:number){
  const active=new Map<string,Presence>();for(const ws of this.ctx.getWebSockets()){const p=ws.deserializeAttachment() as Presence;if(p.kind!=='presence'||Date.now()-p.at>=75000)continue;this.reconnectPresence(ws,p);const old=active.get(p.key);if(!old||(presenceProfile(p)&&!presenceProfile(old))||(presenceProfile(p)===presenceProfile(old)&&old.at<p.at))active.set(p.key,p)}
  const players:Array<{id:number;name:string;avatar:string|null}>=[];let guests=0,pending=0;
  for(const[key,p]of active){if(key.startsWith('v:')){guests++;continue}const id=Number(key.slice(2));if(!Number.isSafeInteger(id)||id<=0)continue;const known=presenceProfile(p);if(!known)pending++;players.push({id,name:known?p.player!.name.slice(0,100):'正在同步昵称…',avatar:known&&typeof p.player?.avatar==='string'?p.player.avatar:null})}
  players.sort((a,b)=>a.id-b.id);return {items:players.slice(offset,offset+100),guests,total:active.size,pending,next:players.length>offset+100?offset+100:null}
 }
 presenceBroadcast(){const data=JSON.stringify({type:'online',count:this.presenceCount()});for(const ws of this.ctx.getWebSockets())try{ws.send(data)}catch{}}
 async webSocketClose(ws:WebSocket,code:number){const p=ws.deserializeAttachment() as {kind?:string;at:number};if(p?.kind==='presence'){p.at=0;ws.serializeAttachment(p)}try{ws.close(code,'')}catch{}if(p?.kind==='presence')this.presenceBroadcast()}
 async alarm(){
  if(this.running){await this.ctx.storage.setAlarm(Date.now()+2000);return}this.running=true;
  try{await this.runAlarm()}finally{this.running=false}
 }
 async runAlarm(){
  if(this.room){await this.retireGames();return}
  if(!this.room){for(const ws of this.ctx.getWebSockets()){const p=ws.deserializeAttachment() as Presence;if(p.kind==='presence'&&Date.now()-p.at>=75000){try{ws.close(1001,'心跳已过期')}catch{}}else this.reconnectPresence(ws,p)}this.presenceBroadcast();if(this.ctx.getWebSockets().length)await this.ctx.storage.setAlarm(Date.now()+30000);else await this.ctx.storage.deleteAlarm();return}
 }
}
