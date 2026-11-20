import {guessMembersSql,guessBansSql} from '../services/guess-access'
import {guessMinutes,predictionCurrency} from './standalone-rules'
import {Context} from 'hono'
import type {C,Ctx,User} from '../types'
import type {Env} from '../env'
import {fail} from '../lib/http'
import {sha256} from '../lib/crypto'
import {now} from '../lib/time'
import {seal,unseal,cleanGame,cents,rewardCents,hintInterval} from './core'
import {hintPolicy} from './hint-stage'
import {authorOptions} from './author-options'
import {selectedWordLength,autoContext,sealAutoWord} from './auto-game'
import {generateWordCandidate,WORD_GENERATION_BUDGET_MS} from './word-generator'
import {ensureWordHistory,wordSeen,wordFingerprint} from './word-history'
import {nativeCreation,ready,identity} from './packets'
import {multiwinnerOptions} from './multiwinner'
import {activeGame} from './game-store'
import {authorPolicy,escalationOptions} from './escalation'
import {checkFishCapacity} from './fish-capacity'
import {fundingAccount,fundingProvider} from './funding'

type QueueRow={id:string;group_id:number;owner_id:number;state:string;ticket:number|null;config_box:string;lease:string;message_id:number|null}
const accessible=`EXISTS(SELECT 1 FROM users u JOIN ${guessMembersSql} cm ON cm.user_id=u.id WHERE u.id=q.owner_id AND cm.group_id=q.group_id AND u.disabled=0 AND u.silenced=0 AND u.kind='user'
 AND NOT EXISTS(SELECT 1 FROM ${guessBansSql} b WHERE b.user_id=u.id AND b.group_id=q.group_id)
 AND NOT EXISTS(SELECT 1 FROM user_limits l WHERE l.user_id=u.id AND u.is_admin=0 AND l.kind='chat' AND (l.until=0 OR l.until>unixepoch())))`
const noGame=`NOT EXISTS(SELECT 1 FROM ldc_packets p WHERE p.group_id=q.group_id AND p.mode IN('guess','clues') AND p.state='open' AND p.ends_at>unixepoch() AND (SELECT count(*) FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.recipient_id IS NOT NULL)<p.count)
 AND NOT EXISTS(SELECT 1 FROM guess_free_rounds p WHERE p.group_id=q.group_id AND p.state='open' AND p.ends_at>unixepoch() AND p.winner_id IS NULL)`
