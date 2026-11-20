import { Hono } from 'hono'
import type { Ctx } from '../types'
import { boundedJson, fail, sameOrigin } from '../lib/http'
import { now } from '../lib/time'
import { isOwner, needUser } from '../services/auth'
import { needMember } from '../services/chat-access'
import { drawDueTitleRaffle, raffleTitleId, raffleTitleEnabled, RAFFLE_TITLES, ownedRaffleTitles } from '../title-raffle'
import { enabledRaffleSql } from '../shared/raffle-policy'
import { PERSONAL_TITLES } from '../shared/personal-directory'
import {whaleView,buyWhale,titleLevelSql} from '../title-growth'

export const titleRaffle = new Hono<Ctx>()
const path = '/api/chat/1/title-raffles'
const validId = (s: string) => /^[0-9a-f-]{36}$/.test(s)
const paidFields=`r.paid_version,
 (SELECT boosts FROM chat_title_raffle_entries WHERE raffle_id=r.id AND user_id=?1) AS my_boosts,
 (SELECT paid FROM chat_title_raffle_entries WHERE raffle_id=r.id AND user_id=?1) AS my_paid,
 (SELECT result FROM chat_title_raffle_entries WHERE raffle_id=r.id AND user_id=?1) AS my_result,
 (SELECT COUNT(*) FROM chat_title_raffle_entries WHERE raffle_id=r.id AND result=1) AS winner_count,`

titleRaffle.get('/api/me/whalebuddy',async c=>{const u=needUser(c);return c.json(await whaleView(c.env.DB,u.id,isOwner(c,u),now()))})
titleRaffle.post('/api/me/whalebuddy',async c=>{sameOrigin(c);needUser(c);fail(409,'D币直购称号等级已取消，请通过抽卡与成长获得等级')})

titleRaffle.get('/api/me/personal-titles', async c => {
  const u=await needUser(c)
  if(isOwner(c,u))return c.json({titles:Object.entries(PERSONAL_TITLES).map(([id,t])=>({id,...t,kind:'personal',rarity:t.rarity||'normal',enabled:true,access:'owner'}))})
  const {results}=await c.env.DB.prepare("SELECT substr(item,10) AS id FROM user_unlocks WHERE user_id=? AND item LIKE 'personal:%'").bind(u!.id).all<{id:string}>()
  const own=new Set(results.map(x=>x.id))
  return c.json({titles:Object.entries(PERSONAL_TITLES).filter(([id])=>own.has(id)).map(([id,t])=>({id,...t,kind:'personal',rarity:t.rarity||'normal',enabled:true}))})
})

titleRaffle.get('/api/me/raffle-titles', async c => {
  const u=await needUser(c)
  const owned=await ownedRaffleTitles(c.env.DB,u!.id)
  return c.json({titles:isOwner(c,u)?RAFFLE_TITLES.filter(t=>t.enabled).map(t=>({...t,wins:0,granted:false,...owned.find(o=>o.id===t.id),level:5200,permanent_level:5200,expires_at:null,access:'owner'})):owned})
})

titleRaffle.get('/api/admin/raffle-titles/:username', async c => {
  const owner=await needUser(c)
  if(!isOwner(c,owner)) fail(403,'只有站长能管理称号')
  const u=await c.env.DB.prepare("SELECT id FROM users WHERE username=? AND kind='user'").bind(c.req.param('username')).first<{id:number}>()
  if(!u) fail(404,'用户不存在')
  return c.json({titles:await ownedRaffleTitles(c.env.DB,u!.id)})
})

titleRaffle.get(`${path}/active`, async c => {
  const { u } = await needMember(c, 1)
  const { results } = await c.env.DB.prepare(`SELECT r.id,r.title,${paidFields}r.entry_mode,r.closes_at,
    (SELECT COUNT(*) FROM chat_title_raffle_entries e WHERE e.raffle_id=r.id) AS entries,
    EXISTS(SELECT 1 FROM chat_title_raffle_entries e WHERE e.raffle_id=r.id AND e.user_id=?1) AS joined
    FROM chat_title_raffles r WHERE r.group_id=1 AND r.status='open' AND ${enabledRaffleSql('r.title')} AND r.closes_at>?
    ORDER BY r.closes_at,r.id LIMIT 5`).bind(u.id, now()).all()
  return c.json({ raffles: results, can_create: isOwner(c, u) })
})

