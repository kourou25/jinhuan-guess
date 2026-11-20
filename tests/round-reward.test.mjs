import test from 'node:test';
import assert from 'node:assert/strict';
import {winnerWeights,splitWinners} from '../app/src/ldc/multiwinner.ts';
test('RI01 confirmed distribution by configured winner slots',()=>{
 for(const [n,w] of [[1,[10000]],[2,[7000,3000]],[3,[6000,2500,1500]],[4,[5000,2500,1500,1000]],[5,[4000,2400,1800,1200,600]]])assert.deepEqual(winnerWeights(n),w);
 for(let n=5;n<=10;n++){const w=winnerWeights(n);assert.equal(w[0],4000);assert.equal(w.reduce((a,b)=>a+b),10000);assert.ok(w.every((x,i)=>x>0&&(!i||x<=w[i-1])))}
});
test('RI01 D coin integers and LDC cents preserve whole pool',()=>{
 for(const unit of [1,100])for(let n=1;n<=10;n++)for(const total of [100,101,333,1001]){const v=splitWinners(total*unit,n,unit);assert.equal(v.length,n);assert.equal(v.reduce((a,b)=>a+b),total*unit);assert.ok(v.every(x=>x>=unit&&x%unit===0))}
 assert.deepEqual(splitWinners(10100,3,100),[6100,2500,1500]);
 assert.throws(()=>splitWinners(200,3,100),/奖池不足/);
 for(const n of [0,11,2.5])assert.throws(()=>winnerWeights(n));
});
