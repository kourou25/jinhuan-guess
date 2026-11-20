import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {requireTool} from '../scripts/toolchain.mjs';
const source=new URL('../app/src/games/guess-luckybag.ts',import.meta.url);
test('LB01 random plan preserves amount and round bounds',async()=>{
 assert.ok(existsSync(source),'缺少福袋实现模块');
 mkdirSync('.build',{recursive:true});
 await requireTool('esbuild').build({entryPoints:[source.pathname.replace(/^\/(\w:)/,'$1')],outfile:'.build/luckybag-test.mjs',bundle:true,platform:'node',format:'esm',logLevel:'silent'});
 const {planLuckybag}=await import('../.build/luckybag-test.mjs');
 assert.equal(planLuckybag({probability_bps:0,min_total:100,max_total:1000},1000,2800),null);
 for(let i=0;i<1000;i++){
  const p=planLuckybag({probability_bps:10000,min_total:100,max_total:1000},1000,2800);
  assert.ok(p.total>=100&&p.total<=1000&&Number.isInteger(p.total));
  assert.ok(p.due_at>1000&&p.due_at<2800);
 }
 assert.throws(()=>planLuckybag({probability_bps:10001,min_total:0,max_total:1001},1000,2800));
});