titleRaffle.get(`${path}/:id/participants`,async c=>{
 await needMember(c,1);const id=c.req.param('id'),before=Number(c.req.query('before')||Number.MAX_SAFE_INTEGER)
 if(!validId(id)||!Number.isSafeInteger(before))fail(400,'记录参数无效')
 const {results}=await c.env.DB.prepare(`SELECT e.user_id,u.name,u.username,e.paid,e.boosts,e.joined_at,e.refunded,
  CASE WHEN r.paid_version=1 THEN e.result WHEN r.status='drawn' THEN CASE WHEN r.winner_id=e.user_id THEN 1 ELSE 0 END WHEN r.status IN ('cancelled','empty') THEN 2 ELSE NULL END AS result
  FROM chat_title_raffle_entries e JOIN chat_title_raffles r ON r.id=e.raffle_id LEFT JOIN users u ON u.id=e.user_id
  WHERE e.raffle_id=? AND e.user_id<? ORDER BY e.user_id DESC LIMIT 31`).bind(id,before).all()
 return c.json({participants:results.slice(0,30),next:results.length>30?results[29].user_id:null})
})
titleRaffle.get(`${path}/:id`, async c => {
  const { u } = await needMember(c, 1)
  const id = c.req.param('id')
  if (!validId(id)) fail(400, '抽奖编号无效')
  const raffle = await c.env.DB.prepare(`SELECT r.id,r.title,${paidFields}r.entry_mode,r.packet_id,r.created_at,r.closes_at,r.status,r.winner_id,r.drawn_at,
    wu.name AS winner_name,wu.username AS winner_username,
    (SELECT COUNT(*) FROM chat_title_raffle_entries e WHERE e.raffle_id=r.id) AS entries,
    EXISTS(SELECT 1 FROM chat_title_raffle_entries e WHERE e.raffle_id=r.id AND e.user_id=?1) AS joined,
    (SELECT COUNT(*) FROM chat_title_raffles prev WHERE prev.winner_id=r.winner_id AND prev.title=r.title AND prev.status='drawn' AND prev.drawn_at<=r.drawn_at) AS level
    FROM chat_title_raffles r LEFT JOIN users wu ON wu.id=r.winner_id WHERE r.id=? AND r.group_id=1`)
    .bind(u.id,id).first()
  if (!raffle) fail(404, '抽奖不存在')
  return c.json({ titles:RAFFLE_TITLES,raffles:[raffle],can_create:isOwner(c,u),next:null })
})

titleRaffle.get(path, async c => {
  const { u } = await needMember(c, 1)
  const history = c.req.query('history') === '1'
  const packet = c.req.query('packet_id') || null
  if (packet && !/^[0-9a-f]{64}$/.test(packet)) fail(400, '红包编号无效')
  const cursor = c.req.query('before') || null
  if (cursor && !/^\d{1,10}:[0-9a-f-]{36}$/.test(cursor)) fail(400, '历史游标无效')
  const [cursorAt, cursorId] = cursor ? cursor.split(':') : [null, null]
  const start = Math.floor((now() + 8 * 3600) / 86400) * 86400 - 8 * 3600
  const { results } = await c.env.DB.prepare(`SELECT r.id,r.title,${paidFields}r.entry_mode,r.packet_id,r.created_at,r.closes_at,r.status,r.winner_id,r.drawn_at,
    wu.name AS winner_name,wu.username AS winner_username,
    (SELECT COUNT(*) FROM chat_title_raffle_entries e WHERE e.raffle_id=r.id) AS entries,
    EXISTS(SELECT 1 FROM chat_title_raffle_entries e WHERE e.raffle_id=r.id AND e.user_id=?1) AS joined,
    (SELECT COUNT(*) FROM chat_title_raffles prev WHERE prev.winner_id=r.winner_id AND prev.title=r.title AND prev.status='drawn' AND prev.drawn_at<=r.drawn_at) AS level
    FROM chat_title_raffles r LEFT JOIN users wu ON wu.id=r.winner_id
    WHERE r.group_id=1 AND (?=1 OR r.created_at>=?)
      AND (? IS NULL OR r.packet_id=?)
      AND (? IS NULL OR r.created_at<? OR (r.created_at=? AND r.id<?))
    ORDER BY r.created_at DESC,r.id DESC LIMIT 41`)
    .bind(u.id, history ? 1 : 0, start, packet, packet, cursor, cursorAt, cursorAt, cursorId).all()
  const visible = results.slice(0, 40)
  const last = visible.at(-1) as { created_at:number; id:string } | undefined
  return c.json({ titles: RAFFLE_TITLES, raffles: visible, can_create: isOwner(c, u),
    next: results.length > 40 && last ? String(last.created_at) + ':' + last.id : null })
})

