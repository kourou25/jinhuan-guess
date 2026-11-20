import test from 'node:test';
import assert from 'node:assert/strict';
import {guessRoundLink,invitedRound,winnerSlots} from '../app/public/guess-invite.js';
import {readEmojiInvite} from '../app/public/emoji-invite.js';
test('RI05 share links contain only group and exact round identifiers',()=>{
 const url=guessRoundLink('https://play.jinhuan.example/chat/1?answer=secret',1,42);
 assert.equal(url,'https://play.jinhuan.example/🧩/🍇🍋');
 assert.deepEqual(readEmojiInvite(new URL(url).pathname),{gid:1,messageId:42});
 assert.equal(invitedRound('?message_id=42'),42);
 for(const value of ['',0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>guessRoundLink('https://play.jinhuan.example',1,value));
 for(const s of ['?message_id=-1','?message_id=2.3','?message_id=1e3','?message_id=9007199254740992','?message_id=<script>'])assert.equal(invitedRound(s),0);
 assert.throws(()=>guessRoundLink('javascript:alert(1)',1,1));
});
test('RI03 remaining slots distinguish winner payouts from compensation and ended games',()=>{
 const r={count:3,state:'open',claimed_count:3,recipients:[{purpose:'winner'},{purpose:'winner'},{purpose:'compensation'}]};
 assert.deepEqual(winnerSlots(r),{total:3,won:2,remaining:1,text:'剩余 1 个获奖名额 · 已中 2/3'});
 assert.match(winnerSlots({...r,state:'closed'}).text,/本局已结束.*1 个名额已关闭/);
 assert.equal(winnerSlots(null).text,'');assert.equal(winnerSlots({count:1}).text,'');
 assert.equal(winnerSlots({count:3,state:'closed',claimed_count:5}).remaining,0);
});
