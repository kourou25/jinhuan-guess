import test from 'node:test';
import assert from 'node:assert/strict';
import {requireTool} from '../scripts/toolchain.mjs';
test('Fish出口默认关闭，显式开启后仍拒绝其他主机、路径与重定向',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(...args)=>{calls.push(args);return new Response('{}')};
 try{
  const source=requireTool('esbuild').buildSync({entryPoints:['standalone/outbound.ts'],bundle:true,write:false,format:'esm'}).outputFiles[0].text;
  const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  await assert.rejects(fetch('https://hb.lafi.sh/api/open/balance'));
  assert.equal(typeof module.configureOutbound,'function');
  module.configureOutbound({GUESS_FISH_ENABLED:'1',GUESS_FISH_CUSTODIAN_ID:'1',ADMIN_USER_IDS:'1'});
  await fetch('https://hb.lafi.sh/api/open/balance');assert.equal(calls.length,1);assert.equal(calls[0][1].redirect,'manual');
  for(const url of ['https://evil.test/api/open/balance','http://hb.lafi.sh/api/open/balance','https://hb.lafi.sh/other','https://hb.lafi.sh:8443/api/open/balance'])await assert.rejects(fetch(url));
  module.configureOutbound({});await assert.rejects(fetch('https://hb.lafi.sh/api/open/balance'));assert.equal(calls.length,1);
 }finally{globalThis.fetch=original}
});