const configKeys=['prediction_currency','provider','payment_provider','mode','response_mode','answers','hints','judge_context','owner_participates','amount','count','guess_winners','hidden_winners','minutes','auto_hint_every','auto_hint_increment','hint_source','preset_hint_trigger','hint_cooldown_seconds','answer_source','answer_length','prompt','cover_key','escalation_every','escalation_amount','escalation_cap']
async function validate(c:C,u:User,gid:number,input:Record<string,unknown>){
 const b=Object.fromEntries(configKeys.filter(k=>Object.hasOwn(input,k)).map(k=>[k,input[k]]))
 if(b.mode!=='guess'||!['ldc','free_guess'].includes(String(b.provider)))fail(400,'仅猜词支持草稿和排队')
 const automatic=b.answer_source==='auto',total=b.provider==='ldc'?rewardCents(b.amount,fundingProvider(b)):0
 if(!['manual','auto'].includes(String(b.answer_source??'manual')))fail(400,'出题方式无效')
 const minutes=guessMinutes(b.minutes);b.minutes=minutes;predictionCurrency(b.prediction_currency)
 if(!['yesno','similarity'].includes(String(b.response_mode??'similarity')))fail(400,'猜词回答模式无效')
 const inputOptions={...b,auto_word:automatic?'pending':undefined}
 hintPolicy(inputOptions,hintInterval(b));authorOptions(inputOptions)
 if(total){try{multiwinnerOptions(b,total,fundingProvider(b)==='coin52'?100:1)}catch(e){fail(400,(e as Error).message)}}
 if(automatic)selectedWordLength(b.answer_length);else cleanGame(b)
 if(String(b.prompt??'').length>120)fail(400,'介绍最多120字')
 const ok=await c.env.DB.prepare(`SELECT 1 FROM users u JOIN ${guessMembersSql} cm ON cm.user_id=u.id WHERE u.id=?1 AND cm.group_id=?2 AND u.disabled=0 AND u.silenced=0 AND u.kind='user'
 AND NOT EXISTS(SELECT 1 FROM ${guessBansSql} WHERE user_id=?1 AND group_id=?2)
 AND NOT EXISTS(SELECT 1 FROM user_limits WHERE user_id=?1 AND u.is_admin=0 AND kind='chat' AND (until=0 OR until>unixepoch()))`).bind(u.id,gid).first()
 if(!ok)fail(403,'账号当前不可发起群聊游戏')
 if(total){if(fundingProvider(b)!=='coin52')await identity(c,u.id);await fundingAccount(c,u.id,fundingProvider(b))}
 if(b.cover_key&&!await c.env.DB.prepare("SELECT 1 FROM uploads WHERE key=? AND user_id=? AND used=0 AND mime LIKE 'image/%'").bind(String(b.cover_key),u.id).first())fail(400,'封面已失效，请重新上传')
 await escalationOptions(c,b,u.id,total)
 return {b,total,automatic}
}
export async function saveGuessQueue(c:C,u:User,gid:number,input:Record<string,unknown>){
 const action=String(input.action),nonce=String(input.nonce??'')
 if(!['queue','draft'].includes(action)||!/^[-a-zA-Z0-9]{16,64}$/.test(nonce))fail(400,'保存方式或请求编号无效')
 if(!input.config||typeof input.config!=='object'||Array.isArray(input.config))fail(400,'猜词配置无效')
 const id=await sha256(`guess-queue:${u.id}:${gid}:${nonce}`),prior=await c.env.DB.prepare('SELECT id,state FROM guess_queue WHERE id=?').bind(id).first()
 if(prior)return prior
 let data:Awaited<ReturnType<typeof validate>>;try{data=await validate(c,u,gid,input.config as Record<string,unknown>)}catch(e){if(e instanceof Error&&'status'in e)throw e;fail(400,e instanceof Error?e.message:'配置无效')}
 const state=action==='queue'?'queued':'draft',box=await seal(ready(c),'guess-queue:'+id,JSON.stringify(data!.b)),t=now()
 const added=await c.env.DB.prepare(`INSERT OR IGNORE INTO guess_queue(id,group_id,owner_id,state,ticket,config_box,reward_type,amount_cents,automatic,created_at,updated_at,payment_provider)
 SELECT ?1,?2,?3,?4,CASE WHEN ?4='queued' THEN (SELECT COALESCE(MAX(ticket),0)+1 FROM guess_queue WHERE group_id=?2) END,?5,?6,?7,?8,?9,?9,?10
 WHERE (SELECT COUNT(*) FROM guess_queue WHERE owner_id=?3 AND group_id=?2 AND state IN('draft','queued','starting'))<20
 AND (?4='draft' OR (SELECT COUNT(*) FROM guess_queue WHERE group_id=?2 AND state IN('queued','starting'))<50)
 RETURNING id,state`).bind(id,gid,u.id,state,box,data!.total?'ldc':'none',data!.total,data!.automatic?1:0,t,fundingProvider(data!.b)).first()
 if(!added){const existing=await c.env.DB.prepare('SELECT id,state FROM guess_queue WHERE id=?').bind(id).first();if(existing)return existing;fail(409,'待处理配置已达上限，请删除旧草稿或等待队列')}
 return added
}
export async function guessQueueList(c:C,gid:number,uid:number){
 const [rows,mine,active,policy]=await Promise.all([
  c.env.DB.prepare(`SELECT q.id,q.owner_id,q.state,q.ticket,q.reward_type,q.amount_cents,q.payment_provider,q.automatic,COALESCE(u.nick,u.name,u.username) owner_name FROM guess_queue q INDEXED BY idx_guess_queue_group JOIN users u ON u.id=q.owner_id WHERE q.group_id=? AND q.state IN('queued','starting') ORDER BY q.ticket LIMIT 50`).bind(gid).all(),
  c.env.DB.prepare(`SELECT id,state,reward_type,amount_cents,payment_provider,automatic,error,message_id,created_at FROM guess_queue WHERE owner_id=? AND group_id=? AND state IN('draft','failed') ORDER BY seq DESC LIMIT 20`).bind(uid,gid).all(),activeGame(c,gid),authorPolicy(c.env,uid),
 ])
 return {queue:rows.results.map(r=>({...r,mine:r.owner_id===uid})),mine:mine.results,active:!!active,author_policy:policy}
}
export async function queueDetail(c:C,gid:number,uid:number,id:string){
 const row=await c.env.DB.prepare('SELECT * FROM guess_queue WHERE id=? AND group_id=? AND owner_id=?').bind(id,gid,uid).first<QueueRow>()
 if(!row)fail(404,'配置不存在')
 return {id,state:row!.state,config:JSON.parse(await unseal(ready(c),'guess-queue:'+id,row!.config_box))}
}
export async function cancelQueued(c:C,gid:number,uid:number,id:string){
 const row=await c.env.DB.prepare("UPDATE guess_queue SET state='cancelled',updated_at=? WHERE id=? AND group_id=? AND owner_id=? AND state IN('draft','queued','failed') RETURNING id").bind(now(),id,gid,uid).first()
 if(!row)fail(404,'配置不存在或已开始开局，不能取消')
 return {cancelled:true}
}
// 每分钟仅处理有待办的群；空队列一次索引查询。单群租约+现有单局触发器共同保护。
export async function runGuessQueue(env:Env,gid?:number){
 if(!env.LDC_ENCRYPTION_KEY)return
 const db=env.DB,t=now(),c=new Context<Ctx>(new Request('https://queue.internal/'),{env})
 const groups=gid?[{group_id:gid}]:(await db.prepare(`SELECT DISTINCT q.group_id FROM guess_queue q WHERE q.state IN('queued','starting') AND ${noGame}
  AND NOT EXISTS(SELECT 1 FROM guess_queue busy WHERE busy.group_id=q.group_id AND busy.state='starting' AND busy.lease_until>?)
  ORDER BY q.group_id LIMIT 8`).bind(t).all<{group_id:number}>()).results
 for(const group of groups){
  if(await activeGame(c,group.group_id))continue
  const lease=crypto.randomUUID()
  const q=await db.prepare(`UPDATE guess_queue AS q SET state='starting',lease=?1,lease_until=?2,updated_at=?3
   WHERE id=(SELECT id FROM guess_queue INDEXED BY idx_guess_queue_group WHERE group_id=?4 AND state IN('queued','starting') ORDER BY ticket LIMIT 1)
   AND (state='queued' OR lease_until<=?3) AND ${noGame} RETURNING *`).bind(lease,t+120,t,group.group_id).first<QueueRow>()
  if(!q)continue
  try{
   const original=JSON.parse(await unseal(env.LDC_ENCRYPTION_KEY,'guess-queue:'+q.id,q.config_box)) as Record<string,unknown>
   const u=await db.prepare('SELECT * FROM users WHERE id=?').bind(q.owner_id).first<User>();if(!u)throw Error('发起者账号已失效')
   const {b,total,automatic}=await validate(c,u,q.group_id,original),id='queue-'+q.id
   if(total&&fundingProvider(b)==='fish'){const escalation=await escalationOptions(c,b,u.id,total);await checkFishCapacity(c,await fundingAccount(c,u.id,'fish'),total+escalation.cap)}
   b.nonce=q.id
   if(automatic){
    await ensureWordHistory(c,q.group_id,ready(c));const rejected:string[]=[];let game:ReturnType<typeof cleanGame>|undefined
    const deadline=Date.now()+WORD_GENERATION_BUDGET_MS
    for(let n=0;n<2&&Date.now()<deadline-1000;n++){
     const candidate=await generateWordCandidate(env,u.id,deadline-Date.now(),rejected,undefined,selectedWordLength(b.answer_length))
     if(await wordSeen(c,q.group_id,await wordFingerprint(ready(c),q.group_id,candidate.answers[0]))){rejected.push(candidate.answers[0]);continue}
     game=candidate;break
    }
    if(!game)throw Error('AI题目与历史重复，请重新排队')
    b.auto_word=await sealAutoWord(ready(c),autoContext(u.id,q.group_id,q.id,total,String(b.response_mode??'similarity')),game,now()+900)
   }
   const statements=await nativeCreation(c,b,u,id,q.group_id),at=now(),cover=b.cover_key?String(b.cover_key):null
   await db.batch([
    db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM guess_queue q WHERE id=? AND state='starting' AND lease=? AND lease_until>? AND ${accessible}) THEN 1 ELSE json('guess_queue_lease_changed') END`).bind(q.id,lease,at),
    db.prepare("SELECT CASE WHEN ? IS NULL OR EXISTS(SELECT 1 FROM uploads WHERE key=? AND user_id=? AND used=0 AND mime LIKE 'image/%') THEN 1 ELSE json('guess_queue_cover_changed') END").bind(cover,cover,u.id),
    db.prepare("INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,redpack_id,image_key) VALUES(?,?,'[红包]',?,?,?,?)").bind(q.group_id,q.owner_id,at,at,id,cover),
    db.prepare(`INSERT OR IGNORE INTO chat_redpacks(id,message_id,secret,mode,game,prompt,phrase,post_id,image_index,mask,provider,external_ref,external_kind)
     SELECT ?,id,?,'open',?,?,'',NULL,0,4,'native','','' FROM chat_messages WHERE redpack_id=? AND deleted=0`).bind(id,total?'LDC红包奖励':'无奖励猜词',total?'ldc':'free_guess',String(b.prompt??''),id),
    ...statements,
    db.prepare("UPDATE uploads SET used=1 WHERE key=? AND user_id=? AND used=0").bind(cover,u.id),
    db.prepare("UPDATE guess_queue SET state='started',lease=NULL,lease_until=0,error=NULL,updated_at=?,message_id=(SELECT id FROM chat_messages WHERE redpack_id=?) WHERE id=? AND lease=?").bind(at,id,q.id,lease),
   ])
  }catch(error){
   const conflict=String(error).includes('ldc_active_game')||String(error).includes('上一轮调用尚在结算')
   // 不把模型原始响应或答案写入公开错误。失败保留本人可恢复的加密配置。
   const message=conflict?null:'未能开局，请检查账号、LDC绑定或AI服务后重新排队。'
   await db.prepare("UPDATE guess_queue SET state=?,lease=NULL,lease_until=0,error=?,updated_at=? WHERE id=? AND state='starting' AND lease=?").bind(conflict?'queued':'failed',message,now(),q.id,lease).run()
   console.error('guess_queue_start_failed',{id:q.id,kind:conflict?'active_round':'configuration_or_upstream'})
  }
 }
}
