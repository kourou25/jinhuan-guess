import test from 'node:test';
import assert from 'node:assert/strict';
import {revealLayout} from '../app/public/guess-layout.js';
test('1至40字在桌面和手机均衡换行，保持顺序且不孤字',()=>{
 for(const limit of [5,8])for(let length=1;length<=40;length++){
  const {columns,positions}=revealLayout(length,limit),sizes=[];
  assert.equal(positions.length,length);assert.ok(columns<=limit);
  positions.forEach(({row,column})=>{sizes[row-1]=(sizes[row-1]||0)+1;assert.equal(column,sizes[row-1])});
  assert.equal(sizes.length,Math.ceil(length/limit));assert.ok(Math.max(...sizes)-Math.min(...sizes)<=1);
  if(length>1)assert.ok(sizes.every(n=>n>1));
 }
 assert.deepEqual(revealLayout(15,8).positions.map(p=>p.row),[1,1,1,1,1,1,1,1,2,2,2,2,2,2,2]);
});
