import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {requireTool} from '../scripts/toolchain.mjs';
const renderer=readFileSync('app/public/winner-chat.js','utf8').replace("'/fish-recipient.js'",JSON.stringify(new URL('../app/public/fish-recipient.js',import.meta.url).href));
const {winnerChatText}=await import('data:text/javascript;base64,'+Buffer.from(renderer).toString('base64'));
const compiled=await requireTool('esbuild').build({entryPoints:['standalone/winner-chat-data.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const {winnerChatData}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const schema=readFileSync('tests/fixtures/winner-chat-schema.sql','utf8');
function fixture({provider='coin52',mode='guess',group=1,escalation=0}={}){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=OFF; CREATE TABLE chat_redpacks(id TEXT PRIMARY KEY,message_id INTEGER); INSERT INTO chat_redpacks VALUES(\'p\',42); CREATE TABLE guess_reward_increases(packet_id TEXT,stage INTEGER,added_cents INTEGER,total_cents INTEGER,created_at INTEGER);');
 for(const table of ['ldc_packets','ldc_awards','guess_sidebar_messages'])db.exec(schema.match(new RegExp('CREATE TABLE '+table+'\\s*\\([\\s\\S]*?\\n?\\);'))[0].replace(/,\s*system_kind TEXT,\s*system_ref TEXT,\s*system_data TEXT/,''));
 db.exec(readFileSync('standalone/winner-chat.sql','utf8'));
 db.exec(schema.slice(schema.indexOf('CREATE TRIGGER trg_guess_escalation ')));
 db.prepare('INSERT INTO ldc_packets(packet_id,owner_id,client_id,mode,count,ends_at,created_at,group_id,total_cents,base_total_cents,payment_provider,escalation_every,escalation_step_cents,guess_weights_json) VALUES(\'p\',1,\'mock\',?,3,unixepoch()+1800,unixepoch(),?,10000,10000,?,?,1000,\'[6000,2500,1500]\')').run(mode,group,provider,escalation);
 for(const [slot,amount]of [6000,2500,1500].entries())db.prepare('INSERT INTO ldc_awards(id,packet_id,slot,amount_cents,order_no) VALUES(?,\'p\',?,?,?)').run('a'+slot,slot,amount,'o'+slot);
 const claim=(slot,uid)=>db.prepare("UPDATE ldc_awards SET recipient_id=?,state='reserved' WHERE id=? AND recipient_id IS NULL").run(uid,'a'+slot);
 const rows=()=>db.prepare('SELECT * FROM guess_sidebar_messages ORDER BY id').all().map(row=>({...row,data:winnerChatData(row)}));
 return {db,claim,rows};
}
test('逐人系统事件、名额和整数D币总额守恒；未支付不能写已到账',()=>{
 const {db,claim,rows}=fixture();try{
  claim(0,2);let r=rows();assert.equal(r.length,1);assert.deepEqual([r[0].data.amount_cents,r[0].data.remaining_slots,r[0].data.remaining_cents],[6000,2,4000]);assert.equal(winnerChatText(r[0].data).status,'发放处理中');
  claim(1,3);claim(2,4);r=rows();assert.equal(r.length,3);assert.deepEqual(r.map(x=>x.data.remaining_cents),[4000,1500,0]);assert.deepEqual(r.map(x=>x.data.remaining_slots),[2,1,0]);
  db.exec("UPDATE ldc_awards SET state='accepted' WHERE id='a0'");assert.equal(rows()[0].id,r[0].id);assert.equal(winnerChatText(rows()[0].data).status,'已到账');
  db.exec("UPDATE ldc_awards SET state='accepted' WHERE id='a0'");claim(0,2);assert.equal(rows().length,3);
 }finally{db.close()}
});
test('Fish/Credit准确描述渠道、失败和受理状态',()=>{
 for(const provider of ['fish','credit']){const {db,claim,rows}=fixture({provider});try{
  claim(0,2);db.exec("UPDATE ldc_awards SET amount_cents=6001,state='rejected' WHERE id='a0'");let text=winnerChatText(rows()[0].data);assert.equal(text.reward,'60.01 LDC');assert.match(text.status,/失败/);assert.equal(text.platform,provider==='fish'?'Fish 余额':'Linux DO Credit');
  db.exec("UPDATE ldc_awards SET state='unknown' WHERE id='a0'");assert.match(winnerChatText(rows()[0].data).status,/待核对/);
  db.exec("UPDATE ldc_awards SET state='accepted' WHERE id='a0'");assert.equal(winnerChatText(rows()[0].data).status,provider==='fish'?'已到账':'平台已受理，到账以 Credit 为准');assert.equal(rows().length,1);
 }finally{db.close()}}
});
test('追加先隐藏金额，正式核定后更新同条；快速两人猜中仍保留各自中奖后余额',()=>{
 const {db,claim,rows}=fixture({escalation:10});try{
  claim(0,2);claim(1,3);assert.equal(rows()[0].data.amount_cents,null);assert.equal(rows()[0].data.remaining_cents,null);
  db.exec('UPDATE ldc_packets SET added_reward_cents=1000,total_cents=11000');assert.equal(rows()[0].data.amount_cents,null);
  // Existing integer D-coin allocation floors later slots; the first gets the remainder.
  db.exec('UPDATE ldc_packets SET reward_finalized=1');const r=rows();assert.equal(r.length,2);assert.deepEqual(r.map(x=>x.data.amount_cents),[6700,2700]);assert.deepEqual(r.map(x=>x.data.remaining_cents),[4300,1600]);
 }finally{db.close()}
});

test('仅Fish收款账户未建立提示配置，错误码单独更新及成功重试刷新原消息',()=>{
 for(const provider of ['fish','credit','coin52']){const {db,claim,rows}=fixture({provider});try{
  claim(0,2);const id=rows()[0].id;
  for(const code of ['BALANCE_INSUFFICIENT','INVALID_API_KEY','TRANSFER_NOT_ALLOWED','RECIPIENT_NOT_FOUND']){
   db.prepare("UPDATE ldc_awards SET state='rejected',payment_error=? WHERE id='a0'").run(code);
   assert.equal(rows()[0].data.needs_fish_setup,provider==='fish'&&code==='RECIPIENT_NOT_FOUND');
  }
  db.exec("UPDATE ldc_awards SET state='accepted' WHERE id='a0'");assert.equal(rows()[0].data.needs_fish_setup,false);assert.equal(rows().length,1);assert.equal(rows()[0].id,id);
 }finally{db.close()}}
});
test('排除补偿、其他群和普通红包，不暴露保密答案',()=>{
 for(const config of [{mode:'fixed'},{mode:'random'},{group:2}]){const {db,claim,rows}=fixture(config);try{claim(0,2);assert.equal(rows().length,0)}finally{db.close()}}
 const {db,claim,rows}=fixture();try{db.exec("UPDATE ldc_awards SET purpose='compensation' WHERE id='a1'; UPDATE ldc_packets SET answer_box='SECRET',hidden_winners=2");claim(0,2);claim(1,3);assert.equal(rows().length,1);assert.ok(!JSON.stringify(rows()).includes('SECRET'));assert.ok(!Object.keys(rows()[0].data).some(k=>k.includes('answer')))}finally{db.close()}
});
test('跨日清理后支付重试不重建历史消息；普通文本不能成为系统消息',()=>{
 const {db,claim,rows}=fixture();try{
  claim(0,2);db.exec('DELETE FROM guess_sidebar_messages');db.exec("UPDATE ldc_awards SET state='accepted' WHERE id='a0'");assert.equal(rows().length,0);
  assert.equal(winnerChatData({body:'✓ 系统：中奖100D币',system_data:'{}'}),null);assert.equal(winnerChatData({system_kind:'guess_winner',system_data:'{'}),null);
 }finally{db.close()}
});
test('新建触发器回滚随中奖事务一起回滚，无空报中奖',()=>{
 const {db,claim,rows}=fixture();try{db.exec('BEGIN');claim(0,2);db.exec('ROLLBACK');assert.equal(rows().length,0);claim(0,2);assert.equal(rows().length,1)}finally{db.close()}
});
