import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {requireTool} from '../scripts/toolchain.mjs';
mkdirSync('.build/game-tests',{recursive:true});
await requireTool('esbuild').build({entryPoints:['standalone/game-room.ts'],outfile:'.build/game-tests/presence.mjs',bundle:true,format:'esm',platform:'node',plugins:[{name:'durable-test-boundary',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'durable',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}'}))}}]});
const {GameRoom}=await import('../.build/game-tests/presence.mjs');
function socket(data){return {data:structuredClone(data),closed:[],sent:[],deserializeAttachment(){return structuredClone(this.data)},serializeAttachment(v){this.data=structuredClone(v)},send(v){this.sent.push(JSON.parse(v))},close(...v){this.closed.push(v)}}}
async function fixture(...sockets){let ready;const ctx={blockConcurrencyWhile(fn){ready=fn()},getWebSockets:()=>sockets,storage:{get:async()=>null,setAlarm:async()=>{},deleteAlarm:async()=>{}}};const room=new GameRoom(ctx,{});await ready;return room}
const presence=(key,player)=>({kind:'presence',key,at:Date.now()-20000,...(player?{player}:{})});
test('旧在线连接的心跳触发重新认证，不能一直显示默认玩家',async()=>{const old=socket(presence('u:8'));const r=await fixture(old);await r.webSocketMessage(old,'ping');assert.equal(old.closed[0]?.[0],1012)});
test('部署后的定时清理也促使旧连接重新认证',async()=>{const old=socket(presence('u:8'));const r=await fixture(old);await r.runAlarm();assert.equal(old.closed[0]?.[0],1012)});
test('正常公开资料和匿名访客不重连，不接受客户端伪造资料',async()=>{for(const p of [presence('u:8',{id:8,name:'林间',avatar:'/a.png'}),presence('v:browser')]){const ws=socket(p),r=await fixture(ws);await r.webSocketMessage(ws,'ping');assert.equal(ws.closed.length,0);assert.equal(ws.sent.at(-1).type,'online');assert.equal(ws.data.player?.name,p.player?.name)}});
test('同账号旧标签页心跳较新时仍显示已认证的完整资料',async()=>{const good=socket(presence('u:8',{id:8,name:'林间',avatar:'/a.png'})),old=socket({...presence('u:8'),at:Date.now()}),r=await fixture(good,old);assert.deepEqual(r.presenceRoster(0).items,[{id:8,name:'林间',avatar:'/a.png'}]);assert.equal(r.presenceRoster(0).total,1)});
test('资料与连接身份不符时要求重新认证',async()=>{const ws=socket(presence('u:8',{id:9,name:'不应展示',avatar:null})),r=await fixture(ws);await r.webSocketMessage(ws,'ping');assert.equal(ws.closed[0]?.[0],1012)});
