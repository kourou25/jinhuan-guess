import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {requireTool} from '../scripts/toolchain.mjs';
import {seal,unseal,extraHints,money} from '../app/src/ldc/core.ts';

// Run the actual view functions; only unrelated database reads are isolated.
const esbuild=requireTool('esbuild'),key=Buffer.alloc(32,7).toString('base64'),time=100000;
const hints=['第一条线索','第二条线索','第三条线索'];
const box=await seal(key,'ldc-hints:test-round',JSON.stringify(hints));
const live=process.env.ENDED_HINTS_MODULE&&readFileSync(process.env.ENDED_HINTS_MODULE,'utf8');
async function code(file,name){
 const source=live||readFileSync(new URL('../app/src/ldc/'+file,import.meta.url),'utf8');
 const part=source.match(new RegExp('(?:export )?async function '+name+'\\([^]*?\\n\\}'))?.[0];
 assert.ok(part,'view exists: '+name);
 return (await esbuild.transform(part.replace(/^export /,''),{loader:'ts'})).code;
}
const policy={hint_source:'preset',preset_hint_trigger:'guesses',hint_cooldown_seconds:30,auto_hint_increment:0};
const context=vm.createContext({unseal,extraHints,money,now:()=>time,ready:()=>key,ready$2:()=>key,publicHintPolicy:p=>({...policy,hint_source:p.hint_source}),freeOwnerParticipates:()=>false,packetDrawView:async()=>null,fishErrorText:()=>null,fail:(_,s)=>{throw Error(s)}});
vm.runInContext(await code('free-game.ts','freeView')+'\n'+await code('packets.ts','nativeView'),context);
const p0={packet_id:'test-round',reward_type:'ldc',payment_provider:'coin52',mode:'guess',response_mode:'similarity',owner_id:1,group_id:1,state:'open',count:3,ends_at:time+600,created_at:time-10,game_version:1,hints_box:box,hints_json:JSON.stringify(hints),hints_revealed:1,extra_hints_json:JSON.stringify([{text:'发起人补充',source:'owner'}]),total_cents:10000,guess_weights_json:'[6000,2500,1500]',hidden_winners:1,...policy,auto_hint_every:10,guess_count:2,question_count:1};
async function view(p={},winners=0){
 const db={prepare(sql){return {bind(){return this},async first(){return {name:'获奖者'}},async all(){return {results:sql.includes('FROM ldc_awards')?Array.from({length:winners},(_,i)=>({recipient_id:i+2,name:'获奖者',amount_cents:100,state:'sent'})):[]}}}}};
 return JSON.parse(JSON.stringify(await context.nativeView({env:{DB:db}},p0.packet_id,99,{...p0,...p})));
}
for(const provider of ['coin52','fish']){
 for(const [label,change,winners] of [['正常结束',{state:'closed'},1],['到期',{ends_at:time},0],['名额满但数据库尚未关闭',{},3],['取消',{state:'closed',close_kind:'cancel'},0],['投票流局',{state:'closed',close_kind:'vote'},0],['强制流局',{state:'closed',close_kind:'force'},0],['旧版按时间揭示',{state:'closed',mode:'clues',game_version:0,hints_box:null},0]]){
  test(`EH ${provider} ${label} 公布全部预设并保留追加线索`,async()=>{const r=await view({payment_provider:provider,...change},winners);assert.equal(r.state,'closed');assert.deepEqual(r.hints,[...hints,'发起人补充']);assert.equal(r.preset_hints_remaining,0)});
 }
}
for(const winners of [0,1,2])test(`EH 进行中已有 ${winners} 名获奖者不得提前公开`,async()=>{const r=await view({},winners);assert.equal(r.state,'open');assert.deepEqual(r.hints,[hints[0],'发起人补充']);assert.equal(r.preset_hints_remaining,2)});
for(const change of [{state:'closed'},{ends_at:time},{winner_id:2}])test('EH 历史无奖励局结束公布所有线索 '+JSON.stringify(change),async()=>{const r=await view({reward_type:'none',...change});assert.equal(r.state,'closed');assert.deepEqual(r.hints,[...hints,'发起人补充']);assert.equal(r.preset_hints_remaining,0)});
test('EH 历史无奖励局进行中保持阶段揭示',async()=>{const r=await view({reward_type:'none'});assert.equal(r.state,'open');assert.equal(r.hints.length,2)});
test('EH 已公开完毕及空预设线索保持正确',async()=>{
 const full=await view({state:'closed',hints_revealed:3});assert.deepEqual(full.hints,[...hints,'发起人补充']);assert.equal(full.preset_hints_remaining,0);
 const empty=await view({state:'closed',hints_box:await seal(key,'ldc-hints:test-round','[]'),hints_revealed:0});assert.deepEqual(empty.hints,['发起人补充']);assert.equal(empty.preset_hints_remaining,0);
});
test('EH 房间结束后不再返回下一条线索门槛',()=>{
 const source=live||readFileSync(new URL('../app/src/ldc/room.ts',import.meta.url),'utf8');
 const line=source.split('\n').find(l=>l.includes('next_hint_guess:'));
 const expression=line.slice(line.indexOf('next_hint_guess:')+16).trim().replace(/\}$/,'');
 for(const state of ['open','closed'])for(const source of ['preset','ai','legacy']){
  const value=vm.runInNewContext(expression,{state:{state,preset_hint_total:3},p:{...p0,hint_source:source},nextStageHintAt:()=>20});
  assert.equal(value,state==='closed'?null:20);
 }
});
