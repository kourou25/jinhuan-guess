import test from 'node:test';
import assert from 'node:assert/strict';
import {emojiInvitePath,readEmojiInvite} from '../app/public/emoji-invite.js';
import {requireTool} from '../scripts/toolchain.mjs';
const compiled=await requireTool('esbuild').build({entryPoints:['standalone/emoji-invite.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const {emojiInviteRedirect}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
test('邀请编号完整可逆，路径只含emoji及斜杠',()=>{
 for(const gid of [1,2,999])for(const messageId of [1,10,42,123456,Number.MAX_SAFE_INTEGER]){
  const path=emojiInvitePath(gid,messageId);assert.ok(!/[A-Za-z0-9?=]/.test(path));
  assert.deepEqual(readEmojiInvite(path),{gid,messageId});assert.deepEqual(readEmojiInvite(new URL(path,'https://play.jinhuan.example').pathname),{gid,messageId});
 }
 for(const path of ['/🧩/','/🧩/🍎🍊','/🧩/🍊/extra','/🧩/🍊/🍊/🍊','/🧩/abc','/🧩/%ED%A0%80','/🧩/'+'🍍'.repeat(17)])assert.equal(readEmojiInvite(path),null);
});
test('emoji跳转不访问数据库、固定同源目标、保留旧链接',()=>{
 const response=emojiInviteRedirect(new Request('https://play.jinhuan.example'+emojiInvitePath(1,42)+'?next=https://example.com&answer=private'));
 assert.equal(response.status,302);assert.equal(response.headers.get('location'),'https://play.jinhuan.example/chat/1?message_id=42');
 assert.equal(emojiInviteRedirect(new Request('https://play.jinhuan.example/chat/1?message_id=42')),null);
 assert.equal(emojiInviteRedirect(new Request('https://play.jinhuan.example'+emojiInvitePath(2,42))).status,400);
 assert.equal(emojiInviteRedirect(new Request('https://play.jinhuan.example/🧩/🍊',{method:'POST'})).status,405);
 assert.equal(emojiInviteRedirect(new Request('https://play.jinhuan.example/🧩/🍊',{method:'HEAD'})).status,302);
});
