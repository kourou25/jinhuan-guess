// One coordinator per game mode in the existing GameRoom namespace.
type Slot={ids:string[];pending?:{id:string;token:string;until:number}};
export async function sessionSlot(ctx:DurableObjectState,env:{GAME_ROOMS:DurableObjectNamespace;MAIN:Fetcher;GAME_SERVICE_SECRET:string},req:Request){
 return ctx.blockConcurrencyWhile(async()=>{try{
  const b=await req.json<any>();if(!['drawing','arena'].includes(b.mode))throw Error('请选择玩法');
  let slot=await ctx.storage.get<Slot>('session-slot');
  const before=slot?JSON.stringify(slot):null;
  const save=async()=>{if(JSON.stringify(slot)!==before)await ctx.storage.put('session-slot',slot)};
  const headers=new Headers({'x-game-player':req.headers.get('x-game-player')||''});
  const view=async(id:string)=>{const r=await env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(id)).fetch(new Request('https://room/view?summary=1',{headers}));if(r.status===404)return null;if(!r.ok)throw Error('当前对局状态暂不可用，请稍后重试');return (await r.json<any>()).room};
  if(!slot){
   const r=await env.MAIN.fetch(new Request('https://play.jinhuan.example/api/game-runtime/rooms',{headers:{'x-game-service':env.GAME_SERVICE_SECRET,cookie:req.headers.get('cookie')||''}}));if(!r.ok)throw Error('读取既有对局失败');
   const data=await r.json<any>();slot={ids:data.items.filter((r:any)=>r.mode===b.mode).map((r:any)=>r.id)};
  }
  let current:any=null;const active:string[]=[];
  for(const id of slot.ids){const room=await view(id);if(room&&room.phase!=='finished'){active.push(id);current??=room}}
  slot.ids=active;
  if(slot.pending&&slot.pending.until<=Date.now()){
   const room=await view(slot.pending.id);if(room&&room.phase!=='finished'){slot.ids.push(room.id);current??=room}delete slot.pending;
  }
  if(b.type==='reserve'){
   if(current||slot.pending){await save();return Response.json({error:current?'本玩法已有一局，进入当前对局即可':'正在发起对局，请稍后进入',current_id:current?.id},{status:409})}
   slot.pending={id:crypto.randomUUID(),token:crypto.randomUUID(),until:Date.now()+90000};await ctx.storage.put('session-slot',slot);return Response.json(slot.pending);
  }
  if(b.type==='commit'){
   if(!slot.pending||slot.pending.id!==b.id||slot.pending.token!==b.token)throw Error('开局预留已失效，请重新发起');
   slot.ids.push(b.id);delete slot.pending;
  }else if(b.type==='release'&&slot.pending&&slot.pending.id===b.id&&slot.pending.token===b.token)delete slot.pending;
  await save();return Response.json({room:current,creating:!!slot.pending,now:Date.now()});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'候场服务暂不可用'},{status:400})}});
}
