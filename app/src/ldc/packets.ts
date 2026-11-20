import {predictionStatements} from './predictions'
import {guessMinutes,predictionCurrency} from './standalone-rules'
import {hintPolicy,publicHintPolicy,type HintPolicy} from './hint-stage'
import type {C,User} from '../types'
import {fail} from '../lib/http'
import {now} from '../lib/time'
import {seal,unseal,cents,rewardCents,money,splitAmount,cleanGame,hintInterval,extraHints} from './core'
import {autoContext,openAutoWord} from './auto-game'
import {ensureWordHistory,wordFingerprint,rememberWords} from './word-history'
import {freeCreation,freeView} from './free-game'
import {authorOptions,sealJudgeContext} from './author-options'
import {escalationOptions} from './escalation'
import {fundingAccount,fundingProvider} from './funding'
import {reserveCoinPool} from './coin-funding'
import {packetDrawView} from './draw'
import {fishErrorText} from './fish'
import {preparedAnswerReference,sealAnswerReference} from './answer-reference'
import {activeGame} from './game-store'
import {fishCreationGuard} from './fish-capacity'
import {multiwinnerOptions} from './multiwinner'
export type Account={user_id:number;client_id:string;secret_box:string;enabled:number}
export type NativePacket=HintPolicy&{close_kind?:'cancel'|'vote'|'force'|null;reward_freeze_ai_count?:number|null;hidden_winners?:number;guess_weights_json?:string;payment_provider?:'credit'|'fish'|'coin52';escalation_every?:number;escalation_step_cents?:number;escalation_cap_cents?:number;added_reward_cents?:number;base_total_cents?:number;packet_id:string;owner_id:number;client_id:string;mode:string;total_cents:number;count:number;ends_at:number;state:string;answer_box:string|null;hints_json:string;created_at:number;group_id:number;game_version:number;response_mode:'yesno'|'similarity';answer_length:number;guess_count:number;question_count:number;ai_count:number;hints_box:string|null;hints_revealed:number;hint_at:number;auto_hint_every?:number;extra_hints_json?:string;reward_type?:'ldc'|'none';generated?:number;owner_participates?:number;judge_context_box?:string|null;answer_reference_box?:string|null;winner_id?:number|null}
export type Award={purpose?:'winner'|'compensation';slot:number;payment_error?:string|null;id:string;packet_id:string;amount_cents:number;recipient_id:number|null;recipient_subject:string;recipient_username:string;state:string;order_no:string;receipt_no:string|null;sent_at:number|null;checked_at:number|null;attempts:number}
export function ready(c:C){if(!c.env.LDC_ENCRYPTION_KEY)fail(503,'站内LDC服务尚未配置');return c.env.LDC_ENCRYPTION_KEY!}
export async function identity(c:C,uid:number){const id=await c.env.DB.prepare("SELECT subject,username FROM identities WHERE user_id=? AND provider='linuxdo' AND verified_at IS NOT NULL").bind(uid).first<{subject:string;username:string}>();if(!id||!/^\d+$/.test(id.subject)||!Number.isSafeInteger(Number(id.subject))||Number(id.subject)<=0||!id.username)fail(403,'请先在账号设置绑定并登录 Linux.DO');return id!}
export async function accountSecret(c:C,a:Account){try{return await unseal(ready(c),'ldc-account:'+a.user_id+':'+a.client_id,a.secret_box)}catch{return fail(503,'LDC凭据无法解密，请联系站长检查配置')}}
export async function nativeCreation(c:C,b:Record<string,unknown>,u:User,id:string,gid:number){
 if(b.provider==='free_guess')return freeCreation(c,b,u,id,gid)
 ready(c);if(fundingProvider(b)!=='coin52')await identity(c,u.id)
 const provider=fundingProvider(b),a=await fundingAccount(c,u.id,provider)
 let game:ReturnType<typeof cleanGame>&{reference?:string},total:number,slots:number[],every:number,policy:Required<HintPolicy>,options:ReturnType<typeof authorOptions>
 let multi:ReturnType<typeof multiwinnerOptions>|undefined
 try{
  options=authorOptions(b);predictionCurrency(b.prediction_currency)
  every=hintInterval(b);policy=hintPolicy(b,every)
  total=rewardCents(b.amount,fundingProvider(b))
  if(b.auto_word){
   if(b.mode!=='guess'||typeof b.auto_word!=='string')throw Error('自动出词只用于猜词游戏')
   try{game=await openAutoWord(ready(c),autoContext(u.id,gid,String(b.nonce),total,String(b.response_mode??'yesno')),b.auto_word,now())}catch{throw Error('自动题目已失效或参数已改变，请重新生成')}
  }else game=cleanGame(b)
  if(provider==='coin52'&&total%100)throw Error('D币奖励必须为整数')
  if(['guess','clues'].includes(game.mode)){multi=multiwinnerOptions(b,total,provider==='coin52'?100:1);slots=multi.slots}
  else slots=splitAmount(provider==='coin52'?total/100:total,Number(b.count),game.mode).map(n=>provider==='coin52'?n*100:n)
 }catch(e){fail(400,(e as Error).message)}
 const responseMode=String(b.response_mode??'yesno');if(!['yesno','similarity'].includes(responseMode))fail(400,'请选择是非或相关度模式')
 let t=now();const minutes=['guess','clues'].includes(game!.mode)?(()=>{try{return guessMinutes(b.minutes)}catch(e){return fail(400,(e as Error).message)}})():Number(b.minutes??1440);const drawAt=b.draw_at==null?null:Number(b.draw_at);if(drawAt!==null&&(!['fixed','random'].includes(game!.mode)||!Number.isSafeInteger(drawAt)||drawAt<t+60||drawAt>t+86400))fail(400,'开奖时间需在1分钟至24小时内，且仅用于普通分配方式');if(!Number.isInteger(minutes)||minutes<1||minutes>1440)fail(400,'有效期需为1–1440分钟')
 const escalation=await escalationOptions(c,b,u.id,total!)
 if(provider==='coin52'&&(escalation.step%100||escalation.cap%100))fail(400,'D币追加奖励必须为整数')
 if(game!.answers.length&&await activeGame(c,gid))fail(409,'本群已有猜词游戏，请排队或等待本轮结束')
 const capacityGuard=await fishCreationGuard(c,a!,total!+escalation.cap,id)
 const reference=game!.answers.length?(game!.reference??await preparedAnswerReference(c.env,u.id,id,game!.answers,options!.context,c.req.raw.signal)):''
 t=now()
 const referenceBox=reference?await sealAnswerReference(ready(c),id,reference):null
 const answerBox=game!.answers.length?await seal(ready(c),'ldc-answer:'+id,JSON.stringify(game!.answers)):null
 const contextBox=await sealJudgeContext(ready(c),id,options!.context)
 const hintsBox=game!.hints.length?await seal(ready(c),'ldc-hints:'+id,JSON.stringify(game!.hints)):null
 const values=slots!.map((amount_cents,slot)=>({id:crypto.randomUUID(),slot,amount_cents,order_no:'jh-'+crypto.randomUUID().replaceAll('-','')}))
 if(b.auto_word)await ensureWordHistory(c,gid,ready(c))
 const hashes=await Promise.all(game!.answers.map(answer=>wordFingerprint(ready(c),gid,answer)))
 return [
  ...capacityGuard,
  ...(['guess','clues'].includes(game!.mode)?predictionStatements(c.env.DB,id,b.prediction_currency,t):[]),
  c.env.DB.prepare(`INSERT OR IGNORE INTO ldc_packets(packet_id,owner_id,client_id,mode,total_cents,count,ends_at,answer_box,hints_json,created_at,group_id,game_version,response_mode,answer_length,hints_box,auto_hint_every,judge_context_box,generated,hint_source,preset_hint_trigger,hint_cooldown_seconds,auto_hint_increment,payment_provider,answer_reference_box)
   SELECT r.id,?,?,?,?,?,?,?,'[]',?,m.group_id,1,?,?,?,?,?,?,?,?,?,?,?,? FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id WHERE r.id=? AND EXISTS(SELECT 1 FROM packet_funding_accounts WHERE user_id=? AND client_id=? AND enabled=1 AND (payment_provider<>'credit' OR EXISTS(SELECT 1 FROM ldc_accounts x WHERE x.user_id=packet_funding_accounts.user_id AND x.create_enabled=1)))`)
   .bind(u.id,a!.client_id,game!.mode,total!,slots!.length,drawAt??t+minutes*60,answerBox,t,responseMode,[...(game!.answers[0]||'')].length,hintsBox,every!,contextBox,b.auto_word?1:0,policy!.hint_source,policy!.preset_hint_trigger,policy!.hint_cooldown_seconds,policy!.auto_hint_increment,provider,referenceBox,id,u.id,a!.client_id),
  ...(drawAt!==null?[c.env.DB.prepare('INSERT OR IGNORE INTO packet_draws(packet_id,draw_at) SELECT packet_id,? FROM ldc_packets WHERE packet_id=?').bind(drawAt,id)]:[]),
  ...(multi?[c.env.DB.prepare('UPDATE ldc_packets SET hidden_winners=?,guess_weights_json=? WHERE packet_id=? AND NOT EXISTS(SELECT 1 FROM ldc_awards WHERE packet_id=ldc_packets.packet_id)').bind(multi.hidden,JSON.stringify(multi.weights),id)]:[]),
  ...(provider==='coin52'?reserveCoinPool(c.env.DB,id,u.id,(total!+escalation.cap)/100,t):[]),
  c.env.DB.prepare(`UPDATE ldc_packets SET author_rule_version=1,base_total_cents=total_cents,escalation_every=?,escalation_step_cents=?,escalation_cap_cents=? WHERE packet_id=? AND mode IN('guess','clues') AND author_rule_version=0`).bind(escalation.every,escalation.step,escalation.cap,id),
  c.env.DB.prepare(`INSERT OR IGNORE INTO ldc_awards(id,packet_id,slot,amount_cents,order_no)
   SELECT json_extract(j.value,'$.id'),p.packet_id,json_extract(j.value,'$.slot'),json_extract(j.value,'$.amount_cents'),json_extract(j.value,'$.order_no')
   FROM ldc_packets p,json_each(?) j WHERE p.packet_id=?`).bind(JSON.stringify(values),id),
  // 账户在创建过程中停用时使整个D1 batch回滚，不能留下没有奖池的群消息。
  c.env.DB.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM ldc_packets WHERE packet_id=?) THEN 1 ELSE json('ldc_account_changed') END").bind(id),
  ...hashes.length?[rememberWords(c,gid,id,t,hashes,!!b.auto_word)]:[],
 ]
}
// 站内解谜只附加奖池，谜底仍由原有红包流程校验；领奖必须有该用户的解谜记录。
export async function puzzleRewardCreation(c:C,b:Record<string,unknown>,u:User,id:string){
 ready(c);if(fundingProvider(b)!=='coin52')await identity(c,u.id)
 const provider=fundingProvider(b),account=await fundingAccount(c,u.id,provider)
 const kind=String(b.ldc_kind||'fixed'),count=Number(b.ldc_count),minutes=Number(b.ldc_minutes??1440)
 if(!['fixed','random'].includes(kind))fail(400,'请选择均分或拼手气奖励')
 if(!Number.isInteger(minutes)||minutes<1||minutes>1440)fail(400,'奖励有效期需为1–1440分钟')
 let total:number,slots:number[]
 try{total=rewardCents(b.ldc_amount,provider);if(provider==='coin52'&&total%100)throw Error('D币奖励必须为整数');slots=splitAmount(provider==='coin52'?total/100:total,count,kind).map(n=>provider==='coin52'?n*100:n)}catch(error){fail(400,(error as Error).message)}
 const capacityGuard=await fishCreationGuard(c,account!,total!,id)
 const created=now(),awards=slots!.map((amount_cents,slot)=>({id:crypto.randomUUID(),slot,amount_cents,order_no:'jh-'+crypto.randomUUID().replaceAll('-','')}))
 return [
  ...capacityGuard,
  c.env.DB.prepare(`INSERT OR IGNORE INTO ldc_packets(packet_id,owner_id,client_id,mode,total_cents,count,ends_at,created_at,group_id,payment_provider)
   SELECT r.id,?,?,?,?,?,?,?,m.group_id,? FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id
   WHERE r.id=? AND r.provider='native' AND r.game NOT IN ('ldc','free_guess')
   AND EXISTS(SELECT 1 FROM packet_funding_accounts a WHERE a.user_id=? AND a.client_id=? AND a.enabled=1 AND (a.payment_provider<>'credit' OR EXISTS(SELECT 1 FROM ldc_accounts x WHERE x.user_id=a.user_id AND x.create_enabled=1)))`)
   .bind(u.id,account!.client_id,kind,total!,slots!.length,created+minutes*60,created,provider,id,u.id,account!.client_id),
  ...(provider==='coin52'?reserveCoinPool(c.env.DB,id,u.id,total!/100,created):[]),
  c.env.DB.prepare(`INSERT OR IGNORE INTO ldc_awards(id,packet_id,slot,amount_cents,order_no)
   SELECT json_extract(j.value,'$.id'),p.packet_id,json_extract(j.value,'$.slot'),json_extract(j.value,'$.amount_cents'),json_extract(j.value,'$.order_no')
   FROM ldc_packets p,json_each(?) j WHERE p.packet_id=?`).bind(JSON.stringify(awards),id),
  c.env.DB.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM ldc_packets WHERE packet_id=?) THEN 1 ELSE json('ldc_account_changed') END").bind(id),
 ]
}
export async function nativeView(c:C,id:string,uid:number,known?:NativePacket){
 const db=c.env.DB,p=known||await db.prepare('SELECT * FROM ldc_packets WHERE packet_id=?').bind(id).first<NativePacket>()||await db.prepare("SELECT *,'none' AS reward_type FROM guess_free_rounds WHERE packet_id=?").bind(id).first<NativePacket>();if(!p)fail(409,'这份红包或游戏创建未完成，请发起者重新打开检查')
 if(p!.reward_type==='none')return freeView(c,p!,uid)
 const rows=await db.prepare(`SELECT a.purpose,a.recipient_id,a.amount_cents,a.state,a.receipt_no,a.payment_error,a.sent_at,u.avatar,COALESCE(u.nick,u.name,u.username) name FROM ldc_awards a LEFT JOIN users u ON u.id=a.recipient_id WHERE packet_id=? ORDER BY slot`).bind(id).all<{purpose:string;recipient_id:number|null;amount_cents:number;state:string;receipt_no:string|null;payment_error:string|null;sent_at:number|null;avatar:string|null;name:string|null}>()
 const recipients=rows.results.filter(r=>r.recipient_id!==null).map((r,i)=>({purpose:r.purpose,rank:i+1,user_id:r.recipient_id,name:r.name,avatar:r.avatar,at:r.sent_at,amount:money(r.amount_cents),state:r.state})),mine=rows.results.find(r=>r.recipient_id===uid)
 const closed=p!.state!=='open'||p!.ends_at<=now()||recipients.length>=p!.count
 const answerPublic=p!.state!=='open'||p!.ends_at<=now()||recipients.length>(p!.hidden_winners||0)
 const hints=(p!.hints_box?JSON.parse(await unseal(ready(c),'ldc-hints:'+id,p!.hints_box)):JSON.parse(p!.hints_json)) as string[]
 const ownerAnswers=p!.owner_id===uid&&p!.answer_box?JSON.parse(await unseal(ready(c),'ldc-answer:'+id,p!.answer_box)) as string[]:null
 const draw=await packetDrawView(db,id,uid),luck=(await db.prepare('SELECT user_id,badge FROM packet_luck_wins WHERE packet_id=?').bind(id).all()).results
 return {id,draw,luck,close_kind:p!.close_kind||null,group_id:p!.group_id,mode:p!.mode,reward_type:'ldc',payment_provider:p!.payment_provider||'credit',currency:p!.payment_provider==='coin52'?'D币':'LDC',destination:p!.payment_provider==='coin52'?'wallet':p!.payment_provider==='fish'?'balance':'credit',can_play:p!.owner_id!==uid&&!(p!.count>1&&mine),response_mode:p!.response_mode,answer_length:p!.response_mode==='similarity'?p!.answer_length:null,guess_count:p!.guess_count,question_count:p!.question_count,total:money(p!.total_cents),count:p!.count,claimed_count:recipients.length,ends_at:p!.ends_at,state:closed?'closed':'open',owner:p!.owner_id===uid,
  hidden_winners:p!.hidden_winners||0,answer_public:answerPublic,guess_weights:p!.count>1&&['guess','clues'].includes(p!.mode)?JSON.parse(p!.guess_weights_json||'[10000]'):null,
  escalation:p!.escalation_every?{frozen:p!.reward_freeze_ai_count!=null,every:p!.escalation_every,step:money(p!.escalation_step_cents||0),cap:money(p!.escalation_cap_cents||0),added:money(p!.added_reward_cents||0),base:money(p!.base_total_cents||0)}:null,
  ...(ownerAnswers?{owner_answers:ownerAnswers}:{}),mine:mine?{purpose:mine.purpose,amount:money(mine.amount_cents),state:mine.state,receipt:mine.receipt_no,needs_fish_setup:p!.payment_provider==='fish'&&mine.state==='rejected'&&mine.payment_error==='RECIPIENT_NOT_FOUND',error:p!.payment_provider==='fish'?fishErrorText(mine.payment_error):null}:null,recipients,
  ...publicHintPolicy(p!),preset_hint_total:hints.length,preset_hints_remaining:closed?0:Math.max(0,hints.length-p!.hints_revealed),auto_hint_every:p!.auto_hint_every||0,hints:[...(closed?hints:p!.game_version?hints.slice(0,p!.hints_revealed):p!.mode==='clues'?hints.slice(0,Math.min(hints.length,Math.floor((now()-p!.created_at)/60)+1)):hints),...extraHints(p!.extra_hints_json).map(h=>h.text)],questions:[]}
}
export async function nativeWinnerNotice(c:C,p:NativePacket){
 if(!['guess','clues'].includes(p.mode)||p.close_kind==='force')return
 const answers=JSON.parse(await unseal(ready(c),'ldc-answer:'+p.packet_id,p.answer_box!)) as string[]
 if(p.count>1){
  const current=await c.env.DB.prepare('SELECT * FROM ldc_packets WHERE packet_id=?').bind(p.packet_id).first<NativePacket&{reward_finalized:number}>()
  if(!current)return
  const rows=(await c.env.DB.prepare(`SELECT a.slot,a.amount_cents,a.state,COALESCE(u.nick,u.name,u.username) name FROM ldc_awards a JOIN users u ON u.id=a.recipient_id WHERE packet_id=? ORDER BY slot LIMIT 10`).bind(p.packet_id).all<{slot:number;amount_cents:number;state:string;name:string}>()).results
  if(!rows.length)return
  const reveal=current.state!=='open'||current.ends_at<=now()||rows.length>(current.hidden_winners||0)
  const explanation=reveal?await c.env.DB.prepare('SELECT text FROM guess_answer_explanations WHERE packet_id=?').bind(p.packet_id).first<string>('text'):null
  const body=`猜词已猜中 ${rows.length}/${p.count} 人\n`+rows.map(r=>`${r.slot+1}. ${r.name} · ${current.escalation_every&&!current.reward_finalized?'奖励核定中':money(r.amount_cents)+' '+(p.payment_provider==='coin52'?'D币':'LDC')+' · '+(r.state==='accepted'?'已发放':r.state==='rejected'?'发放失败，名额保留':'发放中')}`).join('\n')+(reveal?'\n正确答案：'+answers[0]+(explanation?'\n答案释义：'+explanation:''):`\n答案暂时保密，第 ${(current.hidden_winners||0)+1} 人猜中后公开。`)
  await c.env.DB.prepare(`INSERT INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
   SELECT m.group_id,m.user_id,?,?,?,'ldc_winner',CAST(m.id AS TEXT) FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id
   WHERE r.id=? AND m.deleted=0 AND (SELECT count(*) FROM ldc_awards WHERE packet_id=r.id AND recipient_id IS NOT NULL)=?
   ON CONFLICT DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at WHERE chat_messages.system_kind='ldc_winner' AND chat_messages.deleted=0 AND chat_messages.body<>excluded.body`).bind(body,now(),now(),p.packet_id,rows.length).run()
  return
 }
 await c.env.DB.prepare(`INSERT INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
  SELECT m.group_id,m.user_id,COALESCE(u.nick,u.name,u.username)||' 首先猜中！'||CASE WHEN p.escalation_every>0 AND p.reward_finalized=0 THEN '中奖名额已锁定，正在核定剩余调用及最终奖励。' ELSE '奖励 '||printf('%.2f',a.amount_cents/100.0)||CASE WHEN p.payment_provider='coin52' THEN ' D币（' ELSE ' LDC（' END||CASE a.state WHEN 'accepted' THEN CASE WHEN p.payment_provider='coin52' THEN '已到账本站钱包' WHEN p.payment_provider='fish' THEN '已到账 Fish 🐟额' ELSE '平台已受理，到账以Credit为准' END WHEN 'rejected' THEN '发放失败，名额保留待发包者核对' ELSE '发放处理中，名额已锁定' END||'）。' END||'正确答案：'||?||'。本轮猜测 '||p.guess_count||' 次，提问 '||p.question_count||' 次。'||COALESCE((SELECT char(10)||'答案释义：'||text FROM guess_answer_explanations WHERE packet_id=p.packet_id AND text<>''),''),?,?, 'ldc_winner',CAST(m.id AS TEXT)
  FROM ldc_awards a JOIN ldc_packets p ON p.packet_id=a.packet_id JOIN users u ON u.id=a.recipient_id JOIN chat_redpacks r ON r.id=a.packet_id JOIN chat_messages m ON m.id=r.message_id
  WHERE a.packet_id=? AND m.deleted=0
  ON CONFLICT DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at WHERE chat_messages.system_kind='ldc_winner' AND chat_messages.deleted=0 AND chat_messages.body<>excluded.body`).bind(answers[0],now(),now(),p.packet_id).run()
}
