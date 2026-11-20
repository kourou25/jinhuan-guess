import {communityProgressStatements} from './community-growth'
import {scratchMultiple,lottoTier,lottoPayout} from './shared/huancai-rules'
import {ensureCoinWallet} from './farm/coin-packets'
import {AI_BOT_ID,ensureAiBot} from './ai/images'
export class HuancaiError extends Error {}
export const SCRATCH_THEMES=[{id:'banana',name:'蕉个好运',price:10},{id:'whale',name:'鲸喜连连',price:20},{id:'meme',name:'梗王驾到',price:10},{id:'farm',name:'满园金豆',price:20},{id:'star',name:'星愿来信',price:50},{id:'huan',name:'欢欢福袋',price:50}]
export function randomInt(n:number){if(!Number.isSafeInteger(n)||n<1||n>2147483647)throw Error('random range');const limit=Math.floor(4294967296/n)*n;let v;do{v=crypto.getRandomValues(new Uint32Array(1))[0]}while(v>=limit);return v%n}
export function pickNumbers(max:number,n:number,random=randomInt){const pool=Array.from({length:max},(_,i)=>i+1);for(let i=0;i<n;i++){const j=i+random(max-i);[pool[i],pool[j]]=[pool[j],pool[i]]}return pool.slice(0,n).sort((a,b)=>a-b)}
export function huancaiDay(t:number){return new Date((t+28800)*1000).toISOString().slice(0,10)}
export function nextDraw(t:number){let day=huancaiDay(t),closes=Math.floor(Date.parse(day+'T21:30:00+08:00')/1000);if(t>=closes){day=huancaiDay(t+86400);closes+=86400}const weekday=new Date(day+'T00:00:00Z').getUTCDay();return {day,closes_at:closes,special:weekday===0||weekday===3?1:0}}
type Numbers={front:number[];back:number[]}
export function validNumbers(raw:unknown,version=2):Numbers{const a=raw as Numbers;if(!a||!Array.isArray(a.front)||!Array.isArray(a.back))throw new HuancaiError('请选择前区5个、后区2个号码');for(const [numbers,n,max]of[[a.front,5,version===1?20:35],[a.back,2,version===1?8:12]] as const)if(numbers.length!==n||new Set(numbers).size!==n||numbers.some(x=>!Number.isInteger(x)||x<1||x>max))throw new HuancaiError('号码数量、范围或重复项不正确');return {front:[...a.front].sort((a,b)=>a-b),back:[...a.back].sort((a,b)=>a-b)}}
export function matchWeight(a:Numbers,b:Numbers){const f=a.front.filter(x=>b.front.includes(x)).length,r=a.back.filter(x=>b.back.includes(x)).length;return f===5&&r===2?1000:f===5&&r===1?100:f===5||f===4&&r===2?30:f===4&&r===1||f===3&&r===2?10:f===4||f===3&&r===1||f===2&&r===2?3:f===3||r===2?1:0}
type Order={id:number;kind:string;signature:string;price:number;payload:string;created_at:number}
const orderView=(o:Order)=>({...o,payload:JSON.parse(o.payload),signature:undefined})
export async function orderReceipt(db:D1Database,uid:number,id:string){return db.prepare('SELECT id,kind,signature,price,payload,created_at FROM huancai_orders WHERE user_id=? AND request_id=?').bind(uid,id).first<Order>()}
export async function ensureRound(db:D1Database,t:number){const r=nextDraw(t);await db.prepare('INSERT OR IGNORE INTO huancai_rounds(day,closes_at,special,rules_version) VALUES(?,?,0,2)').bind(r.day,r.closes_at).run();return (await db.prepare('SELECT day,closes_at,special,rules_version FROM huancai_rounds WHERE day=?').bind(r.day).first<{day:string;closes_at:number;special:number;rules_version:number}>())!}
const active=`EXISTS(SELECT 1 FROM users u JOIN chat_members m ON m.user_id=u.id AND m.group_id=1 WHERE u.id=?1 AND u.kind='user' AND u.disabled=0) AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE group_id=1 AND user_id=?1) AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1)`
export async function buyHuancai(db:D1Database,uid:number,body:Record<string,unknown>,t:number,random=randomInt){
 const id=String(body.id),kind=String(body.kind);if(!/^[0-9a-f-]{36}$/.test(id)||!['lotto','scratch'].includes(kind))throw new HuancaiError('购买参数无效')
 const theme=SCRATCH_THEMES.find(x=>x.id===body.theme),count=Number(body.count??1)
 let numbers:Numbers[]=[]
 if(kind==='lotto'){if(!Array.isArray(body.tickets)||body.tickets.length<1||body.tickets.length>10||typeof body.day!=='string')throw new HuancaiError('每次可投1至10注');numbers=body.tickets.map(x=>validNumbers(x))}
 else if(!theme||![1,20].includes(count))throw new HuancaiError('请选择票面及单张或20张整本')
 const signature=JSON.stringify(kind==='lotto'?{kind,day:body.day,tickets:numbers}:{kind,theme:theme!.id,count}),old=await orderReceipt(db,uid,id)
 if(old){if(old.signature!==signature)throw new HuancaiError('请求标识已用于其他购买');return orderView(old)}
 const day=huancaiDay(t),round=kind==='lotto'?await ensureRound(db,t):null
 if(round&&body.day!==round.day)throw new HuancaiError('该期已截止，请刷新后选择下一期')
 if(round)numbers.forEach(x=>validNumbers(x,round.rules_version))
 await ensureCoinWallet(db,uid,t)
 const quotaDay=round?.day??day
 const streakBefore=kind==='scratch'?Number((await db.prepare("SELECT value FROM community_progress WHERE user_id=? AND metric='_scratch_streak'").bind(uid).first<{value:number}>())?.value??0):0
 await db.prepare('INSERT OR IGNORE INTO huancai_usage(user_id,day) VALUES(?,?)').bind(uid,quotaDay).run()
 const price=kind==='lotto'?numbers.length*10:theme!.price*count,attempt=crypto.randomUUID();let reward=0
 const tickets=numbers.map(n=>({id:crypto.randomUUID(),...n})),cards=kind==='scratch'?Array.from({length:count},(_,i)=>{const multiple=scratchMultiple(random(10000)),payout=multiple*theme!.price;reward+=payout;return {n:i+1,multiple,payout}}):[]
 const payload=kind==='lotto'?{day:round!.day,tickets}:{version:2,theme:theme!.id,cards,reward},gate='EXISTS(SELECT 1 FROM huancai_orders WHERE attempt=?1)'
 const condition=kind==='lotto'?`EXISTS(SELECT 1 FROM huancai_rounds WHERE day=?9 AND state='open' AND closes_at>?7 AND sales+?4<=1125899906842624 AND tickets+?8<=9007199254740991 AND (rules_version>=2 OR tickets+?8<=10000))`:`w.balance-?4+?8<=9007199254740991`
 const statements=[db.prepare(`INSERT OR IGNORE INTO huancai_orders(user_id,request_id,kind,signature,price,payload,attempt,created_at) SELECT ?1,?2,?3,?5,?4,?6,?10,?7 FROM coin52_wallets w JOIN huancai_usage q ON q.user_id=w.user_id AND q.day=?9 WHERE w.user_id=?1 AND w.balance>=?4 AND ${condition} AND ${active} AND (?3='lotto' OR COALESCE((SELECT value FROM community_progress WHERE user_id=?1 AND metric='_scratch_streak'),0)=?11)`).bind(uid,id,kind,price,signature,JSON.stringify(payload),t,kind==='lotto'?numbers.length:reward,quotaDay,attempt,streakBefore)]
 const money=(label:string,delta:number,suffix:string)=>{
  statements.push(db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?2,?3,?4,?5,?6,balance+?6,?7 FROM coin52_wallets WHERE user_id=?2 AND ${gate}`).bind(attempt,uid,label,id,attempt+suffix,delta,t))
  statements.push(db.prepare(`UPDATE coin52_wallets SET balance=balance+?3,revision=revision+1,updated_at=?4 WHERE user_id=?2 AND ${gate}`).bind(attempt,uid,delta,t))
 }
 money('huancai-buy',-price,':pay');if(reward)money('huancai-scratch',reward,':prize')
 statements.push(db.prepare(`UPDATE huancai_usage SET ${kind==='lotto'?'lotto_count=lotto_count+?4':'scratch_spent=scratch_spent+?4'} WHERE user_id=?2 AND day=?3 AND ${gate}`).bind(attempt,uid,quotaDay,kind==='lotto'?numbers.length:price))
 if(round){
  statements.push(db.prepare(`UPDATE huancai_rounds SET tickets=tickets+?3,sales=sales+?4 WHERE day=?2 AND ${gate}`).bind(attempt,round.day,numbers.length,price))
  for(const ticket of tickets)statements.push(db.prepare(`INSERT INTO huancai_tickets(id,day,user_id,front,back,created_at) SELECT ?2,?3,?4,?5,?6,?7 WHERE ${gate}`).bind(attempt,ticket.id,round.day,uid,JSON.stringify(ticket.front),JSON.stringify(ticket.back),t))
 }
 if(kind==='scratch'){let streak=streakBefore,longest=streakBefore;for(const c of cards){streak=c.payout?0:streak+1;longest=Math.max(longest,streak)}statements.push(db.prepare(`INSERT INTO community_progress(user_id,metric,value) SELECT ?2,'_scratch_streak',?3 WHERE ${gate} ON CONFLICT(user_id,metric) DO UPDATE SET value=excluded.value`).bind(attempt,uid,streak));statements.push(...communityProgressStatements(db,uid,{scratch_draws:cards.length,scratch_wins:cards.filter(c=>c.payout>0).length,scratch_jackpot:cards.filter(c=>c.multiple>=10).length},t,gate,[attempt]),...communityProgressStatements(db,uid,{scratch_dry:longest},t,gate,[attempt],true))}
 await db.batch(statements)
 const result=await orderReceipt(db,uid,id);if(!result)throw new HuancaiError('余额不足、该期已截止或参与状态已变化；未扣款，请刷新')
 if(result.signature!==signature)throw new HuancaiError('请求标识已用于其他购买');return orderView(result)
}

type Round={rules_version:number;prize_counts:string|null;day:string;closes_at:number;special:number;state:string;tickets:number;sales:number;front:string;back:string;pool:number;weight_total:number}
export async function settleHuancai(db:D1Database,t:number,random=randomInt){
 const r=await db.prepare("SELECT * FROM huancai_rounds WHERE state='drawing' ORDER BY closes_at LIMIT 1").first<Round>()??await db.prepare("SELECT * FROM huancai_rounds WHERE state='open' AND closes_at<=? ORDER BY closes_at LIMIT 1").bind(t).first<Round>();if(!r)return
 if(r.rules_version>=2){
  if(r.state==='open'){
   const front=JSON.stringify(pickNumbers(35,5,random)),back=JSON.stringify(pickNumbers(12,2,random)),pool=Math.floor(r.sales*.8)
   const claim=await db.prepare("UPDATE huancai_rounds SET state='drawing',front=?,back=?,pool=? WHERE day=? AND state='open' AND tickets=? AND closes_at<=?").bind(front,back,pool,r.day,r.tickets,t).run();if(!claim.meta.changes)return
   r.state='drawing';r.front=front;r.back=back;r.pool=pool
  }
  const draw:Numbers={front:JSON.parse(r.front),back:JSON.parse(r.back)}
  if(!r.prize_counts){
   const rows=(await db.prepare('SELECT id,front,back FROM huancai_tickets WHERE day=? AND weight IS NULL ORDER BY id LIMIT 100').bind(r.day).all<{id:string;front:string;back:string}>()).results
   if(rows.length)await db.batch(rows.map(x=>db.prepare('UPDATE huancai_tickets SET weight=? WHERE id=? AND weight IS NULL').bind(lottoTier(JSON.parse(x.front).filter((v:number)=>draw.front.includes(v)).length,JSON.parse(x.back).filter((v:number)=>draw.back.includes(v)).length),x.id)))
   if(await db.prepare('SELECT 1 FROM huancai_tickets WHERE day=? AND weight IS NULL LIMIT 1').bind(r.day).first())return
   const counts=(await db.prepare('SELECT weight,COUNT(*) AS n FROM huancai_tickets WHERE day=? GROUP BY weight').bind(r.day).all<{weight:number;n:number}>()).results
   r.prize_counts=JSON.stringify(Object.fromEntries(counts.map(x=>[x.weight,x.n])))
   await db.prepare('UPDATE huancai_rounds SET prize_counts=? WHERE day=? AND prize_counts IS NULL').bind(r.prize_counts,r.day).run()
  }
 }
 if(r.state==='open'){
  const {results}=await db.prepare('SELECT id,front,back FROM huancai_tickets WHERE day=? ORDER BY id LIMIT 10000').bind(r.day).all<{id:string;front:string;back:string}>()
  if(results.length!==r.tickets)throw Error('huancai ticket count mismatch')
  const chosen=r.special&&results.length?results[random(results.length)]:null,draw:Numbers=chosen?{front:JSON.parse(chosen.front),back:JSON.parse(chosen.back)}:{front:pickNumbers(20,5,random),back:pickNumbers(8,2,random)}
  const total=results.reduce((n,x)=>n+matchWeight({front:JSON.parse(x.front),back:JSON.parse(x.back)},draw),0),token=crypto.randomUUID()
  const change=await db.prepare("UPDATE huancai_rounds SET state='drawing',front=?,back=?,weight_total=?,pool=?,token=? WHERE day=? AND state='open' AND tickets=? AND closes_at<=?").bind(JSON.stringify(draw.front),JSON.stringify(draw.back),total,Math.floor(r.sales*.8),token,r.day,r.tickets,t).run()
  if(!change.meta.changes)return
  r.state='drawing';r.front=JSON.stringify(draw.front);r.back=JSON.stringify(draw.back);r.weight_total=total;r.pool=Math.floor(r.sales*.8)
 }
 const draw:Numbers={front:JSON.parse(r.front),back:JSON.parse(r.back)}
 const {results}=await db.prepare('SELECT id,user_id,front,back,weight FROM huancai_tickets WHERE day=? AND settled_at IS NULL ORDER BY id LIMIT 50').bind(r.day).all<{id:string;user_id:number;front:string;back:string;weight:number}>()
 const statements:D1PreparedStatement[]=[]
 for(const ticket of results){
  const weight=r.rules_version>=2?ticket.weight:matchWeight({front:JSON.parse(ticket.front),back:JSON.parse(ticket.back)},draw),payout=r.rules_version>=2?lottoPayout(weight,JSON.parse(r.prize_counts!),r.pool):r.weight_total?Math.floor(r.pool*weight/r.weight_total):0,token=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM huancai_tickets WHERE id=?1 AND attempt=?2)'
  statements.push(db.prepare('UPDATE huancai_tickets SET weight=?,payout=?,settled_at=?,attempt=? WHERE id=? AND settled_at IS NULL AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=? AND balance+?<=9007199254740991)').bind(weight,payout,t,token,ticket.id,ticket.user_id,payout))
  if(payout){statements.push(...communityProgressStatements(db,ticket.user_id,{lotto_wins:1},t,gate,[ticket.id,token]));statements.push(db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?3,'huancai-lotto',?1,?2,?4,balance+?4,?5 FROM coin52_wallets WHERE user_id=?3 AND ${gate}`).bind(ticket.id,token,ticket.user_id,payout,t));statements.push(db.prepare(`UPDATE coin52_wallets SET balance=balance+?4,revision=revision+1,updated_at=?5 WHERE user_id=?3 AND ${gate}`).bind(ticket.id,token,ticket.user_id,payout,t))}
 }
 if(statements.length)await db.batch(statements)
 if(!await ensureAiBot(db,t))return
 const end=crypto.randomUUID(),summary=`欢彩 ${r.day} 已开奖：${draw.front.join(' ')} + ${draw.back.join(' ')}。${r.special?'必出奖专场 · ':''}${r.tickets} 注参与，奖励已结算。点击群聊「欢彩」查看本人结果。`
 await db.batch([
  db.prepare("UPDATE huancai_rounds SET state='paid',token=?,settled_at=? WHERE day=? AND state='drawing' AND NOT EXISTS(SELECT 1 FROM huancai_tickets WHERE day=? AND settled_at IS NULL)").bind(end,t,r.day,r.day),
  db.prepare("INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref) SELECT 1,?,?,?,?,'huancai_draw',? WHERE EXISTS(SELECT 1 FROM chat_groups WHERE id=1) AND EXISTS(SELECT 1 FROM huancai_rounds WHERE day=? AND state='paid' AND token=? AND tickets>0)").bind(AI_BOT_ID,summary,t,t,'huancai:'+r.day,r.day,end),
 ])
}
