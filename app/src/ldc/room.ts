import {guessAdmissionSql,rejectPendingGuess} from './submission-guard'
import {publicGuessParticipants} from '../games/guess-participants'
import {guessMembersSql,guessBansSql} from '../services/guess-access'
import {standaloneView} from './standalone-view'
import {attachLuckybag} from '../games/guess-luckybag'
import {guessAnnouncements} from './announcements'
import {closeVoteView} from './cancel'
import type {C,User} from '../types'
import {fail} from '../lib/http'
import {now} from '../lib/time'
import {nativeView,ready,type NativePacket} from './packets'
import {unseal,money} from './core'
import {gameTables,gameStores,loadGame} from './game-store'
import {nextStageHintAt} from './hint-stage'
import {winrateView} from './winrate'
import {characterMatches} from './character-matches'
import {canManageAi} from '../services/auth'
import {styleRules,styleMatches} from '../games/style-rules'

type Entry={id:number;body:string;user_id:number;name:string;avatar:string|null;created_at:number;updated_at:number;deleted:number;ai_text:string|null;ai_score:number|null;ai_status:string|null}
type SummaryEntry={id:string;user_id:number;question:string;verdict:string;score:number;created_at:number;avatar:string|null;users_json:string;participant_count:number;review_state:string|null}
type LatestEntry={id:number;text:string;question:string;name:string;avatar:string|null}
const publicEntry=(r:Entry)=>({id:r.id,body:r.deleted?'':r.body,user:{id:r.user_id,name:r.name,avatar:r.avatar},created_at:r.created_at,updated_at:r.updated_at,deleted:!!r.deleted,reply:!r.deleted&&r.ai_status?{text:r.ai_text,status:r.ai_status,score:r.ai_score}:null})
const entrySelect=`SELECT e.*,COALESCE(u.nick,u.name,u.username) AS name,u.avatar FROM guess_room_messages e LEFT JOIN users u ON u.id=e.user_id`
const integer=(s:string|undefined)=>{if(s===undefined)return 0;if(!/^\d{1,16}$/.test(s)||!Number.isSafeInteger(Number(s)))fail(400,'游标无效');return Number(s)}
const encode=(v:unknown)=>btoa(JSON.stringify(v))
function decode(s:string|undefined,size:number,idPattern=/^[-a-f0-9]{36}$/i){if(!s)return null;try{if(s.length>200)throw Error();const v=JSON.parse(atob(s));if(!Array.isArray(v)||v.length!==size||v.some((x,i)=>i===size-1?typeof x!=='string'||!idPattern.test(x):!Number.isSafeInteger(x)||x<0))throw Error();return v}catch{fail(400,'分页游标无效')}}