// 新增付费参与统一进入即时抽卡，旧场次仅继续结算或取消退款。
titleRaffle.post(path,async c=>{sameOrigin(c);needUser(c);fail(409,'称号抽取已迁移到独立抽卡，请打开「抽卡」选择牌堆')})

titleRaffle.post(`${path}/:id/draw`, async c => {
  sameOrigin(c)
  const { u } = await needMember(c, 1)
  if (!isOwner(c, u)) fail(403, '只有站长能开奖')
  const id = c.req.param('id')
  if (!validId(id)) fail(400, '抽奖编号无效')
  const t = now()
  const r = await c.env.DB.prepare(`UPDATE chat_title_raffles SET closes_at=MAX(created_at+1,?) WHERE id=? AND group_id=1 AND status='open' AND ${enabledRaffleSql()} AND closes_at>?`)
    .bind(t,id,t).run()
  if (!r.meta.changes) fail(409, '抽奖已经结束或称号已暂时下线')
  const result = await drawDueTitleRaffle(c.env.DB, t+1, id)
  if (result === 'retry' || result === 'none') fail(503, '开奖处理中，请刷新查看结果')
  return c.json({ status: result })
})

titleRaffle.post(`${path}/:id/join`, async c => {
  sameOrigin(c)
  const { u } = await needMember(c, 1)
  const id = c.req.param('id')
  if (!validId(id)) fail(400, '抽奖编号无效')
  const t = now()
  const paid=await c.env.DB.prepare('SELECT paid_version FROM chat_title_raffles WHERE id=?').bind(id).first<{paid_version:number}>()
  if(paid?.paid_version)fail(409,'旧场次已停止新增付费报名与追加，已付款记录按原规则结算；新参与请使用抽卡')
  const r = await c.env.DB.prepare(`INSERT OR IGNORE INTO chat_title_raffle_entries(raffle_id,user_id,joined_at)
    SELECT r.id,?,? FROM chat_title_raffles r WHERE r.id=? AND r.group_id=1 AND r.status='open'
      AND r.entry_mode='optin' AND ${enabledRaffleSql('r.title')} AND r.closes_at>?
      AND EXISTS(SELECT 1 FROM chat_members cm WHERE cm.group_id=1 AND cm.user_id=?)
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND kind='user' AND disabled=0)
      AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE group_id=1 AND user_id=?)
      AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?)`)
    .bind(u.id,t,id,t,u.id,u.id,u.id,u.id).run()
  if (!r.meta.changes) {
    const existing = await c.env.DB.prepare(`SELECT 1 FROM chat_title_raffle_entries e JOIN chat_title_raffles r ON r.id=e.raffle_id
      WHERE e.raffle_id=? AND e.user_id=? AND r.status='open' AND ${enabledRaffleSql('r.title')} AND r.closes_at>?`).bind(id,u.id,t).first()
    if (!existing) fail(409, '报名已结束或抽奖不可用')
  }
  return c.json({ joined: true })
})

