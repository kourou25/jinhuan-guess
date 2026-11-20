import {guessMembersSql,guessBansSql} from '../services/guess-access'
import {predictionStatements} from './predictions'
import {guessMinutes,predictionCurrency} from './standalone-rules'
import {hintPolicy,publicHintPolicy,type HintPolicy} from './hint-stage'
import type {C,User} from '../types'
import {fail} from '../lib/http'
import {now} from '../lib/time'
import {seal,unseal,cleanGame,hintInterval,extraHints} from './core'
import {ready,type NativePacket} from './packets'
import {autoContext,openAutoWord} from './auto-game'
import {ensureWordHistory,wordFingerprint,rememberWords} from './word-history'
import {sourceTable,type AiSource} from '../ai/chat-boost'
import {GUESS_REWARDS} from '../shared/guess-rewards'
import {authorOptions,sealJudgeContext,freeOwnerParticipates} from './author-options'
import {escalationOptions} from './escalation'
import {preparedAnswerReference,sealAnswerReference} from './answer-reference'
import {activeGame} from './game-store'

export async function freeCreation(c:C,b:Record<string,unknown>,u:User,id:string,gid:number){
 const key=ready(c),responseMode=String(b.response_mode??'similarity'),minutes=(()=>{try{return guessMinutes(b.minutes)}catch(e){return fail(400,(e as Error).message)}})()
 if(!['guess','clues'].includes(String(b.mode))||!['yesno','similarity'].includes(responseMode))fail(400,'无奖励模式仅支持猜词游戏')
 let every:number,policy:Required<HintPolicy>,options:ReturnType<typeof authorOptions>;try{every=hintInterval(b);policy=hintPolicy(b,every);options=authorOptions(b);predictionCurrency(b.prediction_currency)}catch(e){fail(400,(e as Error).message)}
 let game:ReturnType<typeof cleanGame>&{reference?:string}
 try{game=b.auto_word?await openAutoWord(key,autoContext(u.id,gid,String(b.nonce),0,responseMode),String(b.auto_word),now()):cleanGame(b)}catch{fail(400,b.auto_word?'自动题目已失效或参数已改变，请重新生成':'请填写有效的答案与线索')}
 await escalationOptions(c,b,u.id,0)
 if(await activeGame(c,gid))fail(409,'本群已有猜词游戏，请排队或等待本轮结束')
 const reference=game!.reference??await preparedAnswerReference(c.env,u.id,id,game!.answers,options!.context,c.req.raw.signal)
 const referenceBox=await sealAnswerReference(key,id,reference)
 const t=now(),answerBox=await seal(key,'ldc-answer:'+id,JSON.stringify(game!.answers)),hintsBox=await seal(key,'ldc-hints:'+id,JSON.stringify(game!.hints))
 const contextBox=await sealJudgeContext(key,id,options!.context)
 if(b.auto_word)await ensureWordHistory(c,gid,key)
 const hashes=await Promise.all(game!.answers.map(answer=>wordFingerprint(key,gid,answer)))
 return [
  ...predictionStatements(c.env.DB,id,b.prediction_currency,t),
  c.env.DB.prepare(`INSERT OR IGNORE INTO guess_free_rounds(packet_id,owner_id,group_id,mode,ends_at,answer_box,created_at,response_mode,answer_length,hints_box,generated,auto_hint_every,owner_participates,judge_context_box,hint_source,preset_hint_trigger,hint_cooldown_seconds,auto_hint_increment,answer_reference_box)
   SELECT r.id,?1,m.group_id,?2,?3,?4,?5,?6,?7,?8,?9,?11,?12,?13,?14,?15,?16,?17,?18 FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id
   JOIN users u ON u.id=?1 WHERE r.id=?10 AND u.disabled=0 AND u.silenced=0 AND u.kind='user'
   AND EXISTS(SELECT 1 FROM ${guessMembersSql} cm WHERE cm.user_id=u.id AND cm.group_id=m.group_id)
   AND NOT EXISTS(SELECT 1 FROM ${guessBansSql} b WHERE b.user_id=u.id AND b.group_id=m.group_id)
   AND NOT EXISTS(SELECT 1 FROM user_limits l WHERE l.user_id=u.id AND u.is_admin=0 AND l.kind='chat' AND (l.until=0 OR l.until>?5))`)
   .bind(u.id,game!.mode,t+minutes*60,answerBox,t,responseMode,[...game!.answers[0]].length,hintsBox,b.auto_word?1:0,id,every!,options!.participate?1:0,contextBox,policy!.hint_source,policy!.preset_hint_trigger,policy!.hint_cooldown_seconds,policy!.auto_hint_increment,referenceBox),
  c.env.DB.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM guess_free_rounds WHERE packet_id=?) THEN 1 ELSE json('guess_creator_changed') END").bind(id),
  c.env.DB.prepare('UPDATE guess_free_rounds SET author_rule_version=1 WHERE packet_id=? AND author_rule_version=0').bind(id),
  rememberWords(c,gid,id,t,hashes,!!b.auto_word,'guess_free_rounds'),
 ]
}
export async function freeView(c:C,p:NativePacket,uid:number){
 const closed=p.state!=='open'||p.ends_at<=now()||!!p.winner_id
 const winner=p.winner_id?await c.env.DB.prepare('SELECT COALESCE(nick,name,username) name FROM users WHERE id=?').bind(p.winner_id).first<{name:string}>():null
 const hints=JSON.parse(await unseal(ready(c),'ldc-hints:'+p.packet_id,p.hints_box!)) as string[]
 const ownerAnswers=p.owner_id===uid&&!freeOwnerParticipates(p)?JSON.parse(await unseal(ready(c),'ldc-answer:'+p.packet_id,p.answer_box!)) as string[]:null
 return {close_kind:p.close_kind||null,id:p.packet_id,group_id:p.group_id,mode:p.mode,reward_type:'none',response_mode:p.response_mode,answer_length:p.response_mode==='similarity'?p.answer_length:null,
  guess_count:p.guess_count,question_count:p.question_count,total:'0.00',count:1,claimed_count:p.winner_id?1:0,ends_at:p.ends_at,
  state:closed?'closed':'open',owner:p.owner_id===uid,can_play:p.owner_id!==uid||freeOwnerParticipates(p),...(ownerAnswers?{owner_answers:ownerAnswers}:{}),
  mine:p.winner_id===uid?{amount:'0.00',state:'won',receipt:null}:null,recipients:p.winner_id?[{user_id:p.winner_id,name:winner?.name||'群成员',amount:'0.00',state:'won'}]:[],
  ...publicHintPolicy(p),preset_hint_total:hints.length,preset_hints_remaining:closed?0:Math.max(0,hints.length-p.hints_revealed),auto_hint_every:p.auto_hint_every||0,hints:[...(closed?hints:hints.slice(0,p.hints_revealed)),...extraHints(p.extra_hints_json).map(h=>h.text)],questions:[]}
}
export async function freeWinner(c:C,p:NativePacket,u:User,source:AiSource|undefined,answer:string){
 const t=now(),db=c.env.DB
 const progress=`'累计猜中 '||b.n||' 次；'||CASE ${GUESS_REWARDS.map(r=>`WHEN b.n<${r.wins} THEN '还差 '||(${r.wins}-b.n)||' 次升级至 LV.${r.level}「${r.name}」，解锁对应称号、徽章和气泡。'`).join(' ')} ELSE '已达最高等级 LV.5「猜词王者」。' END`
 const result=await db.batch([db.prepare(`UPDATE guess_free_rounds AS p SET winner_id=?1,won_at=?2,state='closed',room_revision=room_revision+1
  WHERE packet_id=?3 AND winner_id IS NULL AND state='open' AND ends_at>?2 AND (owner_id<>?1 OR (generated=1 AND owner_participates=1))
  AND EXISTS(SELECT 1 FROM users u JOIN ${guessMembersSql} cm ON cm.user_id=u.id WHERE u.id=?1 AND u.disabled=0 AND u.silenced=0 AND u.kind='user' AND cm.group_id=p.group_id)
  AND NOT EXISTS(SELECT 1 FROM ${guessBansSql} WHERE group_id=p.group_id AND user_id=?1)
  AND NOT EXISTS(SELECT 1 FROM user_limits l JOIN users u ON u.id=l.user_id WHERE l.user_id=?1 AND u.is_admin=0 AND l.kind='chat' AND (l.until=0 OR l.until>?2))
  AND EXISTS(SELECT 1 FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id WHERE r.id=p.packet_id AND m.deleted=0)
  AND (?4=0 OR EXISTS(SELECT 1 FROM ${sourceTable(source)} s WHERE s.id=?4 AND s.body=?5 AND s.deleted=0 AND s.user_id=?1 AND s.group_id=p.group_id)) RETURNING winner_id`)
  .bind(u.id,t,p.packet_id,source?.id||0,source?.body||''),
  db.prepare(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
   SELECT p.group_id,p.winner_id,COALESCE(u.nick,u.name,u.username)||' 首先猜中！本轮不设 LDC 奖励。'||${progress}||' 正确答案：'||?||'。本轮猜测 '||p.guess_count||' 次，提问 '||p.question_count||' 次。',?,?,'ldc_winner',CAST(r.message_id AS TEXT)
   FROM guess_free_rounds p JOIN chat_redpacks r ON r.id=p.packet_id JOIN users u ON u.id=p.winner_id JOIN user_badges b ON b.user_id=u.id AND b.badge='guess'
   WHERE p.packet_id=? AND p.winner_id=?`).bind(answer,t,t,p.packet_id,u.id),
  db.prepare('UPDATE chat_messages SET updated_at=? WHERE id=(SELECT message_id FROM chat_redpacks WHERE id=?)').bind(t,p.packet_id),
 ])
 const winner=result[0].results[0] as {winner_id:number}|undefined||await db.prepare('SELECT winner_id FROM guess_free_rounds WHERE packet_id=?').bind(p.packet_id).first<{winner_id:number}>()
 if(winner?.winner_id!==u.id)fail(409,'已有人率先猜中，或本轮已结束')
}