export async function guessStatsView(c:C,gid:number,uid:number){
 const period=c.req.query('period')==='all'?'all':'today',today=new Date((now()+28800)*1000).toISOString().slice(0,10),day=period==='all'?'*':today
 const [totals,ranks,mine]=await Promise.all([
  c.env.DB.prepare("SELECT day,rounds,wins FROM guess_group_stats WHERE group_id=? AND day IN ('*',?)").bind(gid,today).all<{day:string;rounds:number;wins:number}>(),
  c.env.DB.prepare(`SELECT s.user_id,s.wins,COALESCE(u.nick,u.name,u.username) AS name,u.avatar
    FROM guess_group_player_stats s INDEXED BY idx_guess_group_rank JOIN users u ON u.id=s.user_id
    WHERE s.group_id=? AND s.day=? AND u.kind='user' AND u.disabled=0
    ORDER BY s.wins DESC,s.last_at ASC,s.user_id LIMIT 20`).bind(gid,day).all<{user_id:number;wins:number;name:string;avatar:string|null}>(),
  c.env.DB.prepare('SELECT wins,last_at FROM guess_group_player_stats WHERE group_id=? AND day=? AND user_id=?').bind(gid,day,uid).first<{wins:number;last_at:number}>(),
 ])
 const byDay=Object.fromEntries(totals.results.map(row=>[row.day,{rounds:row.rounds,wins:row.wins}]))
 let mineRank=mine?.wins?ranks.results.findIndex(row=>row.user_id===uid)+1:0
 if(mine?.wins&&!mineRank){
  const before=await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM guess_group_player_stats INDEXED BY idx_guess_group_rank
    WHERE group_id=? AND day=? AND (wins>? OR (wins=? AND (last_at<? OR (last_at=? AND user_id<?))))`)
    .bind(gid,day,mine.wins,mine.wins,mine.last_at,mine.last_at,uid).first<{n:number}>()
  mineRank=(before?.n||0)+1
 }
 return {period,today,totals:{today:byDay[today]||{rounds:0,wins:0},all:byDay['*']||{rounds:0,wins:0}},leaders:ranks.results,mine:mine?.wins||0,mineRank,winrate:await winrateView(c,gid,uid,day)}
}

export async function guessRoomView(c:C,gid:number,uid:number,joinedAt:number){
 const data=await guessRoomViewBase(c,gid,uid,joinedAt)
 return ['overview','result'].includes(c.req.query('view')||'chat')?attachLuckybag(c,data,uid):data
}
async function guessRoomViewBase(c:C,gid:number,uid:number,joinedAt:number){
 const mid=integer(c.req.query('message_id')),view=c.req.query('view')||'chat'
 if(view==='announcements')return guessAnnouncements(c,gid,joinedAt)
 if(view==='participants'){
  const p=await loadGame(c,gid,mid),offset=integer(c.req.query('offset'));if(offset>50000)fail(400,'名单分页无效')
  return p?publicGuessParticipants(c.env.DB,p.packet_id,gameTables(p).questions,p.owner_id,p.message_id,offset):{message_id:null,total:0,items:[],next:null}
 }
 if(!['chat','guesses','facts','negative','unknown','not_question','overview','history','result'].includes(view))fail(400,'专区视图无效')
 if(view==='history'){
  const cursor=decode(c.req.query('cursor'),2,/^[a-f0-9]{64}$/i)
  const batches=await Promise.all(gameStores.map(store=>c.env.DB.prepare(`SELECT p.packet_id,p.created_at,p.ends_at,${store.total} AS total_cents,'${store.reward}' AS reward_type,${store.reward==='none'?"'credit'":'p.payment_provider'} AS payment_provider,p.guess_count,p.question_count,
   m.id AS message_id,COALESCE(u.nick,u.name,u.username) AS owner_name FROM ${store.rounds} p INDEXED BY ${store.history}
   JOIN chat_redpacks r ON r.id=p.packet_id JOIN chat_messages m ON m.id=r.message_id LEFT JOIN users u ON u.id=p.owner_id
   WHERE p.group_id=? AND p.mode IN ('guess','clues') AND m.deleted=0 AND NOT (${store.open})
   ${cursor?'AND (p.created_at,p.packet_id)<(?,?)':''} ORDER BY p.created_at DESC,p.packet_id DESC LIMIT 13`)
   .bind(gid,now(),...cursor||[]).all<{packet_id:string;created_at:number;ends_at:number;total_cents:number;guess_count:number;question_count:number;message_id:number;owner_name:string;reward_type:string;payment_provider:string}>()))
  const rows={results:batches.flatMap(b=>b.results).sort((a,b)=>b.created_at-a.created_at||b.packet_id.localeCompare(a.packet_id))}
  const page=rows.results.slice(0,12),last=page.at(-1)
  return {items:page.map(({packet_id,total_cents,...r})=>({...r,total:money(total_cents),currency:r.payment_provider==='coin52'?'D币':'LDC'})),next:rows.results.length>12&&last?encode([last.created_at,last.packet_id]):null,now:now()}
 }
 const p=await loadGame(c,gid,mid)
 if(!p)return {round:null,items:[],next:null,now:now()}
 const packetId=p.packet_id,tables=gameTables(p),rewardType=p.reward_type==='none'?'none':'ldc'
 const state=await nativeView(c,p.packet_id,uid,p)
 // 仅已结束轮次的展开概览公开答案；轮次列表不解密，进行中永不返回。
 const protectedMulti=p.count>1&&p.reward_type!=='none'&&!('answer_public' in state&&state.answer_public)
 const answer=['overview','result'].includes(view)&&(state.state==='closed'||'answer_public' in state&&state.answer_public)&&p.answer_box?JSON.parse(await unseal(ready(c),'ldc-answer:'+p.packet_id,p.answer_box))[0] as string:null
 const renderEntry=(r:Entry)=>protectedMulti&&r.user_id!==uid&&r.user_id!==p.owner_id&&(r.ai_status!=='done'||r.ai_score===100)?{...publicEntry(r),body:'本条答案暂时保密',reply:{text:r.ai_score===100?'已猜中，等待公布答案':'正在判定',status:r.ai_status,score:null}}:publicEntry(r)
 const hiddenWinners=protectedMulti?state.recipients.filter((r:any)=>!r.purpose||r.purpose==='winner').map((r:any)=>({id:'winner-'+r.user_id,question:'已猜中，答案保密',verdict:'correct',score:100,hidden_answer:true,created_at:0,users:[{id:r.user_id,avatar:r.avatar,name:r.name}],participant_count:1,user:{id:r.user_id,avatar:r.avatar,name:r.name}})):[]
 const explanation=answer?await c.env.DB.prepare('SELECT text FROM guess_answer_explanations WHERE packet_id=?').bind(packetId).first<string>('text'):null
 const round={...state,close_vote:await closeVoteView(c,p,uid),answer,explanation,message_id:p.message_id,owner_id:p.owner_id,owner_name:p.owner_name,ai_count:p.ai_count,ai_limit:300,ai_generated:!!p.generated,hint_progress:p.guess_count+p.question_count,next_hint_guess:state.state==='closed'||p.hint_source==='preset'&&p.hints_revealed>=state.preset_hint_total?null:nextStageHintAt(p)??(p.auto_hint_every?(Math.floor((p.guess_count+p.question_count)/p.auto_hint_every)+1)*p.auto_hint_every:null)}
 if(view==='result')return {round:{message_id:p.message_id,state:state.state,close_kind:p.close_kind||null,reward_type:state.reward_type,currency:p.payment_provider==='coin52'?'D币':'LDC',payment_provider:p.payment_provider||'credit',answer,explanation,total:state.total,guess_count:p.guess_count,question_count:p.question_count,recipients:state.recipients},now:now()}
 const matchAnswer=['overview','guesses'].includes(view)&&p.answer_box?(answer??JSON.parse(await unseal(ready(c),'ldc-answer:'+p.packet_id,p.answer_box))[0] as string):''
 const reviewRules=['overview','guesses'].includes(view)&&canManageAi(c,c.get('user'))?await styleRules(c.env):[]
 async function conversation(){
  const after=integer(c.req.query('after')),before=integer(c.req.query('before')),since=integer(c.req.query('since')),changedAt=integer(c.req.query('changed_at')),changedId=integer(c.req.query('changed_id'))
  const rows=await c.env.DB.prepare(`${entrySelect} WHERE e.packet_id=? AND e.created_at>=? ${after?'AND e.id>?':before?'AND e.id<?':''} ORDER BY e.id ${after?'ASC':'DESC'} LIMIT 41`).bind(packetId,joinedAt,...after?[after]:before?[before]:[]).all<Entry>()
  const page=rows.results.slice(0,40),items=(after?page:page.reverse()).map(renderEntry)
  const updates=after&&since?(await c.env.DB.prepare(`${entrySelect} WHERE e.packet_id=? AND e.created_at>=? AND e.updated_at>=? AND e.id<=? ${changedAt?'AND (e.updated_at,e.id)>(?,?)':''} ORDER BY e.updated_at,e.id LIMIT 101`).bind(packetId,joinedAt,since,after,...changedAt?[changedAt,changedId]:[]).all<Entry>()).results:[]
  const last=updates[99]
  return {round,items,changed:updates.slice(0,100).map(renderEntry),changed_next:updates.length>100?{at:last.updated_at,id:last.id}:null,next:rows.results.length>40?(after?items.at(-1)?.id:items[0]?.id):null,now:now()}
 }
 function prepareSummary(kind:'guesses'|'facts'|'negative'|'unknown'|'not_question',limit=40){
 const scored=kind==='guesses',cursor=decode(c.req.query(view==='overview'?kind+'_cursor':'cursor'),scored?3:2)
 const live=`EXISTS(SELECT 1 FROM users v JOIN ${guessMembersSql} cm ON cm.user_id=v.id WHERE v.id=q.user_id AND cm.group_id=? AND v.disabled=0
   AND NOT EXISTS(SELECT 1 FROM ${guessBansSql} b WHERE b.group_id=cm.group_id AND b.user_id=v.id))
  AND ((q.source_room_id IS NOT NULL AND EXISTS(SELECT 1 FROM guess_room_messages s WHERE s.id=q.source_room_id AND s.created_at>=${joinedAt} AND s.deleted=0 AND s.body=q.source_body AND s.user_id=q.user_id))
   OR (q.source_room_id IS NULL AND EXISTS(SELECT 1 FROM chat_messages s WHERE s.id=q.source_message_id AND s.created_at>=${joinedAt} AND s.deleted=0 AND s.body=q.source_body AND s.user_id=q.user_id)))`
 // Reuse this request's visibility-filtered rows for ranking and both participant
 // aggregates. Inlining repeats member/source checks for each output candidate.
 const statement=c.env.DB.prepare(`WITH eligible AS MATERIALIZED (
  SELECT q.*,u.avatar,CASE WHEN instr(q.cache_key,':')>0 THEN substr(q.cache_key,instr(q.cache_key,':')+1) ELSE q.kind||':'||lower(trim(q.question)) END AS display_key
  FROM ${tables.questions} q LEFT JOIN users u ON u.id=q.user_id WHERE q.packet_id=? AND q.kind='${scored?'guess':'question'}' AND (q.score IS NOT NULL OR q.verdict IN ('yes','no','unknown','not_question')) ${protectedMulti?"AND COALESCE(q.score,0)<100 AND q.verdict<>'correct'":''} AND ${live}
 ), ranked AS (SELECT *,row_number() OVER(PARTITION BY display_key ORDER BY created_at DESC,id DESC) AS rn FROM eligible)
 SELECT q.id,q.user_id,q.question,q.verdict,q.score,q.created_at,q.avatar,
  (SELECT count(DISTINCT e.user_id) FROM eligible e WHERE e.display_key=q.display_key) AS participant_count,
  (SELECT json_group_array(json_object('id',v.user_id,'avatar',v.avatar)) FROM (SELECT e.user_id,e.avatar,max(e.created_at) AS last_at FROM eligible e WHERE e.display_key=q.display_key GROUP BY e.user_id ORDER BY last_at DESC,e.user_id LIMIT 5) v) AS users_json,
  (SELECT r.state FROM guess_review_items r WHERE r.packet_id=q.packet_id AND r.reward_type='${rewardType}' AND r.cache_key=q.cache_key AND r.state IN ('verified','corrected','uncertain') AND r.verdict=q.verdict AND r.score IS q.score) AS review_state
  FROM ranked q WHERE q.rn=1 AND ${scored?'q.score IS NOT NULL':`q.verdict='${kind==='negative'?'no':kind==='facts'?'yes':kind}'`}
  ${cursor?`AND (${scored?'q.score,':''}q.created_at,q.id)<(${cursor.map(()=>'?').join(',')})`:''}
  ORDER BY ${scored?'q.score DESC,':''}q.created_at DESC,q.id DESC LIMIT ?`).bind(packetId,gid,...cursor||[],limit+1)
 return {statement,finish:(rows:SummaryEntry[])=>{
 const page=rows.slice(0,limit),last=page.at(-1)
 return {round,items:[...(scored&&!cursor?hiddenWinners:[]),...page.map(r=>({id:r.id,question:r.question,...(scored?{character_matches:characterMatches(r.question,matchAnswer),...(reviewRules.length?{ai_style_hint:styleMatches(r.question,reviewRules)}:{})}:{}),verdict:r.verdict,score:r.score,review_state:r.review_state,created_at:r.created_at,users:JSON.parse(r.users_json),participant_count:r.participant_count,user:{id:r.user_id,avatar:r.avatar}}))],next:rows.length>limit&&last?encode(scored?[last.score,last.created_at,last.id]:[last.created_at,last.id]):null,now:now()}
 }}
 }
 if(view==='chat')return conversation()
 if(view!=='overview'){
  const summary=prepareSummary(view as 'guesses'|'facts'|'negative'|'unknown'|'not_question')
  return summary.finish((await summary.statement.all<SummaryEntry>()).results)
 }
 const receiptId=integer(c.req.query('receipt_id'))
 const summaries=[prepareSummary('guesses',20),prepareSummary('facts',12),prepareSummary('negative',12)]
 if(c.req.query('extra')==='1')summaries.push(prepareSummary('unknown',12),prepareSummary('not_question',12))
 const statements=summaries.map(summary=>summary.statement)
 const receiptIndex=receiptId?statements.push(c.env.DB.prepare(`${entrySelect} WHERE e.id=? AND e.packet_id=? AND e.user_id=? AND e.created_at>=?`).bind(receiptId,packetId,uid,joinedAt))-1:-1
 const latestIndex=state.state==='open'?statements.push(c.env.DB.prepare(`
  SELECT e.id,e.ai_text AS text,q.question,u.avatar,COALESCE(u.nick,u.name,u.username) AS name FROM
  (SELECT id,body,user_id,deleted,ai_status,ai_text,updated_at FROM guess_room_messages WHERE packet_id=? AND created_at>=? ORDER BY updated_at DESC,id DESC LIMIT 8) e
  JOIN ${tables.questions} q ON q.source_room_id=e.id AND q.source_body=e.body AND q.user_id=e.user_id
  JOIN users u ON u.id=e.user_id AND u.disabled=0 JOIN ${guessMembersSql} cm ON cm.user_id=u.id AND cm.group_id=?
  WHERE e.deleted=0 AND e.ai_status='done' ${protectedMulti?"AND COALESCE(q.score,0)<100 AND q.verdict<>'correct'":''} AND NOT EXISTS(SELECT 1 FROM ${guessBansSql} b WHERE b.group_id=cm.group_id AND b.user_id=u.id)
  ORDER BY e.updated_at DESC,e.id DESC LIMIT 1`).bind(packetId,joinedAt,gid))-1:-1
 // 同一次概览的原有 SQL 合批；权限谓词、分页和读取范围保持一致。
 const results=await c.env.DB.batch<SummaryEntry|Entry|LatestEntry>(statements)
 const [guesses,facts,negative,unknown,notQuestion]=summaries.map((summary,index)=>summary.finish(results[index].results as SummaryEntry[]))
 const receipt=receiptIndex<0?null:(results[receiptIndex].results[0] as Entry|undefined)||null
 const latest=latestIndex<0?null:(results[latestIndex].results[0] as LatestEntry|undefined)||null
 const extension=await standaloneView(c,p,uid,state)
 const participants=await c.env.DB.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM (SELECT user_id FROM ${tables.questions} WHERE packet_id=? UNION ALL SELECT user_id FROM guess_room_messages WHERE packet_id=? AND deleted=0) WHERE user_id<>?`).bind(packetId,packetId,p.owner_id).first<{n:number}>()
 return {round:{...round,...extension,participant_count:participants?.n??0},guesses:{items:guesses.items,next:guesses.next},facts:{items:facts.items,next:facts.next},negative:{items:negative.items,next:negative.next},...(unknown?{unknown:{items:unknown.items,next:unknown.next},not_question:{items:notQuestion.items,next:notQuestion.next}}:{}),receipt:receipt?publicEntry(receipt):null,latest,now:now()}
}

