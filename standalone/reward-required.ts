// Only new ordinary rounds are gated; historical rounds and payouts stay readable.
export async function rewardRequired(request:Request):Promise<Response|null>{
 const path=new URL(request.url).pathname;
 if(request.method!=='POST'||!/^\/api\/chat\/groups\/\d+\/(?:redpacks|ldc\/auto-word|guess-queue)$/.test(path))return null;
 const reader=request.clone().body?.getReader();if(!reader)return Response.json({error:'缺少发起配置'},{status:400});
 let size=0,text='';const decoder=new TextDecoder();
 try{
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>32768){void reader.cancel();return Response.json({error:'发起配置过大'},{status:413})}text+=decoder.decode(part.value,{stream:true})}
  const body=JSON.parse(text+decoder.decode()),config=path.endsWith('/guess-queue')?body?.config:body;
  const guessing=!path.endsWith('/redpacks')||['guess','clues'].includes(config?.mode);
  if(config?.provider==='free_guess'||config?.game==='free_guess'||guessing&&config?.reward_type==='none')return Response.json({error:'无奖励模式已取消，请选择 D币或 LDC 奖励局并填写奖励金额',code:'REWARD_REQUIRED'},{status:400});
  return null;
 }catch{return Response.json({error:'发起配置格式无效'},{status:400})}finally{reader.releaseLock()}
}