titleRaffle.delete(`${path}/:id/join`, async c => {
  sameOrigin(c)
  const { u } = await needMember(c, 1)
  const id = c.req.param('id')
  if (!validId(id)) fail(400, '抽奖编号无效')
  if(await c.env.DB.prepare('SELECT 1 FROM chat_title_raffles WHERE id=? AND paid_version=1').bind(id).first())fail(409,'付费报名不支持退出；取消整场抽奖会全额退款')
  await c.env.DB.prepare(`DELETE FROM chat_title_raffle_entries WHERE raffle_id=? AND user_id=?
    AND EXISTS(SELECT 1 FROM chat_title_raffles r WHERE r.id=raffle_id AND r.status='open' AND r.closes_at>?)`)
    .bind(id,u.id,now()).run()
  return c.json({ joined: false })
})

titleRaffle.post(`${path}/:id/cancel`, async c => {
  sameOrigin(c)
  const { u } = await needMember(c, 1)
  if (!isOwner(c, u)) fail(403, '只有群主能取消抽奖')
  const id = c.req.param('id')
  if (!validId(id)) fail(400, '抽奖编号无效')
  const r = await c.env.DB.prepare("UPDATE chat_title_raffles SET status='cancelled' WHERE id=? AND group_id=1 AND status='open'").bind(id).run()
  if (!r.meta.changes) fail(409, '抽奖已经结束')
  return c.json({ cancelled: true })
})

const grantPath = '/api/admin/raffle-titles/:username/:title'
titleRaffle.put(grantPath, async c => {
  const owner = await needUser(c)
  if (!isOwner(c, owner)) fail(403, '只有站长能授予称号')
  const title = raffleTitleId(c.req.param('title'))
  if (!title) fail(400, '称号无效')
  if (!raffleTitleEnabled(title)) fail(409, '该称号已暂时下线')
  const username = c.req.param('username')
  const [, ,found] = await c.env.DB.batch([
    c.env.DB.prepare(`INSERT OR IGNORE INTO user_unlocks(user_id,item,at) SELECT id,?,? FROM users
      WHERE username=? AND kind='user' AND disabled=0`).bind('raffle:'+title,now(),username),
    c.env.DB.prepare(`UPDATE users SET deco=json_set(deco,'$.fn',${titleLevelSql('users.id','?1')}),updated_at=?2
      WHERE username=?3 AND kind='user' AND disabled=0 AND json_extract(deco,'$.ft')=?1
      AND EXISTS(SELECT 1 FROM user_unlocks WHERE user_id=users.id AND item=?4)`).bind(title,now(),username,'raffle:'+title),
    c.env.DB.prepare("SELECT id FROM users WHERE username=? AND kind='user' AND disabled=0").bind(username),
  ])
  if (!found.results.length) fail(404, '用户不存在')
  return c.json({ granted:true,title })
})

titleRaffle.delete(grantPath, async c => {
  const owner = await needUser(c)
  if (!isOwner(c, owner)) fail(403, '只有站长能撤销称号')
  const title = raffleTitleId(c.req.param('title'))
  if (!title) fail(400, '称号无效')
  const username = c.req.param('username')
  const [r] = await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM user_unlocks WHERE item=? AND user_id=(SELECT id FROM users WHERE username=?)`).bind('raffle:'+title,username),
    c.env.DB.prepare(`UPDATE users SET deco=CASE
    WHEN json_extract(deco,'$.ft')=?1 AND ${titleLevelSql('users.id','?1')}=0
      THEN json_remove(deco,'$.fg','$.ft','$.fn')
    WHEN json_extract(deco,'$.ft')=?1 THEN json_set(json_remove(deco,'$.fg'),'$.fn',${titleLevelSql('users.id','?1')})
    ELSE deco END,updated_at=?2
    WHERE username=?3 AND json_extract(deco,'$.ft')=?1`)
    .bind(title,now(),username),
  ])
  if (!r.meta.changes) fail(409, '当前未授予该称号')
  return c.json({ granted:false,title })
})