export async function createRoomEntry(c:C,p:NativePacket,u:User,b:Record<string,unknown>){
 if(!['guess','clues'].includes(p.mode))fail(400,'这不是猜词游戏')
 if(p.count>1&&await c.env.DB.prepare('SELECT 1 FROM ldc_awards WHERE packet_id=? AND recipient_id=?').bind(p.packet_id,u.id).first())fail(409,'你已猜中并锁定奖励，本轮无需重复参与')
 const tables=gameTables(p)
 const body=String(b.body??'').replace(/\r/g,'').trim(),nonce=String(b.nonce??'')
 if(!body||body.length>1000||!/^[-a-f0-9]{36}$/i.test(nonce))fail(400,'请输入1000字以内的内容及有效请求编号')
 const existing=await c.env.DB.prepare('SELECT id,body FROM guess_room_messages WHERE packet_id=? AND user_id=? AND nonce=?').bind(p.packet_id,u.id,nonce).first<{id:number;body:string}>()
 if(existing){if(existing.body!==body)fail(409,'请求编号已用于另一条发言');return {id:existing.id,body,created:false}}
 const row=await c.env.DB.prepare(`INSERT INTO guess_room_messages(packet_id,group_id,user_id,nonce,body,created_at,updated_at)
  SELECT p.packet_id,p.group_id,?2,?3,?4,?5,?5 FROM ${tables.rounds} p JOIN users u ON u.id=?2 WHERE p.packet_id=?1 AND ${tables.open}
  AND u.disabled=0 AND u.silenced=0 AND u.kind='user'
  AND EXISTS(SELECT 1 FROM ${guessMembersSql} cm WHERE cm.group_id=p.group_id AND cm.user_id=?2)
  AND NOT EXISTS(SELECT 1 FROM ${guessBansSql} b WHERE b.group_id=p.group_id AND b.user_id=?2)
  AND NOT EXISTS(SELECT 1 FROM user_limits l WHERE l.user_id=?2 AND u.is_admin=0 AND l.kind='chat' AND (l.until=0 OR l.until>?5))
  AND ${guessAdmissionSql(tables.questions,'?2','?5')}
  ON CONFLICT(packet_id,user_id,nonce) DO NOTHING RETURNING id`).bind(p.packet_id,u.id,nonce,body,now(),now()).first<{id:number}>()
 if(!row){const retry=await c.env.DB.prepare('SELECT id,body FROM guess_room_messages WHERE packet_id=? AND user_id=? AND nonce=?').bind(p.packet_id,u.id,nonce).first<{id:number;body:string}>();if(retry?.body===body)return {...retry,created:false};await rejectPendingGuess(c,p,u);fail(409,'本轮已结束或当前账号不能发言')}
 return {id:row!.id,body,created:true}
}
