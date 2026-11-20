import {Hono} from 'hono'
import type {Ctx} from '../types'
import {boundedJson,fail,sameOrigin} from '../lib/http'
import {isOwner,needUser} from '../services/auth'
import {needMember} from '../services/chat-access'
import {now} from '../lib/time'
import {ensureCoinWallet} from '../farm/coin-packets'
import {RAFFLE_TITLES,raffleTitleId,raffleTitleEnabled} from '../title-raffle'
import {titleLevelSql} from '../title-growth'
import {CardRuleError,cardChance,fingerPrice,settleCard,cardReceipt} from '../instant-cards'
import {drawCards,drawProgress,DrawRuleError} from '../card-draws'
import {TITLE_PITY,TITLE_MAX_LEVEL,TITLE_STAGES,TITLE_STAGE_NAMES,titleExhibit,titleAvailable} from '../shared/title-collection'

export const instantCards=new Hono<Ctx>()
const base='/api/instant-cards'
instantCards.get(base,async c=>{
 const {u}=await needMember(c,1),owner=isOwner(c,u),t=now();await ensureCoinWallet(c.env.DB,u.id,t)
 const state=await c.env.DB.prepare('SELECT balance,COALESCE((SELECT level FROM instant_card_fingers WHERE user_id=?1),0) AS level FROM coin52_wallets WHERE user_id=?1').bind(u.id).first<{balance:number;level:number}>()
 const {results}=await c.env.DB.prepare(`SELECT p.*,u.name AS owner_name,u.username AS owner_username,${titleLevelSql('?1','p.title')} AS owned_level FROM instant_card_pools p JOIN users u ON u.id=p.owner_id ORDER BY p.created_at,p.title`).bind(u.id).all()
 const level=owner?5:state?.level||0
 const [progress,limitedProgress]=await Promise.all([drawProgress(c.env.DB,u.id),drawProgress(c.env.DB,u.id,true)])
 const newcomer=await c.env.DB.prepare("SELECT created_at>=?2-604800 AND created_at<=?2 AS eligible,EXISTS(SELECT 1 FROM user_unlocks WHERE user_id=?1 AND item='raffle:newcomer') AS claimed FROM users WHERE id=?1").bind(u.id,t).first()
 return c.json({user_id:u.id,pools:results.map(p=>({...p,enabled:raffleTitleEnabled(String(p.title)),available:titleAvailable(String(p.title),t)})),titles:RAFFLE_TITLES,balance:state?.balance||0,level,chance:cardChance(level),next_price:owner?null:fingerPrice(level),price:100,can_manage:owner,pity:progress?.pity??0,limited_pity:limitedProgress?.pity??0,pity_limit:TITLE_PITY,max_level:TITLE_MAX_LEVEL,stages:TITLE_STAGES,stage_names:TITLE_STAGE_NAMES,exhibit:titleExhibit(t),newcomer})
})
instantCards.post(`${base}/newcomer`,async c=>{
 sameOrigin(c);const {u}=await needMember(c,1),t=now()
 await c.env.DB.prepare("INSERT OR IGNORE INTO user_unlocks(user_id,item,at) SELECT id,'raffle:newcomer',?2 FROM users WHERE id=?1 AND created_at>=?2-604800 AND created_at<=?2 AND disabled=0 AND kind='user'").bind(u.id,t).run()
 if(!await c.env.DB.prepare("SELECT 1 FROM user_unlocks WHERE user_id=? AND item='raffle:newcomer'").bind(u.id).first())fail(409,'新人称号限注册7天内领取，已获得后永久保留')
 return c.json({ok:true})
})
instantCards.post(`${base}/settle`,async c=>{
 sameOrigin(c);const {u}=await needMember(c,1),b=await boundedJson(c,2048),title=raffleTitleId(b.title)
 if(!title||!['draw','finger'].includes(String(b.kind)))fail(400,'请选择有效奖池与操作')
 try{
  const p={uid:u.id,id:String(b.id),title:title!,level:Number(b.level),revision:Number(b.revision),owner:isOwner(c,u),t:now()}
  if(b.kind==='draw'){const batch=await drawCards(c.env.DB,{...p,count:Number(b.count??1)});return c.json({...batch,receipt:batch.receipts[0]})}
  return c.json({receipt:await settleCard(c.env.DB,{...p,kind:'finger'})})
 }catch(e){if(e instanceof CardRuleError||e instanceof DrawRuleError)fail(409,e.message);fail(503,'结算状态暂未确认，请使用原请求重试，不会重复扣款')}
})
instantCards.get(`${base}/receipt/:id`,async c=>{const {u}=await needMember(c,1),r=await cardReceipt(c.env.DB,u.id,c.req.param('id'));if(!r)fail(404,'尚未找到这次结果，可重试原请求');return c.json({receipt:r})})
instantCards.get(`${base}/records`,async c=>{
 const {u}=await needMember(c,1),mine=c.req.query('mine')==='1',before=Number(c.req.query('before')||Number.MAX_SAFE_INTEGER),title=c.req.query('title')||null
 if(!Number.isSafeInteger(before)||before<1||title&&!raffleTitleId(title))fail(400,'记录筛选无效')
 const {results}=await c.env.DB.prepare(`SELECT r.id,r.kind,r.title,r.price,r.finger_level,r.chance,r.won,r.reward_kind,r.reward_id,r.reward_amount,r.guaranteed,r.created_at,u.name,u.username,r.user_id=?1 AS mine,CASE WHEN r.user_id=?1 THEN r.request_id ELSE NULL END AS request_id
   FROM instant_card_receipts r JOIN users u ON u.id=r.user_id WHERE (?2=0 OR r.user_id=?1) AND (?3 IS NULL OR r.title=?3) AND r.id<?4 ORDER BY r.id DESC LIMIT 31`).bind(u.id,mine?1:0,title,before).all()
 return c.json({records:results.slice(0,30),next:results.length>30?results[29].id:null})
})
instantCards.post(`${base}/pools`,async c=>{
 sameOrigin(c);const u=needUser(c);if(!isOwner(c,u))fail(403,'仅站长能管理奖池')
 const b=await boundedJson(c,1024),title=raffleTitleId(b.title),t=now()
 if(!title||title==='newcomer'||!raffleTitleEnabled(title)||![0,1].includes(Number(b.active))||!Number.isInteger(b.revision)||Number(b.revision)<0)fail(400,'奖池配置无效')
 const result=Number(b.revision)===0?await c.env.DB.prepare(`INSERT OR IGNORE INTO instant_card_pools(title,owner_id,active,created_at,updated_at) VALUES(?,?,?,?,?)`).bind(title,u.id,Number(b.active),t,t).run():await c.env.DB.prepare('UPDATE instant_card_pools SET active=?,revision=revision+1,updated_at=? WHERE title=? AND owner_id=? AND revision=?').bind(Number(b.active),t,title,u.id,Number(b.revision)).run()
 if(!result.meta.changes)fail(409,'奖池已被更新或属于其他站长，请刷新')
 return c.json({ok:true})
})
instantCards.get(`${base}/management`,async c=>{
 const u=needUser(c);if(!isOwner(c,u))fail(403,'仅站长能查看管理汇总')
 const totals=await c.env.DB.prepare(`SELECT COUNT(*) AS transactions,COALESCE(SUM(price),0) AS income,SUM(CASE WHEN kind='draw' THEN 1 ELSE 0 END) AS draws,SUM(CASE WHEN won=1 THEN 1 ELSE 0 END) AS wins FROM instant_card_receipts WHERE owner_id=?`).bind(u.id).first()
 return c.json({totals})
})
