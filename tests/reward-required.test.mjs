import test from 'node:test';
import assert from 'node:assert/strict';
import {requireTool} from '../scripts/toolchain.mjs';
const {code}=await requireTool('esbuild').build({entryPoints:['standalone/reward-required.ts'],bundle:true,write:false,format:'esm',platform:'browser'}).then(r=>({code:r.outputFiles[0].text}));
const {rewardRequired}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const req=(path,body,method='POST')=>new Request('https://play.jinhuan.example'+path,{method,headers:{'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
test('无奖励直接创建、自动出词和队列旧入口被拒绝',async()=>{
 for(const [path,body] of [['/api/chat/groups/1/redpacks',{provider:'free_guess',mode:'guess'}],['/api/chat/groups/1/ldc/auto-word',{reward_type:'none'}],['/api/chat/groups/1/guess-queue',{action:'queue',config:{provider:'free_guess',mode:'guess'}}],['/api/chat/groups/1/guess-queue',{action:'draft',config:{provider:'ldc',reward_type:'none'}}]]){
  const result=await rewardRequired(req(path,body));assert.equal(result.status,400);assert.match((await result.json()).error,/D币或 LDC/);
 }
});
test('奖励局完整保留请求体，历史读取和取消不受影响',async()=>{
 const body={provider:'ldc',payment_provider:'coin52',mode:'guess',amount:'100',answers:'测试'};const r=req('/api/chat/groups/1/redpacks',body);
 assert.equal(await rewardRequired(r),null);assert.deepEqual(await r.json(),body);
 assert.equal(await rewardRequired(req('/api/chat/groups/1/guess-queue/old',null,'DELETE')),null);
 assert.equal(await rewardRequired(req('/api/chat/groups/1/guess-room',null,'GET')),null);
 assert.equal(await rewardRequired(req('/api/game-rooms',{mode:'arena'})),null);
 for(const mode of ['fixed','random'])assert.equal(await rewardRequired(req('/api/chat/groups/1/redpacks',{...body,mode,reward_type:'none'})),null);
});
test('畸形或过大的新建请求明确拒绝',async()=>{
 assert.equal((await rewardRequired(new Request('https://play.jinhuan.example/api/chat/groups/1/redpacks',{method:'POST',body:'{'}))).status,400);
 assert.equal((await rewardRequired(req('/api/chat/groups/1/redpacks',{answers:'字'.repeat(12000)}))).status,413);
});
