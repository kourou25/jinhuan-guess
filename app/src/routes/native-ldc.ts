import {guessSubmissionSignals} from '../ldc/submission-guard'
import {guessMembersSql,guessBansSql} from '../services/guess-access'
import {predictionView,placePrediction} from '../ldc/predictions'
import {Hono,Context} from 'hono'
import type {Env} from '../env'
import type {C,Ctx,User} from '../types'
import {HTTPException} from 'hono/http-exception'
import {needUser,canManageAi} from '../services/auth'
import {needMember,assertCurrentAccess} from '../services/chat-access'
import {boundedJson,fail,sameOrigin} from '../lib/http'
import {now} from '../lib/time'
import {seal,unseal,normalizeAnswer,money,cents,rewardCents} from '../ldc/core'
import {autoContext,parseAutoWord,sealAutoWord,selectedWordLength} from '../ldc/auto-game'
import {generateWordCandidate,WORD_GENERATION_BUDGET_MS} from '../ldc/word-generator'
import {ensureWordHistory,wordFingerprint,wordSeen} from '../ldc/word-history'
import {ready,identity,accountSecret,nativeView,nativeWinnerNotice,type Account,type NativePacket,type Award} from '../ldc/packets'
import {verifyCredit,distributeCredit,reconcileCredit} from '../ldc/credit'
import {chat,type AiResult} from '../ai/gateway'
import {aiFailureText} from '../ai/errors'
import {beginAiBoost,finishAiBoost,sourceTable,type AiSource} from '../ai/chat-boost'
import {recordGameTurn,answerGameQuestion,finishGameTurn,gameOpen,type GameTurn} from '../ldc/game'
import {assistantPrompt} from '../shared/ai-prompts'
import {chatContext} from '../ai/chat-context'
import {cancelNativeGame,cancelPreview,voteNativeClose,forceNativeClose} from '../ldc/cancel'
import {guessRoomView,guessStatsView,createRoomEntry} from '../ldc/room'
import {activeGame,loadGame} from '../ldc/game-store'
import {freeWinner} from '../ldc/free-game'
import {freeOwnerParticipates} from '../ldc/author-options'
import {guessTipView,sendGuessTip,priorGuessTip} from '../ldc/tips'
import {appendOwnerHint,generateTurnHint} from '../ldc/extra-hints'
import {senderStatsView} from '../ldc/sender-stats'
import {settleGuessProgress,finalizeEscalation} from '../ldc/escalation'
import {saveGuessQueue,guessQueueList,queueDetail,cancelQueued} from '../ldc/queue'
import {settleCoinAward,refundCoinPool} from '../ldc/coin-funding'
import {packetLuckStats} from '../ldc/luck'
import {enterPacketDraw,allocateDueDraws} from '../ldc/draw'
import {publishPacketResults} from '../ldc/packet-results'
import {ensureCoinWallet} from '../farm/coin-packets'
import {fundingAccount,fundingProvider,fundingSecret,type FundingAccount} from '../ldc/funding'
import {checkFishCapacity} from '../ldc/fish-capacity'
import {escalationOptions} from '../ldc/escalation'
import {queryFish,transferFish,fishErrorText} from '../ldc/fish'
export const nativeLdc=new Hono<Ctx>()
nativeLdc.get('/api/admin/guess-submission-signals',async c=>{if(!canManageAi(c,needUser(c)))fail(403,'仅管理员可查看');c.header('cache-control','no-store');return c.json(await guessSubmissionSignals(c))})
const mutating=(c:C)=>{needUser(c);sameOrigin(c);ready(c);c.header('cache-control','no-store')}
nativeLdc.get('/api/chat/groups/:gid/guess-queue',async c=>{const gid=Number(c.req.param('gid'));const {u}=await needMember(c,gid,false);await assertCurrentAccess(c,u.id,gid);c.header('cache-control','no-store');return c.json(await guessQueueList(c,gid,u.id))})
nativeLdc.get('/api/chat/groups/:gid/guess-queue/:qid',async c=>{const gid=Number(c.req.param('gid'));const {u}=await needMember(c,gid,false);await assertCurrentAccess(c,u.id,gid);c.header('cache-control','no-store');return c.json(await queueDetail(c,gid,u.id,c.req.param('qid')))})
nativeLdc.post('/api/chat/groups/:gid/guess-queue',async c=>{
 mutating(c);const gid=Number(c.req.param('gid'));const {u}=await needMember(c,gid,false);await assertCurrentAccess(c,u.id,gid);await rate(c,u.id,'queue',6)
 const result=await saveGuessQueue(c,u,gid,await boundedJson(c));return c.json(result)
})
nativeLdc.delete('/api/chat/groups/:gid/guess-queue/:qid',async c=>{mutating(c);const gid=Number(c.req.param('gid'));const {u}=await needMember(c,gid,false);await assertCurrentAccess(c,u.id,gid);return c.json(await cancelQueued(c,gid,u.id,c.req.param('qid')))})
nativeLdc.get('/api/chat/groups/:gid/guess-room',async c=>{const gid=Number(c.req.param('gid'));if(!Number.isSafeInteger(gid)||gid<1)fail(400,'群编号无效');const {u,g}=await needMember(c,gid,false);await assertCurrentAccess(c,u.id,gid);c.header('cache-control','no-store');return c.json(await guessRoomView(c,gid,u.id,g.joined_at))})
nativeLdc.get('/api/chat/groups/:gid/guess-stats',async c=>{const gid=Number(c.req.param('gid'));if(!Number.isSafeInteger(gid)||gid<1)fail(400,'群编号无效');const {u}=await needMember(c,gid,false);await assertCurrentAccess(c,u.id,gid);c.header('cache-control','private, max-age=30');return c.json(await guessStatsView(c,gid,u.id))})
nativeLdc.get('/api/chat/groups/:gid/packet-luck-stats',async c=>{const gid=Number(c.req.param('gid'));const {u}=await needMember(c,gid,false);await assertCurrentAccess(c,u.id,gid);c.header('cache-control','no-store');return c.json(await packetLuckStats(c,gid,u.id))})
nativeLdc.get('/api/chat/groups/:gid/sender-stats',async c=>{const gid=Number(c.req.param('gid'));if(!Number.isSafeInteger(gid)||gid<1)fail(400,'群编号无效');const {u}=await needMember(c,gid,false);await assertCurrentAccess(c,u.id,gid);c.header('cache-control','private, max-age=30');return c.json(await senderStatsView(c,gid,u.id))})
nativeLdc.post('/api/chat/messages/:id/guess-room',async c=>{
 mutating(c);const {p,u}=await load(c,true),b=await boundedJson(c,8192);await rate(c,u.id,'room',30)
 const entry=await createRoomEntry(c,p,u,b)
 if(entry.created)c.executionCtx.waitUntil(handleNativeGameMessage(c,{id:entry.id,body:entry.body,group_id:p.group_id,reply_to:Number(c.req.param('id')),stream:'guess'},u).catch(()=>console.error('guess_room_reply_write_failed')))
 return c.json({entry:{id:entry.id}})
})
nativeLdc.get('/api/chat/messages/:id/prediction',async c=>{const {p,u}=await load(c,true);c.header('cache-control','no-store');return c.json(await predictionView(c,p,u.id))})
nativeLdc.post('/api/chat/messages/:id/prediction',async c=>{mutating(c);const {p,u}=await load(c,true);await rate(c,u.id,'prediction',10);return c.json(await placePrediction(c,p,u,await boundedJson(c,1024)))})
nativeLdc.get('/api/chat/messages/:id/guess-tip',async c=>{const {p,u}=await load(c,true);c.header('cache-control','no-store');return c.json(await guessTipView(c,p,u))})
nativeLdc.post('/api/chat/messages/:id/guess-tip',async c=>{mutating(c);const b=await boundedJson(c,1024),user=needUser(c);const prior=await priorGuessTip(c,user.id,Number(c.req.param('id')),b);if(prior)return c.json(prior);const {p,u}=await load(c,true);await rate(c,u.id,'tip',10);return c.json(await sendGuessTip(c,p,u,b))})
nativeLdc.get('/api/chat/messages/:id/guess-close',async c=>{const {p,u}=await load(c,true);c.header('cache-control','no-store');return c.json(await cancelPreview(c,p,u))})
nativeLdc.post('/api/chat/messages/:id/guess-close',async c=>{
 mutating(c);const {p,u}=await load(c,true),b=await boundedJson(c,1024);await rate(c,u.id,'close',10)
 if(b.action==='vote')return c.json(await voteNativeClose(c,p,u,b.agree))
 if(b.action==='force'){const text=await forceNativeClose(c,p,u,b);await settleCompensationAwards(c.env,p.packet_id);return c.json({text})}
 if(b.action==='request')return c.json({text:await cancelNativeGame(c,p,u)})
 fail(400,'流局操作无效')
})
nativeLdc.post('/api/chat/messages/:id/guess-hints',async c=>{
 mutating(c);const {p,u}=await load(c,true),b=await boundedJson(c,2048);await rate(c,u.id,'append-hint',5)
 await appendOwnerHint(c,p,u,b);return c.json({added:true})
})
async function rate(c:C,uid:number,scope:string,max:number){const t=now(),day=new Date(t*1000+28800000).toISOString().slice(0,10),scoped='ldc:'+scope+':'+Math.floor(t/60),key=String(uid);const ok=await c.env.DB.prepare(`INSERT INTO quota_usage(day,scope,key,n) VALUES(?,?,?,1) ON CONFLICT(day,scope,key) DO UPDATE SET n=n+1 WHERE n<? RETURNING n`).bind(day,scoped,key,max).first();if(!ok)fail(429,'操作太快了，请一分钟后再试');return {day,scoped,key}}
nativeLdc.get('/api/me/ldc',async c=>{const u=needUser(c);c.header('cache-control','no-store');const a=await c.env.DB.prepare('SELECT client_id,enabled,create_enabled FROM ldc_accounts WHERE user_id=?').bind(u.id).first<Account & {create_enabled:number}>();return c.json({configured:!!c.env.LDC_ENCRYPTION_KEY,bound:!!a,enabled:!!a?.enabled,create_enabled:!!a?.create_enabled,client_mask:a?a.client_id.slice(0,4)+'…'+a.client_id.slice(-4):null})})
nativeLdc.post('/api/chat/groups/:gid/ldc/auto-word',async c=>{
 mutating(c);const gid=Number(c.req.param('gid'));if(!Number.isSafeInteger(gid)||gid<1)fail(400,'群编号无效')
 const {u}=await needMember(c,gid,false),b=await boundedJson(c,1024)
 const nonce=String(b.nonce??''),mode=String(b.response_mode??'similarity'),free=b.reward_type==='none',provider=fundingProvider(b)
 let length:number|undefined;try{length=selectedWordLength(b.answer_length)}catch(e){fail(400,(e as Error).message)}
 if(b.reward_type!==undefined&&!['none','ldc'].includes(String(b.reward_type)))fail(400,'奖励方式无效')
 if(!/^[a-zA-Z0-9-]{16,64}$/.test(nonce)||!['yesno','similarity'].includes(mode))fail(400,'出词参数无效')
 let total=0;if(!free){try{total=rewardCents(b.amount,fundingProvider(b))}catch(e){fail(400,(e as Error).message)}if(provider!=='coin52')await identity(c,u.id);else await ensureCoinWallet(c.env.DB,u.id,now())}
 const eligible=async()=>{
  await assertCurrentAccess(c,u.id,gid)
  const row=await c.env.DB.prepare(`SELECT 1 FROM users u WHERE u.id=?1 AND u.disabled=0 AND u.kind='user' AND u.silenced=0
   ${free?'':`AND EXISTS(SELECT 1 FROM packet_funding_accounts a WHERE a.user_id=u.id AND a.enabled=1 AND a.payment_provider='${provider}')`}
   AND NOT EXISTS(SELECT 1 FROM user_limits l WHERE l.user_id=u.id AND u.is_admin=0 AND l.kind='chat' AND (l.until=0 OR l.until>?2))`).bind(u.id,now()).first()
  if(!free&&provider==='credit'&&!await c.env.DB.prepare('SELECT 1 FROM ldc_accounts WHERE user_id=? AND create_enabled=1').bind(u.id).first())fail(409,'Credit 新发包已关闭，请在渠道设置中开启')
  if(!row)fail(403,free?'账号当前不可参与群聊':provider==='fish'?'请先绑定并启用本人 Fish Key，且账号可正常参与群聊':'请先绑定并启用本人 LDC 应用，且账号可正常参与群聊')
  if(await activeGame(c,gid))fail(409,'本群已有猜词游戏，请等待猜中或结束')
 }
 await eligible();await rate(c,u.id,'auto-word-attempt',6)
 if(!free&&provider==='fish'){const escalation=await escalationOptions(c,{...b,mode:'guess'},u.id,total);await checkFishCapacity(c,await fundingAccount(c,u.id,'fish'),total+escalation.cap)}
 const slot=await rate(c,u.id,'auto-word',3)
 try{
  await ensureWordHistory(c,gid,ready(c))
  const deadline=Date.now()+WORD_GENERATION_BUDGET_MS,rejected:string[]=[]
  let game:ReturnType<typeof parseAutoWord>|undefined
  for(let attempt=0;attempt<2;attempt++){
   const remaining=deadline-Date.now();if(remaining<1000)break
   const candidate=await generateWordCandidate(c.env,u.id,remaining,rejected,c.req.raw.signal,length)
   if(await wordSeen(c,gid,await wordFingerprint(ready(c),gid,candidate!.answers[0]))){rejected.push(candidate!.answers[0]);continue}
   game=candidate!;break
  }
  if(!game)fail(503,'欢欢生成的题目与历史题库重复，请重新生成；未创建红包、未扣款')
  await eligible()
  const expires=now()+900,token=await sealAutoWord(ready(c),autoContext(u.id,gid,nonce,total,mode),game!,expires)
  return c.json({auto_word:token,expires_at:expires,amount:money(total),reward_type:free?'none':'ldc',hint_count:game!.hints.length})
 }catch(error){
  await c.env.DB.prepare('UPDATE quota_usage SET n=n-1 WHERE day=? AND scope=? AND key=? AND n>0').bind(slot.day,slot.scoped,slot.key).run().catch(()=>console.error('auto_word_rate_refund_failed'))
  throw error
 }
})
nativeLdc.post('/api/me/ldc',async c=>{
 mutating(c);const u=needUser(c),b=await boundedJson(c,4096);await identity(c,u.id);await rate(c,u.id,'bind',3)
 const client=String(b.client_id??'').trim(),secret=String(b.client_secret??'').trim()
 if(b.own_application!==true)fail(400,'请确认绑定的是本人应用，并同意按红包规则分发LDC')
 if(!/^[A-Za-z0-9_-]{8,128}$/.test(client)||!/^\S{8,256}$/.test(secret)||/[^\x21-\x7e]/.test(secret))fail(400,'Client ID 或 Secret 格式不正确')
 if(!(await verifyCredit({client_id:client,secret})))fail(400,'无法验证应用凭据，请核对后重试；平台不可用时不会保存')
 const box=await seal(ready(c),'ldc-account:'+u.id+':'+client,secret),t=now()
 const result=await c.env.DB.prepare(`INSERT INTO ldc_accounts(user_id,client_id,secret_box,created_at,updated_at) VALUES(?,?,?,?,?)
  ON CONFLICT(user_id) DO UPDATE SET client_id=excluded.client_id,secret_box=excluded.secret_box,enabled=1,create_enabled=1,updated_at=excluded.updated_at
  WHERE ldc_accounts.client_id=excluded.client_id OR NOT EXISTS(SELECT 1 FROM ldc_packets p WHERE p.owner_id=? AND p.payment_provider='credit' AND
   ((p.state='open' AND p.ends_at>?) OR EXISTS(SELECT 1 FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.state IN ('reserved','sent','unknown','rejected'))))
  RETURNING user_id`).bind(u.id,client,box,t,t,u.id,t).first().catch(()=>fail(409,'该应用已绑定其他账号，无法保存'))
 if(!result)fail(409,'请先关闭未结束红包并核对所有未完成发放，再更换应用')
 return c.json({saved:true})
})
nativeLdc.post('/api/me/ldc/channel',async c=>{
 mutating(c);const u=needUser(c),b=await boundedJson(c,1024);if(typeof b.enabled!=='boolean')fail(400,'开关值无效');await identity(c,u.id);
 const a=await c.env.DB.prepare('UPDATE ldc_accounts SET create_enabled=?,enabled=CASE WHEN ?=1 THEN 1 ELSE enabled END,updated_at=? WHERE user_id=? RETURNING user_id').bind(b.enabled?1:0,b.enabled?1:0,now(),u.id).first();if(!a)fail(409,'请先绑定本人 Credit 应用');return c.json({enabled:b.enabled})
})
nativeLdc.post('/api/me/ldc/disable',async c=>{mutating(c);const u=needUser(c);await c.env.DB.batch([c.env.DB.prepare('UPDATE ldc_accounts SET enabled=0,updated_at=? WHERE user_id=?').bind(now(),u.id),c.env.DB.prepare("UPDATE ldc_packets SET state='closed' WHERE owner_id=? AND payment_provider='credit' AND state='open'").bind(u.id)]);return c.json({disabled:true,in_flight_may_complete:true})})
// 个人账本独立于群消息可见性：旧红包撤回/退群后仍可核对自己的资金记录。
nativeLdc.get('/api/me/ldc/awards',async c=>{
 const u=needUser(c);c.header('cache-control','no-store');const before=c.req.query('before')||'~'
 if(before!=='~'&&!/^[a-f0-9-]{36}$/i.test(before))fail(400,'记录游标无效')
 const rows=await c.env.DB.prepare(`SELECT a.id,a.amount_cents,a.state,a.receipt_no,a.payment_error,p.payment_provider,p.owner_id,p.created_at,
  COALESCE(v.nick,v.name,v.username) recipient FROM ldc_awards a JOIN ldc_packets p ON p.packet_id=a.packet_id LEFT JOIN users v ON v.id=a.recipient_id
  WHERE a.id IN (SELECT x.id FROM ldc_packets q JOIN ldc_awards x ON x.packet_id=q.packet_id WHERE q.owner_id=?1 AND x.recipient_id IS NOT NULL AND x.id<?2
   UNION SELECT id FROM ldc_awards WHERE recipient_id=?1 AND id<?2) ORDER BY a.id DESC LIMIT 21`).bind(u.id,before).all<{id:string;amount_cents:number;state:string;receipt_no:string|null;payment_error:string|null;payment_provider:string;owner_id:number;created_at:number;recipient:string}>()
 const page=rows.results.slice(0,20);return c.json({items:page.map(r=>({id:r.id,amount:money(r.amount_cents),state:r.state,receipt:r.receipt_no,payment_provider:r.payment_provider,currency:r.payment_provider==='coin52'?'D币':'LDC',error:r.payment_provider==='fish'?fishErrorText(r.payment_error):null,owner:r.owner_id===u.id,recipient:r.recipient,created_at:r.created_at})),next:rows.results.length>20?page.at(-1)!.id:null})
})
nativeLdc.post('/api/me/ldc/awards/:award/reconcile',async c=>{
 mutating(c);const u=needUser(c),b=await boundedJson(c,1024);await rate(c,u.id,'reconcile',4)
 const a=await c.env.DB.prepare('SELECT * FROM ldc_awards WHERE id=?').bind(c.req.param('award')).first<Award>()
 if(!a)fail(404,'记录不存在');const p=await c.env.DB.prepare('SELECT * FROM ldc_packets WHERE packet_id=?').bind(a!.packet_id).first<NativePacket>()
 if(!p||(p.owner_id!==u.id&&a!.recipient_id!==u.id))fail(404,'记录不存在')
 await settle(c,p!,a!,b.retry===true&&p!.owner_id===u.id);await nativeWinnerNotice(c,p!)
 const result=await c.env.DB.prepare('SELECT state,receipt_no FROM ldc_awards WHERE id=?').bind(a!.id).first<{state:string;receipt_no:string|null}>()
 return c.json({state:result!.state,receipt:result!.receipt_no})
})
async function load(c:C,allowFree=false){
 const mid=Number(c.req.param('id'));if(!Number.isSafeInteger(mid)||mid<1)fail(400,'红包编号无效')
 let p=await c.env.DB.prepare(`SELECT p.*,m.group_id,m.id message_id,m.deleted FROM ldc_packets p JOIN chat_redpacks r ON r.id=p.packet_id JOIN chat_messages m ON m.id=r.message_id WHERE m.id=?`).bind(mid).first<NativePacket&{group_id:number;message_id:number;deleted:number}>()
 if(!p&&allowFree)p=await c.env.DB.prepare(`SELECT p.*,'none' AS reward_type,m.id message_id,m.deleted FROM guess_free_rounds p JOIN chat_redpacks r ON r.id=p.packet_id JOIN chat_messages m ON m.id=r.message_id WHERE m.id=?`).bind(mid).first<NativePacket&{group_id:number;message_id:number;deleted:number}>()
 if(!p||p.deleted)fail(404,'红包已撤回或不存在');const {u}=await needMember(c,p!.group_id,false);await assertCurrentAccess(c,u.id,p!.group_id);return {p:p!,u}
}
async function settle(c:C,p:NativePacket,a:Award,retry=false){
 if(p.escalation_every&&a.state==='reserved'){
  if(!await finalizeEscalation(c.env,p.packet_id))return
  a=(await c.env.DB.prepare('SELECT * FROM ldc_awards WHERE id=?').bind(a.id).first<Award>())!
 }
 if(p.payment_provider==='coin52'){await settleCoinAward(c.env.DB,a.id,a.recipient_id!,now());await refundCoinPool(c.env.DB,p.packet_id,now());return}
 if(p.payment_provider==='fish')return settleFish(c,p,a,retry)
 const db=c.env.DB,account=await db.prepare('SELECT * FROM ldc_accounts WHERE user_id=? AND client_id=?').bind(p.owner_id,p.client_id).first<Account>()
 if(!account)return
 const credential={client_id:account.client_id,secret:await accountSecret(c,account)}
 if(['sent','unknown'].includes(a.state)){
  if((a.sent_at??0)>now()-15)return
  const lease=await db.prepare('UPDATE ldc_awards SET checked_at=? WHERE id=? AND (checked_at IS NULL OR checked_at<=?) RETURNING id').bind(now(),a.id,now()-15).first();if(!lease)return
  const receipt=await reconcileCredit(credential,a);if(receipt)await db.prepare("UPDATE ldc_awards SET state='accepted',receipt_no=? WHERE id=? AND state IN ('sent','unknown')").bind(receipt,a.id).run()
  return
 }
 if(a.state!=='reserved'&&!(retry&&a.state==='rejected'))return
 if(!account.enabled)return
 // 此原子变更是发放开始点；之后的停用不撤销已开始的平台请求，也不重发未知请求。
 const send=await db.prepare(`UPDATE ldc_awards SET state='sent',sent_at=?,attempts=attempts+1 WHERE id=? AND attempts<3 AND (state='reserved' OR (?=1 AND state='rejected'))
  AND EXISTS(SELECT 1 FROM ldc_accounts WHERE user_id=? AND client_id=? AND enabled=1) RETURNING id`).bind(now(),a.id,retry?1:0,p.owner_id,p.client_id).first();if(!send)return
 const result=await distributeCredit(credential,a)
 await db.prepare("UPDATE ldc_awards SET state=?,receipt_no=? WHERE id=? AND state='sent'").bind(result.state,result.receipt,a.id).run()
}
async function settleFish(c:C,p:NativePacket,a:Award,retry:boolean){
 const db=c.env.DB,account=await db.prepare("SELECT *,'fish' AS payment_provider FROM fish_accounts WHERE user_id=? AND client_id=?").bind(p.owner_id,p.client_id).first<FundingAccount&{subject:string;username:string}>()
 if(!account)return
 const key=await fundingSecret(c,account),owner={userId:account.subject,username:account.username}
 if(['sent','unknown'].includes(a.state)){
  if((a.sent_at??0)>now()-15)return
  const lease=await db.prepare('UPDATE ldc_awards SET checked_at=? WHERE id=? AND state IN (\'sent\',\'unknown\') AND (checked_at IS NULL OR checked_at<=?) RETURNING id').bind(now(),a.id,now()-15).first();if(!lease)return
  const r=await queryFish(key,a,owner)
  await db.prepare("UPDATE ldc_awards SET state=?,receipt_no=COALESCE(?,receipt_no),payment_error=? WHERE id=? AND state IN ('sent','unknown')").bind(r.state==='not_found'?'rejected':r.state,r.receipt,r.error,a.id).run()
  return
 }
 if(a.state!=='reserved'&&!(retry&&a.state==='rejected')||!account.enabled)return
 // Key fingerprint and order number remain fixed, including explicit retries after a definite rejection.
 const send=await db.prepare(`UPDATE ldc_awards SET state='sent',sent_at=?,payment_error=NULL,attempts=attempts+1 WHERE id=? AND attempts<3 AND (state='reserved' OR (?=1 AND state='rejected'))
  AND EXISTS(SELECT 1 FROM fish_accounts WHERE user_id=? AND client_id=? AND enabled=1) RETURNING id`).bind(now(),a.id,retry?1:0,p.owner_id,p.client_id).first();if(!send)return
 const r=await transferFish(key,a,owner)
 await db.prepare("UPDATE ldc_awards SET state=?,receipt_no=?,payment_error=? WHERE id=? AND state='sent'").bind(r.state,r.receipt,r.error,a.id).run()
}
export async function settlePendingEscalationAwards(env:Env){
 const rows=await env.DB.prepare(`SELECT p.* FROM ldc_awards a JOIN ldc_packets p ON p.packet_id=a.packet_id
  WHERE a.state='reserved' AND a.attempts=0 AND p.escalation_every>0
  AND EXISTS(SELECT 1 FROM packet_funding_accounts x WHERE x.user_id=p.owner_id AND x.client_id=p.client_id AND x.payment_provider=p.payment_provider AND x.enabled=1)
  AND NOT EXISTS(SELECT 1 FROM ldc_question_cache q WHERE q.packet_id=p.packet_id AND q.state='pending' AND q.budget_reserved=1 AND q.expires_at>unixepoch())
  ORDER BY a.packet_id LIMIT 20`).all<NativePacket>()
 const c=new Context<Ctx>(new Request('https://settlement.internal/'),{env})
 for(const p of rows.results){
  const a=await env.DB.prepare("SELECT * FROM ldc_awards WHERE packet_id=? AND state='reserved' AND attempts=0 LIMIT 1").bind(p.packet_id).first<Award>()
  if(a){await settle(c,p,a);await nativeWinnerNotice(c,p)}
 }
}
export async function settleCompensationAwards(env:Env,packetId?:string){
 const rows=await env.DB.prepare(`SELECT a.id,p.* FROM ldc_awards a INDEXED BY idx_guess_compensation_pending JOIN ldc_packets p ON p.packet_id=a.packet_id
 WHERE a.purpose='compensation' AND a.state IN('reserved','sent','unknown') ${packetId?'AND a.packet_id=?':''}
 AND (a.state='reserved' OR COALESCE(a.sent_at,0)<=unixepoch()-15 AND COALESCE(a.checked_at,0)<=unixepoch()-15)
 ORDER BY COALESCE(a.checked_at,0),a.id LIMIT 20`).bind(...packetId?[packetId]:[]).all<NativePacket&{id:string}>()
 const c=new Context<Ctx>(new Request('https://compensation.internal/'),{env})
 for(const p of rows.results){const a=await env.DB.prepare('SELECT * FROM ldc_awards WHERE id=?').bind(p.id).first<Award>();if(a)await settle(c,p,a)}
}
export async function settlePacketDraws(env:Env,t:number){
 await allocateDueDraws(env.DB,t)
 // New awards must not wait behind repeatedly unresolved orders; reconcile oldest checks first.
 const rows=await env.DB.prepare(`SELECT a.id,p.* FROM ldc_awards a JOIN ldc_packets p ON p.packet_id=a.packet_id JOIN packet_draws d ON d.packet_id=p.packet_id
  WHERE d.settled_at IS NOT NULL AND a.state IN('reserved','sent','unknown')
  AND (a.state='reserved' OR (COALESCE(a.sent_at,0)<=?1 AND COALESCE(a.checked_at,0)<=?1))
  AND EXISTS(SELECT 1 FROM packet_funding_accounts f WHERE f.user_id=p.owner_id AND f.client_id=p.client_id AND f.payment_provider=p.payment_provider AND (f.enabled=1 OR a.state IN('sent','unknown')))
  ORDER BY CASE WHEN a.state='reserved' THEN 0 ELSE 1 END,COALESCE(a.checked_at,0),a.packet_id,a.slot LIMIT 20`).bind(now()-15).all<NativePacket&{id:string}>()
 const c=new Context<Ctx>(new Request('https://draw.internal/'),{env})
 for(const row of rows.results){const a=await env.DB.prepare('SELECT * FROM ldc_awards WHERE id=?').bind(row.id).first<Award>();if(a)await settle(c,row,a)}
 await publishPacketResults(env.DB,t)
}
nativeLdc.post('/api/chat/messages/:id/ldc/enter',async c=>{mutating(c);const {p,u}=await load(c);await rate(c,u.id,'draw-enter',10);await enterPacketDraw(c,p,u);return c.json({ldc:await nativeView(c,p.packet_id,u.id)})})
nativeLdc.post('/api/chat/messages/:id/ldc/claim',async c=>{
 mutating(c);const {p,u}=await load(c),b=await boundedJson(c,4096)
 const nonce=b.nonce===undefined?undefined:String(b.nonce);if(nonce!==undefined&&!/^[-a-f0-9]{36}$/i.test(nonce))fail(400,'请求编号无效')
 return c.json({ldc:await claimNative(c,p,u,b.answer,undefined,nonce)})
})
export async function claimNative(c:C,p:NativePacket,u:User,answer:unknown,source?:AiSource,nonce?:string){
 if(p.reward_type==='none')return claimFree(c,p,u,answer,source,nonce)
 const db=c.env.DB
 if(await db.prepare('SELECT 1 FROM packet_draws WHERE packet_id=?').bind(p.packet_id).first())fail(409,'这是限时抽奖，请先报名并等待自动开奖')
 let turn:GameTurn|undefined
 if(u.id===p.owner_id)fail(403,'发包者不能领取自己的红包');if(u.silenced)fail(403,'账号当前不可参与')
 if(['fixed','random'].includes(p.mode)){
  const gate=await db.prepare(`SELECT r.game,o.solved_at FROM chat_redpacks r
   LEFT JOIN chat_redpack_opens o ON o.packet_id=r.id AND o.user_id=? WHERE r.id=?`).bind(u.id,p.packet_id).first<{game:string;solved_at:number|null}>()
  if(!gate||gate.game!=='ldc'&&!gate.solved_at)fail(409,'请先解开这份红包，再领取 LDC 奖励')
 }
 let mine=await db.prepare('SELECT * FROM ldc_awards WHERE packet_id=? AND recipient_id=?').bind(p.packet_id,u.id).first<Award>()
 if(!mine){
  if(p.state!=='open'||p.ends_at<=now())fail(409,'红包已结束');await rate(c,u.id,'guess',5)
  if(['guess','clues'].includes(p.mode)){
   if(typeof answer!=='string'||!normalizeAnswer(answer)||[...normalizeAnswer(answer)].length>40||answer.length>160)fail(400,'请输入答案，最多40字')
   const answers=JSON.parse(await unseal(ready(c),'ldc-answer:'+p.packet_id,p.answer_box!)) as string[]
   if(!answers.includes(normalizeAnswer(answer))){
    turn=await recordGameTurn(c,p,u,'guess',String(answer),source?messageNonce(source.id,source.stream):nonce||crypto.randomUUID(),source)
    const reply=p.response_mode==='similarity'?answerGameQuestion(c,p,u,turn):finishGameTurn(c,p,u,turn,'还没猜中，可以继续提问或猜答案。',null,'no')
    c.executionCtx.waitUntil(generateTurnHint(c,p,u,turn).catch(()=>console.error('guess_auto_hint_failed')))
    await reply
    if(source)return null
    fail(400,'还没猜中，欢欢的回答已显示在群消息下方')
   }
  }
  // 判题无需资金身份；只有答案命中、即将锁定奖励时核验本人 Linux.DO 绑定。
  const id=p.payment_provider==='coin52'?{subject:'site:'+u.id,username:u.username}:await identity(c,u.id)
  if(['guess','clues'].includes(p.mode))turn=await recordGameTurn(c,p,u,'guess',String(answer),source?messageNonce(source.id,source.stream):nonce||crypto.randomUUID(),source)
  if(turn)await settleGuessProgress(c.env,p.packet_id)
  mine=await db.prepare(`UPDATE ldc_awards SET recipient_id=?1,recipient_subject=?2,recipient_username=?3,state='reserved'
   WHERE id=(SELECT id FROM ldc_awards WHERE packet_id=?4 AND state='ready' ORDER BY slot LIMIT 1)
   AND NOT EXISTS(SELECT 1 FROM ldc_awards WHERE packet_id=?4 AND (recipient_id=?1 OR recipient_subject=?2))
   AND EXISTS(SELECT 1 FROM ldc_packets p JOIN packet_funding_accounts a ON a.user_id=p.owner_id AND a.client_id=p.client_id AND a.payment_provider=p.payment_provider WHERE p.packet_id=?4 AND p.state='open' AND p.ends_at>?5 AND a.enabled=1)
   AND EXISTS(SELECT 1 FROM users u JOIN ${['guess','clues'].includes(p.mode)?guessMembersSql:'chat_members'} cm ON cm.user_id=u.id WHERE u.id=?1 AND u.disabled=0 AND u.silenced=0 AND u.kind='user' AND cm.group_id=?6 ${p.payment_provider==='coin52'?'':"AND EXISTS(SELECT 1 FROM identities i WHERE i.provider='linuxdo' AND i.subject=?2 AND i.username=?3 AND i.user_id=u.id AND i.verified_at IS NOT NULL)"})
   AND NOT EXISTS(SELECT 1 FROM ${['guess','clues'].includes(p.mode)?guessBansSql:'chat_bans'} WHERE group_id=?6 AND user_id=?1)
   AND NOT EXISTS(SELECT 1 FROM user_limits l JOIN users u ON u.id=l.user_id WHERE l.user_id=?1 AND u.is_admin=0 AND l.kind='chat' AND (l.until=0 OR l.until>?5))
   AND EXISTS(SELECT 1 FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id WHERE r.id=?4 AND m.deleted=0)
   AND EXISTS(SELECT 1 FROM chat_redpacks r WHERE r.id=?4 AND (r.game='ldc' OR EXISTS(SELECT 1 FROM chat_redpack_opens o WHERE o.packet_id=r.id AND o.user_id=?1 AND o.solved_at IS NOT NULL)))
   AND (?7=0 OR EXISTS(SELECT 1 FROM ${sourceTable(source)} m WHERE m.id=?7 AND m.body=?8 AND m.deleted=0 AND m.user_id=?1 AND m.group_id=?6))
   RETURNING *`).bind(u.id,id.subject,id.username,p.packet_id,now(),p.group_id,source?.id||0,source?.body||'').first<Award>()
  mine=mine||await db.prepare('SELECT * FROM ldc_awards WHERE packet_id=? AND recipient_id=?').bind(p.packet_id,u.id).first<Award>()
  if(!mine){if(turn)await finishGameTurn(c,p,u,turn,'名额已被其他人抢先锁定，或本轮已结束。',null,'unavailable');fail(409,'名额已领完或红包已结束')}
 }
 await settle(c,p,mine!);await nativeWinnerNotice(c,p)
 if(p.escalation_every)mine=(await db.prepare('SELECT * FROM ldc_awards WHERE id=?').bind(mine!.id).first<Award>())!
 if(turn)await finishGameTurn(c,p,u,turn,p.escalation_every&&mine!.state==='reserved'?'答对了！中奖名额已锁定，正在核定剩余调用及最终奖励，发放状态见本轮信息。':`答对了！${money(mine!.amount_cents)} ${p.payment_provider==='coin52'?'D币':'LDC'} 奖励已锁定，发放状态见本轮信息。`,100,'correct')
 else if(source)await finishAiBoost(c,source,u,`你已猜中本轮，${money(mine!.amount_cents)} ${p.payment_provider==='coin52'?'D币':'LDC'} 奖励保留原单，不会重复发放。`,100)
 if(source)return null
 return nativeView(c,p.packet_id,u.id)
}
async function claimFree(c:C,p:NativePacket,u:User,answer:unknown,source?:AiSource,nonce?:string){
 if(u.silenced)fail(403,'账号当前不可参与')
 if(u.id===p.owner_id&&!freeOwnerParticipates(p))fail(403,'本轮发起者不参与猜词，可以查看谜底并追加线索')
 if(typeof answer!=='string'||!normalizeAnswer(answer)||[...normalizeAnswer(answer)].length>40||answer.length>160)fail(400,'请输入答案，最多40字')
 const answers=JSON.parse(await unseal(ready(c),'ldc-answer:'+p.packet_id,p.answer_box!)) as string[]
 const correct=answers.includes(normalizeAnswer(answer))
 if(p.winner_id===u.id&&correct){
  await freeWinner(c,p,u,source,answers[0])
  if(source)await finishAiBoost(c,source,u,'你已猜中本轮，胜利已计入等级，不会重复累计。',100)
  return null
 }
 if(p.state!=='open'||p.ends_at<=now()||p.winner_id)fail(409,'本轮已结束')
 await rate(c,u.id,'guess',5)
 const turn=await recordGameTurn(c,p,u,'guess',String(answer),source?messageNonce(source.id,source.stream):nonce||crypto.randomUUID(),source)
 if(!correct){
  const reply=p.response_mode==='similarity'?answerGameQuestion(c,p,u,turn):finishGameTurn(c,p,u,turn,'还没猜中，可以继续提问或猜答案。',null,'no')
  c.executionCtx.waitUntil(generateTurnHint(c,p,u,turn).catch(()=>console.error('guess_auto_hint_failed')))
  await reply
  return null
 }
 try{await freeWinner(c,p,u,source,answers[0])}catch(error){await finishGameTurn(c,p,u,turn,'已有成员率先猜中，或本轮已结束。',null,'unavailable');throw error}
 await finishGameTurn(c,p,u,turn,'答对了！本轮无 LDC 奖励，胜利已计入猜词等级。',100,'correct')
 return null
}
nativeLdc.post('/api/chat/messages/:id/ldc/reconcile',async c=>{
 mutating(c);const {p,u}=await load(c),b=await boundedJson(c,1024);await rate(c,u.id,'reconcile',4)
 const rows=await c.env.DB.prepare(`SELECT * FROM ldc_awards WHERE packet_id=? AND state IN ('reserved','sent','unknown','rejected') AND (?=1 OR recipient_id=?) ORDER BY slot LIMIT 3`).bind(p.packet_id,u.id===p.owner_id?1:0,u.id).all<Award>()
 for(const a of rows.results)await settle(c,p,a,b.retry===true&&u.id===p.owner_id)
 await nativeWinnerNotice(c,p);return c.json({ldc:await nativeView(c,p.packet_id,u.id)})
})
nativeLdc.post('/api/chat/messages/:id/ldc/close',async c=>{
 mutating(c);const {p,u}=await load(c);if(u.id!==p.owner_id)fail(403,'仅发包者可关闭')
 if(['guess','clues'].includes(p.mode))await cancelNativeGame(c,p,u)
 else{
  const t=now(),closed=await c.env.DB.batch([
   c.env.DB.prepare("UPDATE ldc_packets SET state='closed' WHERE packet_id=? AND NOT EXISTS(SELECT 1 FROM packet_draws d WHERE d.packet_id=ldc_packets.packet_id AND d.settled_at IS NULL AND d.draw_at<=?) RETURNING packet_id").bind(p.packet_id,t),
   c.env.DB.prepare("UPDATE packet_draws SET settled_at=? WHERE packet_id=? AND settled_at IS NULL AND draw_at>? AND EXISTS(SELECT 1 FROM ldc_packets WHERE packet_id=? AND state='closed')").bind(t,p.packet_id,t,p.packet_id),
  ])
  if(!closed[0].results.length)fail(409,'已到开奖时间，请等待开奖结果')
 }
 if(p.payment_provider==='coin52')await refundCoinPool(c.env.DB,p.packet_id,now())
 return c.json({ldc:await nativeView(c,p.packet_id,u.id)})
})
nativeLdc.post('/api/chat/messages/:id/ldc/ask',async c=>{
 mutating(c);const {p,u}=await load(c),b=await boundedJson(c,4096)
 return c.json(await askNative(c,p,u,b))
})
async function askNative(c:C,p:NativePacket,u:User,b:Record<string,unknown>,source?:AiSource,questionOnly=false){
 if(!['guess','clues'].includes(p.mode)||p.state!=='open'||p.ends_at<=now())fail(409,'这个红包当前不能提问')
 if(u.id===p.owner_id&&!(p.reward_type==='none'&&freeOwnerParticipates(p)))fail(400,'本轮发起者不参与猜词');if(u.silenced)fail(403,'账号当前不可参与')
 const question=String(b.question??'').trim(),nonce=String(b.nonce??'');if(!question||question.length>160||!/^[-a-f0-9]{36}$/i.test(nonce))fail(400,'请输入160字内的是非问题')
 // Preserve the legacy HTTP API; explicit group questions always use yes/no.
 if(p.response_mode==='similarity'&&!questionOnly)return {ldc:await claimNative(c,p,u,question,source,nonce)}
 await rate(c,u.id,'ask',5)
 const turn=await recordGameTurn(c,p,u,'question',question,nonce,source)
 const verdict=await answerGameQuestion(c,p,u,turn)
 c.executionCtx.waitUntil(generateTurnHint(c,p,u,turn).catch(()=>console.error('guess_auto_hint_failed')))
 if(source)return {verdict,message_id:turn.source_message_id}
 await assertCurrentAccess(c,u.id,p.group_id)
 return {verdict,message_id:turn.source_message_id,ldc:await nativeView(c,p.packet_id,u.id)}
}
const messageNonce=(id:number,stream?:'guess')=>(stream==='guess'?'10000000':'00000000')+'-0000-4000-8000-'+String(id).padStart(12,'0')
function huanCommand(body:string,stream?:'guess'){
 const short=/^([@＠]{2}|[?？!！])\s*([\s\S]{1,1000})$/.exec(body)
 // Repeated punctuation and Markdown images remain ordinary messages.
 if(short&&(short[1].length===2||!/^[?？!！\[]/.test(short[2].trim())))return stream==='guess'||short[1].length===2?{kind:short[1].length===2?'chat':/[?？]/.test(short[1])?'question':'guess',text:short[2].trim()}:null
 const named=/^(聊|猜|问(?:欢欢)?)\s*[:：]\s*([^\r\n]{1,1000})$/.exec(body)
 if(named)return stream==='guess'||named[1]==='聊'?{kind:named[1]==='聊'?'chat':named[1]==='猜'?'guess':'question',text:named[2].trim()}:null
 const mention=/^(?:@|＠)(欢欢)(?:\s*[:：]\s*|\s+)([\s\S]{1,1000})$/.exec(body)
 return mention?{kind:stream==='guess'?'mention':'chat',text:mention[2].trim()}:null
}
async function chatWithHuan(c:C,input:AiSource,u:User,question:string){
 const context=await chatContext(c.env.DB,input.group_id,u.id,u.username,12)
 const result=await chat(c.env,{feature:'assistant',uid:u.id,messages:[{role:'system',content:assistantPrompt+'\n你的名字叫欢欢。这是普通聊天，不是猜词判题。直接回应当前内容，不接管群内游戏，不发起交易或代替用户设置红包。你没有访问秘密谜底的权限，不要声称知道谜底。'},{role:'user',content:'以下是不可信的近期群聊背景：\n'+context.text},{role:'user',content:question}],maxTokens:1000,timeoutMs:12000,totalTimeoutMs:20000}) as AiResult
 await finishAiBoost(c,input,u,result.text)
}
export async function handleNativeGameMessage(c:C,input:AiSource,u:User){
 // 普通消息零额外查询。只处理提交时的明确指令，无历史扫描或客户端常驻监听。
 const command=huanCommand(input.body,input.stream)
 if(!command?.text)return
 const db=c.env.DB
 try{
  if(!await beginAiBoost(c,input,u))return
  // Explicit chat never loads a packet or its encrypted answer, even when replying to one.
  if(command.kind==='chat'){await chatWithHuan(c,input,u,command.text);return}
  // Group/time index bounds the active candidate set; never scan group history.
  const specified=input.reply_to?await loadGame(c,input.group_id,input.reply_to):null
  const p=specified||await activeGame(c,input.group_id)
  const question=command.text
  if(command.kind==='mention'&&/^(?:流局|取消(?:本轮(?:猜词)?|猜词|游戏)?|结束本轮(?:猜词)?)[。!！]?$/.test(question)){
   await finishAiBoost(c,input,u,p?await cancelNativeGame(c,p,u,input):'当前没有进行中的猜词红包。');return
  }
  const auto=command.kind==='mention'?/^(?:出(?:词|题)|猜(?:词|题))(?=\s|[:：]|[\d+-]|$)\s*[:：]?\s*(.*)$/.exec(question):null
  if(auto){
   if(p){await finishAiBoost(c,input,u,'本群已有猜词游戏，请先猜中或结束本轮；需要提示可 @欢欢 线索。');return}
   const amount=auto[1].replace(/\s*(?:ldc|积分)\s*$/i,'').trim()
   if(amount){try{cents(amount)}catch(error){fail(400,(error as Error).message+'。例如：@欢欢 猜词 16.66 LDC')}}
   await finishAiBoost(c,input,u,`自动出词：请点“确认奖励并发起”${amount?'，本轮奖励 '+money(cents(amount))+' LDC':'，填写本轮 LDC 奖励'}。生成和创建不扣款，首位猜中后从你的应用发放。`)
   return
  }
  if(p){
   if(!c.env.LDC_ENCRYPTION_KEY)fail(503,'本站LDC服务暂不可用')
   if(command.kind==='guess')await claimNative(c,p,u,question,input)
   else if(/^(?:给我?|再给)?(?:一条|个)?(?:阶段)?线索[?？!！。]?$/.test(question)){
    await rate(c,u.id,'hint',5);await finishAiBoost(c,input,u,await generateTurnHint(c,p,u)??'线索暂不可用，请稍后重试。')
   }else await askNative(c,p,u,{question,nonce:messageNonce(input.id,input.stream)},input,true)
  }else if(command.kind!=='mention')await finishAiBoost(c,input,u,'当前没有进行中的猜词红包；发送“@@内容”可以和欢欢聊天。')
  else await chatWithHuan(c,input,u,question)
 }catch(error){await finishAiBoost(c,input,u,error instanceof HTTPException?error.message:aiFailureText(error),null,'error')}
}
