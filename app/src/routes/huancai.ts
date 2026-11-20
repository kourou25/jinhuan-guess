import {LOTTO_PRIZES,LOTTO_V2,SCRATCH_PRIZES} from '../shared/huancai-rules'
import {Hono} from 'hono'
import type {Ctx} from '../types'
import {boundedJson,fail,sameOrigin} from '../lib/http'
import {needMember} from '../services/chat-access'
import {now} from '../lib/time'
import {ensureCoinWallet} from '../farm/coin-packets'
import {buyHuancai,ensureRound,huancaiDay,HuancaiError,SCRATCH_THEMES} from '../huancai'
export const huancai=new Hono<Ctx>()
huancai.get('/api/huancai',async c=>{
 const {u}=await needMember(c,1),db=c.env.DB,t=now(),next=await ensureRound(db,t)
 await ensureCoinWallet(db,u.id,t)
 const [wallet,round,usage,scratch,history,tickets]=await Promise.all([
  db.prepare('SELECT balance FROM coin52_wallets WHERE user_id=?').bind(u.id).first(),
  db.prepare('SELECT day,closes_at,special,tickets,sales,rules_version FROM huancai_rounds WHERE day=?').bind(next.day).first(),
  db.prepare('SELECT lotto_count FROM huancai_usage WHERE user_id=? AND day=?').bind(u.id,next.day).first(),
  db.prepare('SELECT scratch_spent FROM huancai_usage WHERE user_id=? AND day=?').bind(u.id,huancaiDay(t)).first(),
  db.prepare("SELECT day,special,front,back,tickets,pool FROM huancai_rounds WHERE state='paid' ORDER BY closes_at DESC LIMIT 7").all(),
  db.prepare('SELECT id,day,front,back,weight,payout,settled_at FROM huancai_tickets WHERE user_id=? ORDER BY day DESC,id LIMIT 30').bind(u.id).all(),
 ])
 return c.json({balance:wallet?.balance||0,round,lotto_rules:LOTTO_V2,prizes:LOTTO_PRIZES,scratch_prizes:SCRATCH_PRIZES,scratch_win_percent:40.02,scratch_rtp:65,lotto_count:usage?.lotto_count||0,scratch_spent:scratch?.scratch_spent||0,themes:SCRATCH_THEMES,history:history.results,tickets:tickets.results})
})
huancai.post('/api/huancai/buy',async c=>{
 sameOrigin(c);const {u}=await needMember(c,1),body=await boundedJson(c,4096)
 try{return c.json({order:await buyHuancai(c.env.DB,u.id,body,now())})}catch(e){if(e instanceof HuancaiError)fail(409,e.message);console.error('huancai_buy_failed');fail(503,'结算状态暂未确认，请重试原订单，不会重复扣款')}
})
huancai.get('/api/huancai/orders',async c=>{
 const {u}=await needMember(c,1),before=Number(c.req.query('before')||Number.MAX_SAFE_INTEGER)
 if(!Number.isSafeInteger(before)||before<1)fail(400,'记录位置无效')
 const {results}=await c.env.DB.prepare('SELECT id,kind,price,payload,created_at FROM huancai_orders WHERE user_id=? AND id<? ORDER BY id DESC LIMIT 11').bind(u.id,before).all<{id:number;payload:string}>()
 return c.json({orders:results.slice(0,10).map(x=>({...x,payload:JSON.parse(x.payload)})),next:results.length>10?results[9].id:null})
})
