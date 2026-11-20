import {sharedRoutes} from '../../standalone/shared-routes'
import {runLuckybags} from './games/guess-luckybag'
import {syncCommunityGrowth} from './community-growth'
import {settleCloseVotes} from './ldc/cancel'
import {ACTIVITY_REWARDS,activityReward} from './shared/activity-rewards'
import {settleContentRewards} from './services/content-coin-rewards'
import {prepareMedia,mediaKeys,fileName,type Media,type MediaIn} from './services/content-media'
import type { Env } from './env'
export type { Env } from './env'
import type { C, Ctx, User, Puzzle } from './types'
import { now } from './lib/time'
import { randHex, sha256 } from './lib/crypto'
import { fail, jsonBody, safeNext, boundedJson } from './lib/http'
import { rateOn, needUser, canManage, isChatAdmin, ownerNames, isOwner, isFancy, canManageAi } from './services/auth'
import { cleanDeco, decoOf, BADGE_IDS } from './shared/deco'
import { personalTitleId } from './shared/personal-directory'
import {GUESS_REWARDS,guessReward} from './shared/guess-rewards'
import {LUCK_REWARDS,luckReward} from './shared/luck-rewards'
import {RANK_REWARDS,rankReward} from './shared/rank-rewards'
import {FARM_BADGES,farmBadgeProgress} from './shared/farm-badges'
import {settleDailyRanks} from './services/rank-settlement'
import {runAnswerExplanations} from './ldc/answer-explanation'
import {runGuessReviews} from './ldc/review'
import {settlePacketLuck} from './ldc/luck'
import { platform } from './routes/platform'
import { aiAdmin } from './routes/ai-admin'
import { aiChat } from './routes/ai-chat'
import {webPush} from './routes/web-push'
import {farm} from './routes/farm'
import {settleCoinPools} from './ldc/coin-funding'
import {createCoinPacket,claimCoinPacket,coinPacketView,settleCoinPackets} from './farm/coin-packets'
import {runWebPush} from './services/web-push'
import { dm } from './routes/dm'
import { chatStickers } from './routes/chat-stickers'
import { chatFavorites,favoriteSendGuard } from './routes/chat-favorites'
import { socialPreview,socialMediaResponse,cachedSocialPreview } from './routes/social-preview'
import {socialLinks,canSocialPost,socialCaption} from '../public/social-links.js'
import {postShareLink,socialPostGallery,socialPostContent} from './services/social-post'
import {douyinMediaUrl} from './services/social-douyin'
import {weiboMediaUrl} from './services/social-weibo'
import {instagramMediaUrl} from './services/social-instagram'
import {xMediaUrl} from './services/social-x'
import { titleRaffle } from './routes/title-raffle'
import { instantCards } from './routes/instant-cards'
import {huancai} from './routes/huancai'
import {settleHuancai} from './huancai'
import { drawDueTitleRaffle, raffleTitleId, raffleTitleEnabled } from './title-raffle'
import {titleLevelSql} from './title-growth'
import { aiImages } from './routes/ai-images'
import { AI_BOT_ID, enqueueImageReply } from './ai/images'
import { IMAGE_CRON,runImageCron } from './ai/image-cron'
import {sendSleepReminder} from './services/sleep-reminder'
import { canDeleteComment, deleteComment } from './services/comments'
import {AiError} from './ai/errors'
import {chatRankView} from './services/chat-rank'
import {joinDefaultGroups,needMember,assertCurrentAccess,CHAT_HISTORY_FLOOR,type ChatGroup} from './services/chat-access'
import { aiAlerts } from './ai/alerts'
import { invites } from './routes/invites'
import { accountsAdmin } from './routes/accounts-admin'
import { authEmail } from './routes/auth-email'
import { account } from './routes/account'
import {avatarSettings} from './routes/avatar'
import { authLinuxdo } from './routes/auth-linuxdo'
import { authGoogle } from './routes/auth-google'
import { cleanupAccounts } from './services/account-cleanup'
import {storeUpload,claimUploadKeys,commitUploadContent,cleanupUploads} from './services/upload-operations'
import {settleInviteRewards} from './services/invite-rewards'
import { accountBinding } from './routes/account-binding'
import { accountMerge } from './routes/account-merge'
import {isRetiredAccountError} from './services/account-ids'
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { STICKERS } from './stickers'
import { UNICODE_EMOJI, UNICODE_GROUPS } from './emoji'
import { chatRoadContent } from './chat-road'
import { authorFilter, tagFilter, cleanSeen } from './browse-filter'
import { cleanPacket, cleanExternalPacket, packetClue, packetText, packetReferenceUrl, sharedPacket, sharedPacketStatements, type PacketConfig, type ExternalPacket } from './redpacket'
import { sendPacketReminders } from './redpacket-reminders'
import { cleanPacketSnapshot } from './redpacket-status'
import { publicPacketDraw, drawSyncStatements } from './redpacket-draw'
import {fishFunding} from './routes/fish-funding'
import {nativeLdc,handleNativeGameMessage,claimNative,settlePendingEscalationAwards,settlePacketDraws,settleCompensationAwards} from './routes/native-ldc'
import {nativeCreation,nativeView,puzzleRewardCreation,type NativePacket} from './ldc/packets'
import {expireGuessGames} from './ldc/expiry'
import {settleFarmLeases} from './farm/leases'
import {settleMarket} from './farm/market'
import {settleConflicts} from './farm/conflict'
import {runGuessQueue} from './ldc/queue'
import {runGuessEscalation} from './ldc/escalation'
import { OFFICIAL_TITLES, officialTitleId } from './official-titles'

// 常用回应（选择器第一页）：Unicode 表情 + 平台表情（包:名，图片在 public/stickers）。心形「喜欢」单独计数
// 实际可用的是 UNICODE_EMOJI 全部 + 所有平台表情
const EMOJIS: [string, string][] = [
  // linux.do 帖子底部那排回应
  ['❤️', '爱心'], ['👍', '赞'], ['😆', '哈哈'], ['😮', '哇'], ['👏', '鼓掌'],
  ['🎊', '彩球'], ['🤗', '抱抱'], ['ld:distorted_face', '瞪眼'], ['ld:tieba_087', '猛灌'], ['ld:bili_057', '叼玫瑰'],
  ['😳', '脸红'], ['🥲', '含泪'], ['🦃', '火鸡'], ['😺', '猫猫'],
  ['😂', '笑哭'], ['🤣', '笑疯'], ['tieba:antic', '滑稽'], ['weibo:doge', '狗头'], ['bb:tiaokan', '偷看'],
  ['😭', '大哭'], ['tieba:huge_sweat', '汗'], ['qq:working', '搬砖'], ['qq:hair_loss', '秃了'],
  ['🔥', '火'], ['🤔', '思考'], ['👀', '围观'], ['🤝', '握手'],
]
const isReaction = (k: string) => k === '+1' || UNICODE_EMOJI.has(k) || STICKERS.has(k) || EMOJIS.some(([e]) => e === k)
// 带这些标签的图算敏感，前端「模糊慎点」模式下会盖住（慎点图本身也算）
const SENSITIVE_TAGS = ['番号/车牌', '番号', '车牌', 'NSFW', 'nsfw', '涩图', '福利']
// 统称 NSFW：慎点图 + 带敏感标签的图。memes.nsfw 列由触发器按这个列表算，改了要同步 migrations/0001_perf.sql
// 列表参数 nsfw=0 不看 NSFW，nsfw=only 只看 NSFW
type NsfwMode = 'all' | 'hide' | 'only'
const nsfwMode = (c: C): NsfwMode => (c.req.query('nsfw') === '0' ? 'hide' : c.req.query('nsfw') === 'only' ? 'only' : 'all')
const NSFW_WHERE: Record<NsfwMode, string> = { all: '', hide: 'm.nsfw = 0', only: 'm.nsfw = 1' }
const DAY_SQL = "date(m.created_at, 'unixepoch', '+8 hours')" // 按北京时间分天
const ANCHOR_MAX = 30
const SESSION_TTL = 30 * 86400
const PAGE_SIZE = 20
const MAX_UPLOAD = 20 * 1024 * 1024 // 图片、GIF、视频、群聊文件都是 20MB
const MAX_ITEMS = 12 // 一帖 / 一条消息最多几张
const REPLY_MAX = 12 // 一句回应的字数上限
const REPLY_CAP = 300 // 每张图最多多少条回应
const REPLY_SHOW_CARD = 30 // 卡片上滚动展示的条数
const REPLY_SHOW_FULL = 200 // 详情里展示的条数
const DEFAULT_FOLDERS = ['稍后再看', '表情备用']

const app = new Hono<Ctx>()

// ---------- 工具 ----------

// 答案规范化：全半角统一、忽略大小写和空白
const normAnswer = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
// 装扮：称号（字 + 预设样式）、炫彩名配色、消息气泡、在哪儿生效。预设只收白名单和 #rrggbb 颜色；自定义样式走 cleanCss 严格清洗
const officialTitlesOf = async (c: C, id: number) => (await c.env.DB.prepare('SELECT title AS id, granted_at FROM user_official_titles WHERE user_id = ? ORDER BY granted_at, title').bind(id).all()).results
const imageOf = (m: { image_key?: string | null; image_url?: string | null }) =>
  m.image_key ? `/img/${m.image_key}` : m.image_url ?? ''
const intIn = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number.parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt
}
const parseTags = (raw: unknown) =>
  [...new Set(String(raw ?? '').split(/[,，\s#]+/).map((t) => t.trim().slice(0, 12)).filter(Boolean))].slice(0, 5)

// ---------- 中间件 ----------

app.onError((err, c) => {
  if(isRetiredAccountError(err)){
    if(c.req.path.startsWith('/auth/'))return authFail(c,'账号已合并，请重新登录。','/',403)
    c.header('cache-control','no-store');return c.json({error:'账号已合并，请重新登录后重试',code:'account_retired'},409)
  }
  if(err instanceof AiError)return Response.json({error:err.message,code:err.code},{status:err.status,headers:{'cache-control':'no-store'}})
  if (err instanceof HTTPException) return c.json({ error: err.message, ...(err.cause && typeof err.cause==='object' && 'code' in err.cause && typeof err.cause.code==='string' ? {code:err.cause.code} : {}) }, err.status)
  console.error(err)
  // 登录回调里连 Linux.DO 超时 / 断网：给能点「重新登录」的页面，不甩 JSON
  if (c.req.path.startsWith('/auth/')) return authFail(c, '登录服务暂时不可用，请稍后重试。', c.req.query('next') ?? '/', 502)
  return c.json({ error: '服务器开小差了' }, 500)
})

// 地区限制：按 Cloudflare 判定的来源国家拦截，默认关闭；wrangler.toml 里设 BLOCK_COUNTRIES = "CN" 打开（港澳台是 HK / MO / TW）
// 只能拦住走到 Worker 的请求，静态文件要靠 Cloudflare WAF 规则一起拦，见 README
const BLOCK_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>尽欢 · 暂不可用</title><body style="font:16px/1.7 system-ui,sans-serif;max-width:520px;margin:18vh auto;padding:0 24px;color:#333">
<h1 style="font-size:22px">本站暂不向当前地区提供服务</h1><p>This site is not available in your region.</p></body>`
app.use('*', async (c, next) => {
  const list = (c.env.BLOCK_COUNTRIES ?? 'none').toUpperCase().split(',').map((s) => s.trim()).filter((s) => s && s !== 'NONE')
  const country = String((c.req.raw as { cf?: { country?: string } }).cf?.country ?? '').toUpperCase()
  if (country && list.includes(country)) {
    return c.req.path.startsWith('/api/') ? c.json({ error: '本站暂不向当前地区提供服务' }, 451) : c.html(BLOCK_PAGE, 451)
  }
  await next()
})

app.use('*', async (c, next) => {
  c.set('user', null)
  // These two read-only media routes are public and never consume identity.
  // Keep region checks above and normal authentication for every other route/method.
  const publicMedia = (c.req.method === 'GET' || c.req.method === 'HEAD') &&
    (c.req.path.startsWith('/img/') || c.req.path === '/ext')
  const sid = publicMedia ? undefined : getCookie(c, 'sid')
  if (sid) {
    const sessionId = await sha256(sid)
    const u = await c.env.DB.prepare(
      "SELECT u.*,s.seen_at AS session_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0 AND u.kind = 'user'",
    )
      .bind(sessionId, now())
      .first<User & {session_seen_at:number}>()
    if (u) {
      c.set('user', u)
      // 在线时间：两分钟内只写一次，省 D1 写额度
      const t = now()
      const updates:D1PreparedStatement[]=[]
      if(t-(u.last_seen??0)>120)updates.push(c.env.DB.prepare('UPDATE users SET last_seen=? WHERE id=?').bind(t,u.id))
      if(t-u.session_seen_at>120)updates.push(c.env.DB.prepare('UPDATE sessions SET seen_at=? WHERE id=?').bind(t,sessionId))
      if(updates.length)c.executionCtx.waitUntil(c.env.DB.batch(updates).catch(()=>{}))
    }
  }
  // 简单的 CSRF 防护：写操作必须同源
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin')
    if (origin && origin !== new URL(c.req.url).origin) fail(403, '非法来源')
  }
  await next()
})

// ---------- Linux.DO 登录 ----------

app.route('/',sharedRoutes)

app.route('/', authLinuxdo)
app.route('/', authGoogle)

// 登录出错时给一个能点的页面，别只甩一行字（新用户会以为登录挂了）
const authFail = (c: C, msg: string, next = '/', status: 400 | 403 | 502 = 400) => {
  const href = '/auth/login?next=' + encodeURIComponent(safeNext(next))
  return c.html(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录没成功 · 尽欢</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f6f8;color:#222}
.c{max-width:360px;margin:20px;padding:28px 24px;border-radius:16px;background:#fff;box-shadow:0 6px 30px rgba(0,0,0,.08);text-align:center}h1{font-size:19px;margin:0 0 8px}p{margin:0 0 18px;color:#666}
a{display:inline-block;margin:4px;padding:9px 20px;border-radius:10px;text-decoration:none;font-weight:600}.p{background:#16a34a;color:#fff}.g{color:#555;background:#eef0f3}</style></head>
<body><div class="c"><h1>登录没成功</h1><p>${msg.replace(/[<>&]/g, '')}</p><a class="p" href="${href}">重新登录</a><a class="g" href="/">先逛逛</a></div></body></html>`, status)
}

// 测试登录：不走 linux.do 授权，直接以某个用户名登录。只有配置了 DEV_LOGIN_KEY（至少 16 位）才启用
// 测试账号用负数 ID，和 linux.do 的真实用户 ID 不会撞
const devKeyOk = async (c: C, key: string) =>
  (c.env.DEV_LOGIN_KEY ?? '').length >= 16 && (await sha256(key)) === (await sha256(c.env.DEV_LOGIN_KEY!))
const devId = async (name: string) => -(Number.parseInt((await sha256('dev:' + name.toLowerCase())).slice(0, 12), 16) % 1e12) - 1

app.get('/auth/dev', (c) => {
  if ((c.env.DEV_LOGIN_KEY ?? '').length < 16) return c.notFound()
  const next = safeNext(c.req.query('next'))
  return c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>测试登录</title><style>body{font:15px/1.6 system-ui,sans-serif;max-width:360px;margin:12vh auto;padding:0 16px}
label{display:block;margin:10px 0 4px}input,select{width:100%;box-sizing:border-box;padding:8px;font:inherit}
button{margin-top:16px;width:100%;padding:10px;font:inherit;background:#2f7d6d;color:#fff;border:0;border-radius:6px}
p{color:#888;font-size:13px}</style>
<h2>测试登录</h2><p>不经过 LINUX DO 授权，仅用于测试。测试账号和真实账号互不影响。</p>
<form method="post"><input type="hidden" name="next" value="${next.replace(/[&"<>]/g, '')}">
<label>测试口令</label><input name="key" type="password" required autocomplete="current-password">
<label>用户名</label><input name="username" required maxlength="20" pattern="[A-Za-z0-9_\\-\\u4e00-\\u9fa5]+" value="tester">
<label>信任等级</label><select name="tl">${[0, 1, 2, 3, 4].map((n) => `<option${n === 2 ? ' selected' : ''}>${n}</option>`).join('')}</select>
<label><input type="checkbox" name="admin" value="1" style="width:auto"> 管理员</label>
<button>登录</button></form>`)
})

app.post('/auth/dev', async (c) => {
  if ((c.env.DEV_LOGIN_KEY ?? '').length < 16) return c.notFound()
  const f = await c.req.parseBody()
  if (!(await devKeyOk(c, String(f.key ?? '')))) return c.text('测试口令不对', 403)
  const username = String(f.username ?? '').trim().slice(0, 20)
  if (!/^[A-Za-z0-9_\-一-龥]+$/.test(username)) return c.text('用户名只能用字母、数字、下划线和汉字', 400)
  const next = safeNext(f.next)
  const id = await devId(username)
  if(await c.env.DB.prepare('SELECT 1 FROM account_retirements WHERE source_id=?').bind(id).first())return c.text('此测试账号已合并，请换一个测试名',409)
  if(await c.env.DB.prepare('SELECT 1 FROM users WHERE username=? COLLATE NOCASE AND id<>?').bind(username,id).first())return c.text('这个用户名已被占用，换一个测试名',409)
  const existing = await c.env.DB.prepare('SELECT disabled,kind FROM users WHERE id=?').bind(id).first<{disabled:number;kind:string}>()
  if(existing && (existing.disabled || existing.kind!=='user'))return c.text('账号已停用，请联系管理员',403)
  const identity = await c.env.DB.prepare("SELECT user_id FROM identities WHERE provider='dev' AND subject=?").bind(username.toLowerCase()).first<{user_id:number}>()
  if(identity && identity.user_id!==id)return c.text('测试身份已关联其他账号',409)
  const t = now()
  const sid = randHex(32)
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO users (id, username, name, avatar, trust_level, silenced, is_admin, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, 0, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET trust_level = excluded.trust_level, is_admin = excluded.is_admin, updated_at = excluded.updated_at
       WHERE users.disabled=0 AND users.kind='user'`,
    ).bind(id, username, `${username}（测试）`, intIn(f.tl, 0, 4, 2), f.admin === '1' ? 1 : 0, t, t),
    c.env.DB.prepare(`INSERT INTO sessions(id,user_id,expires_at,created_at,seen_at,method,ua)
      SELECT ?,id,?,?,?,'dev',? FROM users WHERE id=? AND disabled=0 AND kind='user'`)
      .bind(await sha256(sid),t+SESSION_TTL,t,t,(c.req.header('user-agent')??'').slice(0,120),id),
    c.env.DB.prepare(`INSERT INTO identities(provider,subject,user_id,username,created_at,last_login_at)
      SELECT 'dev',?,id,?,?,? FROM users WHERE id=? AND disabled=0 AND kind='user'
      ON CONFLICT(provider,subject) DO UPDATE SET last_login_at=excluded.last_login_at WHERE identities.user_id=excluded.user_id`)
      .bind(username.toLowerCase(),username,t,t,id),
    joinDefaultGroups(c, id),
  ]).catch(error=>{
    if(String(error).includes('UNIQUE constraint failed: users.username'))fail(409,'这个用户名已被占用，换一个测试名')
    throw error
  })
  if(!result[1].meta.changes)return c.text('账号已停用，请联系管理员',403)
  setCookie(c, 'sid', sid, { httpOnly: true, secure: c.req.url.startsWith('https:'), sameSite: 'Lax', path: '/', maxAge: SESSION_TTL })
  return c.redirect(next)
})

app.post('/auth/logout', async (c) => {
  const sid = getCookie(c, 'sid')
  if (sid) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(sid)).run()
  deleteCookie(c, 'sid', { path: '/' })
  return c.json({ ok: true })
})

app.get('/api/me', async (c) => {
  const u = c.get('user')
  const [limits, badges, officialTitles, linuxdo, unlocks, farmSave] = u ? await Promise.all([activeLimits(c, u.id), badgesOf(c, u.id), officialTitlesOf(c, u.id),c.env.DB.prepare("SELECT username FROM identities WHERE user_id=? AND provider='linuxdo' LIMIT 1").bind(u.id).first<{username:string}>(),c.env.DB.prepare('SELECT item FROM user_unlocks WHERE user_id=?').bind(u.id).all<{item:string}>(),c.env.DB.prepare('SELECT state FROM farm_saves WHERE user_id=?').bind(u.id).first<{state:string}>()]) : [[], [], [],null,null,null]
  if (u) settleLater(c)
  return c.json({
    limits, official_titles: OFFICIAL_TITLES, guess_rewards: GUESS_REWARDS, luck_rewards: LUCK_REWARDS, rank_rewards: RANK_REWARDS, activity_rewards:ACTIVITY_REWARDS, farm_badges:FARM_BADGES,
    user: u && { id: u.id, username: u.username, name: u.name, avatar: u.avatar, trust_level: u.trust_level,
      silenced: !!u.silenced, is_admin: !!u.is_admin, fancy: isFancy(u), notif_prefs: notifPrefs(u), nick: u.nick ?? null, bio: u.bio ?? null, deco: decoOf(u.deco),
      role: u.role ?? null, owner: isOwner(c, u), cosmetic_access:isOwner(c,u)?'all':null, can_manage_ai:canManageAi(c,u), chat_admin: isChatAdmin(u), badges, farm_badge_progress:farmBadgeProgress(farmSave?.state), unlocks:unlocks?.results.map(x=>x.item)??[], official_titles: officialTitles, linuxdo_username:linuxdo?.username??null },
    emojis: EMOJIS.map(([key, label]) => ({ key, label })),
    emoji_groups: UNICODE_GROUPS,
    nsfw_tags: SENSITIVE_TAGS,
    min_post_trust_level: intIn(c.env.MIN_POST_TRUST_LEVEL, 0, 4, 1),
  })
})

// 站内昵称 / 个签：昵称存 nick，同时写进 name（各处都读 name）；清空昵称就等下次登录用回 linux.do 的名字
app.patch('/api/me/profile', async (c) => {
  const u = needUser(c)
  const allCosmetics = isOwner(c,u)
  const b = await jsonBody<{ nick?: unknown; bio?: unknown; deco?: unknown }>(c)
  const sets: string[] = []
  const args: unknown[] = []
  let official: string | null = null
  let wornBadge: string | null = null
  let raffle: string | null = null
  let personal: string | null = null
  let guess: string | null = null
  if (b.deco !== undefined) {
    const d = cleanDeco(b.deco)
    if(d?.gr){
      const reward=guessReward(d.gr)||luckReward(d.gr)||rankReward(d.gr)||activityReward(d.gr)!
      guess=('series' in reward?reward.series:'guess')+':'+reward.level
      if(!allCosmetics&&!await c.env.DB.prepare('SELECT 1 FROM user_unlocks WHERE user_id=? AND item=?').bind(u.id,guess).first())fail(400,'尚未解锁这个成长等级')
      if(d.ot||d.rt||(b.deco as Record<string,unknown>).ft||(b.deco as Record<string,unknown>).pt)fail(400,'一次只能佩戴一套称号装扮')
    }
    const requested = b.deco && typeof b.deco==='object' ? (b.deco as Record<string,unknown>).ft : null
    if(requested != null && requested !== '') {
      raffle=raffleTitleId(requested)
      if(!raffle || !raffleTitleEnabled(raffle)) fail(409,'该套装已下线或不可用')
    }
    const requestedPersonal=b.deco && typeof b.deco==='object' ? (b.deco as Record<string,unknown>).pt : null
    if(requestedPersonal != null && requestedPersonal !== '') {
      personal=personalTitleId(requestedPersonal)
      if(!personal) fail(409,'专属套装不可用')
      if(raffle || d?.ot || d?.rt) fail(400,'一次只能佩戴一套称号装扮')
    }
    for(const item of [d?.rt==='guangjie'?'title:guangjie':null,d?.bb==='yinlu'?'bubble:yinlu':null]){
      if(item&&!allCosmetics&&!await c.env.DB.prepare('SELECT 1 FROM user_unlocks WHERE user_id=? AND item=?').bind(u.id,item).first())fail(400,'还没有解锁这件邀请奖励')
    }
    if (d?.ot) {
      official = d.ot
      if (!allCosmetics&&!await c.env.DB.prepare('SELECT 1 FROM user_official_titles WHERE user_id = ? AND title = ?').bind(u.id, d.ot).first()) fail(400, '还没有获得这个官方称号')
    }
    if (d) delete d.bn
    if (d?.bd) {
      const own = await c.env.DB.prepare('SELECT n FROM user_badges WHERE user_id = ? AND badge = ?').bind(u.id, d.bd).first<{ n: number }>()
      if (!allCosmetics&&(!own || own.n<=0)) fail(400, '还没有这枚徽章')
      wornBadge=d.bd
      if(own?.n)d.bn=own.n
      if(allCosmetics)d.bl=d.bd==='guide'?4:5 // 外观等级，不伪造获奖次数。
    }
    // 拥有资格在最终 UPDATE 内复核；佩戴可摘下，等级从中奖与授予记录计算。
    let expression='?'
    args.push(JSON.stringify(d ?? {}))
    if(raffle){
      const permanent=allCosmetics?'5200':titleLevelSql('users.id',"'"+raffle+"'"),trial=`SELECT level FROM title_trials WHERE user_id=users.id AND title='${raffle}' AND expires_at>${now()}`
      expression=`json_set(?, '$.ft',?, '$.fn',MAX(${permanent},COALESCE((${trial}),0)), '$.fp',${permanent}, '$.fxp',COALESCE((SELECT expires_at FROM title_trials WHERE user_id=users.id AND title='${raffle}' AND expires_at>${now()}),0))`
      args.push(raffle)
    }
    if(wornBadge){expression=`json_set(${expression}, '$.bn', (SELECT n FROM user_badges WHERE user_id=? AND badge=?))`;args.push(u.id,wornBadge)}
    if(personal){expression=`json_set(${expression}, '$.pt', ?)`;args.push(personal)}
    sets.push(`deco = ${expression}`)
  }
  if (b.nick !== undefined) {
    const nick = String(b.nick ?? '').replace(/\s+/g, ' ').trim().slice(0, 20)
    sets.push('nick = ?', 'name = ?')
    args.push(nick || null, nick || null)
  }
  if (b.bio !== undefined) {
    sets.push('bio = ?')
    args.push(String(b.bio ?? '').replace(/\r/g, '').trim().slice(0, 80) || null)
  }
  if (!sets.length) fail(400, '没有要改的')
  const r = await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND (?=1 OR ((? IS NULL OR EXISTS (SELECT 1 FROM user_official_titles WHERE user_id = users.id AND title = ?))
    AND (? IS NULL OR EXISTS(SELECT 1 FROM user_badges WHERE user_id=users.id AND badge=? AND n>0))
    AND (? IS NULL OR EXISTS(SELECT 1 FROM chat_title_raffles WHERE winner_id=users.id AND title=? AND status='drawn')
      OR EXISTS(SELECT 1 FROM title_awards WHERE user_id=users.id AND title=?)
      OR EXISTS(SELECT 1 FROM user_unlocks WHERE user_id=users.id AND item=?)
      OR EXISTS(SELECT 1 FROM title_trials WHERE user_id=users.id AND title=? AND expires_at>?))
    AND (? IS NULL OR EXISTS(SELECT 1 FROM user_unlocks WHERE user_id=users.id AND item=?))
    AND (? IS NULL OR EXISTS(SELECT 1 FROM user_unlocks WHERE user_id=users.id AND item=?)))) RETURNING nick, name, bio, deco`)
    .bind(...args, now(), u.id,allCosmetics?1:0, official, official,wornBadge,wornBadge,raffle,raffle,raffle,raffle?'raffle:'+raffle:null,raffle,now(),personal,personal?'personal:'+personal:null,guess,guess).first<{ nick: string | null; name: string | null; bio: string | null; deco: string | null }>()
  if (!r) fail(409, '称号资格已变化，请刷新后再试')
  return c.json({ ok: true, ...r, deco: decoOf(r?.deco) })
})

// 用户名片：点回应里的头像时展示。只有导入作者名、还没登录过的也能查到发布数
app.get('/api/users/:username', async (c) => {
  const name = c.req.param('username').slice(0, 60)
  const db = c.env.DB
  const u = await db.prepare(
    "SELECT id, username, name, avatar, trust_level, is_admin, fancy, deco, created_at, bio, last_seen,(SELECT username FROM identities i WHERE i.user_id=users.id AND provider='linuxdo' LIMIT 1) AS linuxdo_username FROM users WHERE username = ? COLLATE NOCASE",
  ).bind(name).first<{ id: number; username: string; name: string | null; avatar: string | null; trust_level: number; is_admin: number; fancy: number | null; deco: string | null; created_at: number; bio: string | null; last_seen: number;linuxdo_username:string|null }>()
  const [posts, acts] = await Promise.all([
    db.prepare(
      `SELECT (SELECT COUNT(*) FROM memes WHERE hidden = 0 AND author_id = ?1)
        + (SELECT COUNT(*) FROM memes WHERE hidden = 0 AND author_name = ?2 COLLATE NOCASE AND (author_id IS NULL OR author_id != ?1)) AS n`,
    ).bind(u?.id ?? -1, name).first<{ n: number }>(),
    u ? db.prepare(
      `SELECT (SELECT COUNT(*) FROM short_replies WHERE user_id = ?1) AS replies,
              (SELECT COUNT(*) FROM comments WHERE user_id = ?1 AND deleted = 0) AS comments`,
    ).bind(u.id).first<{ replies: number; comments: number }>() : null,
  ])
  if (!u && !posts?.n) return c.json({ error: '没有这个用户' }, 404)
  const badges = u ? await badgesOf(c, u.id) : []
  return c.json({
    user: {
      id: u?.id ?? null, username: u?.username ?? name, name: u?.name ?? null, avatar: u?.avatar ?? null,linuxdo_username:u?u.linuxdo_username:name,
      trust_level: u?.trust_level ?? null, is_admin: !!u?.is_admin, fancy: isFancy(u), joined_at: u?.created_at ?? null,
      posts: posts?.n ?? 0, replies: acts?.replies ?? 0, comments: acts?.comments ?? 0,
      bio: u?.bio ?? null, last_seen: u?.last_seen || null, deco: decoOf(u?.deco), badges, official_titles: u ? await officialTitlesOf(c, u.id) : [],
    },
  })
})

// ---------- 梗图 ----------

// 公开发图人候选，仅返回已有公开帖的作者，不暴露账号管理字段。
app.get('/api/authors', async (c) => {
  const q = (c.req.query('q') || '').trim().slice(0, 60)
  const like = '%' + q.replace(/[\\%_]/g, x => '\\' + x) + '%'
  const mode = nsfwMode(c)
  const { results } = await c.env.DB.prepare(`
    SELECT COALESCE(u.username,old.username,m.author_name) AS username,
      COALESCE(u.nick,old.nick,u.name,old.name,m.author_name) AS name,
      COALESCE(u.avatar,old.avatar) AS avatar, COUNT(*) AS posts
    FROM ${galleryCoreFrom(c)} LEFT JOIN users u ON u.id=m.author_id
      LEFT JOIN users old ON u.id IS NULL AND old.username=m.author_name COLLATE NOCASE
    WHERE m.hidden=0 AND m.author_name IS NOT NULL AND COALESCE(u.kind,old.kind,'user')='user' ${NSFW_WHERE[mode] ? 'AND ' + NSFW_WHERE[mode] : ''}
      AND (?='' OR COALESCE(u.username,old.username,m.author_name) LIKE ? ESCAPE '\\'
        OR COALESCE(u.nick,old.nick,u.name,old.name,'') LIKE ? ESCAPE '\\')
    GROUP BY COALESCE(u.username,old.username,m.author_name) COLLATE NOCASE ORDER BY posts DESC,1 COLLATE NOCASE LIMIT 50
  `).bind(q,like,like).all<{ username: string; name: string | null; avatar: string | null; posts: number }>()
  return c.json({ authors: results })
})

type MemeRow = {
  id: number; title: string; content: string; image_url: string | null; thumb_url: string | null
  image_key: string | null; width: number | null; height: number | null; gallery: string | null; spoiler: number; ai_off:number
  series: string | null; source_url: string | null; ld_likes: number; author_id: number | null
  author_name: string | null; like_count: number; reaction_count: number; reply_count: number
  comment_count: number; fav_count: number; created_at: number; layout?: string
  puzzle_id?: number | null; author_avatar?: string | null; author_deco?: string | null; author_nick?: string | null; author_fancy?: number | null; kind?: string
}
// u 是图（视频 / 实况时是封面帧），v 是视频地址，k: 'v' 视频 / 'l' 实况 / 'g' 动图，缺省是普通图
// o：局部打码时的原图，u 是打过码的那张；点「看原图」才换成 o
// k: 'f' 群聊文件附件：u 是下载地址，n 文件名，s 字节数
type GalleryItem = { u: string; t?: string; w?: number | null; h?: number | null; v?: string; k?: 'v' | 'l' | 'g' | 'f'; o?: string; n?: string; s?: number }
type ReplyPerson = { deco: string | null; user_id: number; username: string | null; name: string | null; avatar: string | null; text: string; at: number; n: number }

const MEME_COLS = `m.*, u.avatar AS author_avatar, u.deco AS author_deco, COALESCE(u.nick,u.name) AS author_nick, u.fancy AS author_fancy, u.trust_level AS author_tl, u.is_admin AS author_admin, (SELECT z.id FROM puzzles z WHERE z.meme_id = m.id) AS puzzle_id`
const MEME_FROM = `memes m LEFT JOIN users u ON u.id = m.author_id`
// 热度：linux.do 赞 + 站内喜欢/表情/短句/评论/收藏，存在 memes.hot（触发器维护），配合 idx_memes_hot 不用整表排序

const galleryOf = (m: MemeRow): GalleryItem[] => {
  if (m.gallery) {
    try { return JSON.parse(m.gallery) as GalleryItem[] } catch {}
  }
  // 文字帖可以不配图
  if (!m.image_key && !m.image_url) return []
  return [{ u: imageOf(m), t: m.thumb_url ?? undefined, w: m.width, h: m.height }]
}

// 卡片上的纯文本摘要：去掉折叠块和遮挡标记
const snippet = (s: string, n = 140) => {
  const t = s.replace(/\[details(?:="[^"]*")?\][\s\S]*?\[\/details\]/g, ' ')
    .replace(/\[spoiler\][\s\S]*?\[\/spoiler\]/g, '▇▇').replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

const card = (m: MemeRow) => {
  const images = galleryOf(m)
  const kind = m.kind === 'text' ? 'text' : 'image'
  // 文字帖卡片占满整行，摘要给长一些
  const text = snippet(socialPostContent(m.content,m.source_url), kind === 'text' ? 420 : 140)
  return {
    id: m.id, kind, title: m.title, text, text_cut: text.endsWith('…') || /\[(details|spoiler)/.test(m.content ?? ''), image: imageOf(m), thumb: m.thumb_url ?? imageOf(m),
    width: m.width, height: m.height, spoiler: !!m.spoiler,
    // 多图一律轮播（宫格已去掉），卡片要全部图
    layout: 'carousel',
    images, image_count: images.length,
    series: m.series, source_url: m.source_url, ld_likes: m.ld_likes, like_count: m.like_count,
    reaction_count: m.reaction_count, reply_count: m.reply_count, comment_count: m.comment_count,
    created_at: m.created_at, author_name: m.author_name, author_nick: m.author_nick ?? null, author_avatar: m.author_avatar ?? null, author_deco: decoOf(m.author_deco), author_fancy: isFancy({ fancy: m.author_fancy, trust_level: (m as MemeRow & { author_tl?: number }).author_tl, is_admin: (m as MemeRow & { author_admin?: number }).author_admin }),
    has_puzzle: !!m.puzzle_id,
  }
}

// 给一批梗图补上聚合数据和「我」的状态：表情、短句、喜欢、收藏、看过
async function decorate(c: C, rows: MemeRow[], full = false) {
  if (!rows.length) return []
  const u = c.get('user')
  const ids = JSON.stringify(rows.map((r) => r.id))
  const IN = 'meme_id IN (SELECT value FROM json_each(?))'
  const q = <T>(sql: string, ...args: unknown[]) =>
    c.env.DB.prepare(sql).bind(...args).all<T>().then((r) => r.results)
  const none = Promise.resolve([] as never[])
  const [tags, reacts, replies, people, kinds, myReacts, myReplies, myLikes, myFavs, mySeen] = await Promise.all([
    q<{ meme_id: number; tag: string }>(`SELECT meme_id, tag FROM meme_tags WHERE ${IN}`, ids),
    q<{ meme_id: number; emoji: string; n: number }>(
      `SELECT meme_id, emoji, COUNT(*) AS n FROM reactions WHERE ${IN} GROUP BY meme_id, emoji`, ids),
    // 相同短句合并计数，每张图取最热的几种
    q<{ meme_id: number; text: string; n: number }>(
      `SELECT meme_id, text, n FROM (
         SELECT meme_id, text, COUNT(*) AS n, MAX(created_at) AS t,
           ROW_NUMBER() OVER (PARTITION BY meme_id ORDER BY COUNT(*) DESC, MAX(created_at) DESC) AS rk
         FROM short_replies WHERE ${IN} GROUP BY meme_id, text)
       WHERE rk <= ? ORDER BY meme_id, rk`, ids, full ? 200 : 3),
    // 逐人展示（带头像，重复的话也不折叠）：取最新的 N 条，按时间从早到晚排；n = 说这句的总人数
    q<ReplyPerson & { meme_id: number }>(
      `SELECT meme_id, user_id, username, name, avatar, deco, text, at, n FROM (
         SELECT r.meme_id, r.user_id, u.username, u.name, u.avatar, u.deco, r.text, r.created_at AS at, r.n,
           ROW_NUMBER() OVER (PARTITION BY r.meme_id ORDER BY r.created_at DESC, r.user_id) AS rk
         FROM (SELECT s.*, COUNT(*) OVER (PARTITION BY s.meme_id, s.text) AS n
               FROM short_replies s WHERE s.${IN}) r
         LEFT JOIN users u ON u.id = r.user_id)
       WHERE rk <= ? ORDER BY meme_id, at, user_id`, ids, full ? REPLY_SHOW_FULL : REPLY_SHOW_CARD),
    q<{ meme_id: number; k: number }>(
      `SELECT meme_id, COUNT(DISTINCT text) AS k FROM short_replies WHERE ${IN} GROUP BY meme_id`, ids),
    u ? q<{ meme_id: number; emoji: string }>(`SELECT meme_id, emoji FROM reactions WHERE user_id = ? AND ${IN}`, u.id, ids) : none,
    u ? q<{ meme_id: number; text: string }>(`SELECT meme_id, text FROM short_replies WHERE user_id = ? AND ${IN}`, u.id, ids) : none,
    u ? q<{ meme_id: number }>(`SELECT meme_id FROM likes WHERE user_id = ? AND ${IN}`, u.id, ids) : none,
    u ? q<{ meme_id: number; folder_id: number }>(`SELECT meme_id, folder_id FROM favorites WHERE user_id = ? AND ${IN}`, u.id, ids) : none,
    u ? q<{ meme_id: number; seen_at: number }>(`SELECT meme_id, seen_at FROM views WHERE user_id = ? AND ${IN}`, u.id, ids) : none,
  ])
  const group = <T extends { meme_id: number }>(list: T[]) => {
    const map = new Map<number, T[]>()
    for (const r of list) map.set(r.meme_id, [...(map.get(r.meme_id) ?? []), r])
    return map
  }
  const [gTag, gReact, gReply, gPeople, gMyReact, gFav] = [group(tags), group(reacts), group(replies), group(people), group(myReacts), group(myFavs)]
  const kindOf = new Map(kinds.map((r) => [r.meme_id, r.k]))
  const myReply = new Map(myReplies.map((r) => [r.meme_id, r.text]))
  const liked = new Set(myLikes.map((r) => r.meme_id))
  const seen = new Map(mySeen.map((r) => [r.meme_id, r.seen_at]))

  return rows.map((m) => {
    const mine = new Set((gMyReact.get(m.id) ?? []).map((r) => r.emoji))
    const counts = new Map((gReact.get(m.id) ?? []).map((r) => [r.emoji, r.n]))
    const mr = myReply.get(m.id) ?? null
    return {
      ...card(m),
      reactions: [...counts].map(([e, n]) => ({ emoji: e, count: n, mine: mine.has(e) })).sort((a, b) => b.count - a.count),
      tags: (gTag.get(m.id) ?? []).map((r) => r.tag),
      sensitive: !!m.spoiler || (gTag.get(m.id) ?? []).some((r) => SENSITIVE_TAGS.includes(r.tag)),
      replies: (gReply.get(m.id) ?? []).map((r) => ({ text: r.text, count: r.n, mine: r.text === mr })),
      full, // 完整版（详情 / 互动返回）带更长的回应列表，前端合并时不让卡片版覆盖掉
      reply_list: (gPeople.get(m.id) ?? []).map(({ meme_id, ...p }) => ({ ...p, deco: decoOf(p.deco), mine: !!u && p.user_id === u.id })),
      reply_kinds: kindOf.get(m.id) ?? 0,
      my_reply: mr,
      liked: liked.has(m.id),
      fav_folders: (gFav.get(m.id) ?? []).map((r) => r.folder_id),
      seen_at: u ? seen.get(m.id) ?? null : null,
      can_manage: canManage(u, m.author_id),
    }
  })
}

const listOrder: Record<string, string> = {
  hot: 'm.hot DESC, m.id DESC',
  old: 'm.created_at ASC, m.id ASC',
  new: 'm.created_at DESC, m.id DESC',
}
// 游客图廊只展示最新 52 张。idx_memes_guest_latest 让子查询的读取量有上界。
const GUEST_GALLERY_SQL = 'm.id IN (SELECT id FROM memes WHERE hidden = 0 ORDER BY created_at DESC, id DESC LIMIT 52)'
const guestGalleryWhere = (c: C) => c.get('user') ? '' : ` AND ${GUEST_GALLERY_SQL}`
const galleryCoreFrom = (c: C) => c.get('user') ? 'memes m' :
  '(SELECT id FROM memes WHERE hidden = 0 ORDER BY created_at DESC, id DESC LIMIT 52) recent CROSS JOIN memes m ON m.id = recent.id'
const galleryFrom = (c: C) => c.get('user') ? MEME_FROM : `${galleryCoreFrom(c)} LEFT JOIN users u ON u.id = m.author_id`
const memeId = (c: C) => intIn(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER, 0)

// 列表筛选：图廊、按天分组、日期导航共用
async function listFilter(c: C) {
  const u = c.get('user')
  const { q = '', tag = '', author = '', puzzle = '', series = '', unseen = '', text = '' } = c.req.query()
  const where = ['m.hidden = 0']
  const args: unknown[] = []
  if (q.trim()) {
    const like = `%${q.trim().replace(/[\\%_]/g, (s) => '\\' + s)}%`
    // 「No.123」「#123」或纯数字：也按全站编号找
    const no = Number(q.trim().match(/^(?:no\.?|#)?\s*(\d{1,9})$/i)?.[1] ?? 0)
    where.push(`(m.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM meme_tags t WHERE t.meme_id = m.id AND t.tag LIKE ? ESCAPE '\\') OR m.id = ?)`)
    args.push(like, like, like, no)
  }
  const tf = tagFilter(tag), af = authorFilter(author)
  if (tf.sql) { where.push(tf.sql); args.push(...tf.args) }
  if (af.sql) { where.push(af.sql); args.push(...af.args) }
  if (series) { where.push('m.series = ?'); args.push(series) }
  if (puzzle) where.push('EXISTS (SELECT 1 FROM puzzles z WHERE z.meme_id = m.id)')
  // text=only 只看文字帖，text=0 不看文字帖
  if (text === 'only') where.push("m.kind = 'text'")
  else if (text === '0') where.push("m.kind != 'text'")
  const mode = nsfwMode(c)
  if (NSFW_WHERE[mode]) where.push(NSFW_WHERE[mode])
  // 没有任何筛选：日期目录、总数、未看数都能用缓存 + view_days 算，不用扫表
  const localSeen = !u && c.req.method === 'POST' ? cleanSeen((await jsonBody<{ seen?: unknown }>(c)).seen) : []
  const plain = !q.trim() && !tag && !author && !series && !puzzle && text !== 'only' && text !== '0' && !localSeen.length
  const base = { where: [...where], args: [...args] }
  // 「只看未看」以首屏时刻为界：边刷边标记已看不会让后续页错位
  const anchor = intIn(c.req.query('before'), 1, Number.MAX_SAFE_INTEGER, 0) || now() + 1
  const seenSql = u ? 'NOT EXISTS (SELECT 1 FROM views v WHERE v.user_id = ? AND v.meme_id = m.id)' : localSeen.length ? 'm.id NOT IN (SELECT value FROM json_each(?))' : '1'
  const seenArgs: unknown[] = u ? [u.id] : localSeen.length ? [JSON.stringify(localSeen)] : []
  if (unseen && u) {
    where.push('NOT EXISTS (SELECT 1 FROM views v WHERE v.user_id = ? AND v.meme_id = m.id AND v.seen_at < ?)')
    args.push(u.id, anchor)
  } else if (unseen && localSeen.length) {
    where.push(seenSql); args.push(...seenArgs)
  }
  return { u, where, args, base, anchor, plain, mode, unseen: !!unseen, seenSql, seenArgs }
}
const isDay = (s = '') => /^\d{4}-\d{2}-\d{2}$/.test(s)
// 北京时间某天的 [起, 止) 时间戳：按 created_at 范围查才能走索引
const dayRange = (d: string) => { const t = Date.parse(d + 'T00:00:00+08:00') / 1000; return [t, t + 86400] as const }
const dayOfTs = (ts: number) => new Date((ts + 8 * 3600) * 1000).toISOString().slice(0, 10)

// 统计缓存：日期目录 / 标签条 / 图集。发图、删图、改标签时触发器会清空，另外 10 分钟过期
const CACHE_TTL = 600
async function cached<T>(c: C, key: string, make: () => Promise<T>): Promise<T> {
  const hit = await c.env.DB.prepare('SELECT body, at FROM stats_cache WHERE key = ?').bind(key).first<{ body: string; at: number }>()
  if (hit && now() - hit.at < CACHE_TTL) return JSON.parse(hit.body) as T
  const val = await make()
  await c.env.DB.prepare('INSERT OR REPLACE INTO stats_cache (key, body, at) VALUES (?, ?, ?)').bind(key, JSON.stringify(val), now()).run()
  return val
}
type DayStat = { day: string; n: number; latest_at: number; latest_id: number; latest_src: number; latest_by: string | null; latest_title: string | null; latest_content: string | null }
// 不带筛选的每日张数（新的在前）
const dayStats = (c: C, mode: NsfwMode) => cached(c, 'days:' + (c.get('user') ? '' : 'guest:') + mode, async () => {
  const w = NSFW_WHERE[mode] ? ' AND ' + NSFW_WHERE[mode] : ''
  // 只有一个 MAX 聚合时，SQLite 的裸列取自最大值那一行：顺带拿到每天最新一张的作者和摘要（伪装模式的会话预览）
  return (await c.env.DB.prepare(
    `SELECT ${DAY_SQL} AS day, COUNT(*) AS n, MAX(m.created_at) AS latest_at, m.author_name AS latest_by, m.id AS latest_id, (m.source_url IS NOT NULL) AS latest_src, m.title AS latest_title,
       substr(m.content, 1, 120) AS latest_content
     FROM ${galleryCoreFrom(c)} WHERE m.hidden = 0${w} GROUP BY day ORDER BY day DESC`,
  ).all<DayStat>()).results
})
// 我每天看过几张（按当前 NSFW 模式算）
async function seenByDay(c: C, uid: number, mode: NsfwMode) {
  // 0058 keeps visible per-day totals consistent across hide, safety and date changes.
  const count = mode === 'hide' ? 'n_safe' : mode === 'only' ? 'n - n_safe' : 'n'
  const { results } = await c.env.DB.prepare(
    `SELECT day, ${count} AS n FROM view_days WHERE user_id=? AND n>0`,
  ).bind(uid).all<{ day: string; n: number }>()
  return new Map(results.map((r) => [r.day, r.n]))
}

const browseMemes = async (c: C) => {
  const sort = listOrder[c.req.query('sort') ?? ''] ? c.req.query('sort')! : 'new'
  const { u, where, args, base, anchor, plain, mode, unseen, seenSql, seenArgs } = await listFilter(c)
  const day = c.req.query('day') ?? ''
  if (isDay(day)) { where.push('m.created_at >= ? AND m.created_at < ?'); args.push(...dayRange(day)) }
  const page = intIn(c.req.query('page'), 1, 1000, 1)
  const limit = intIn(c.req.query('limit'), 1, 40, PAGE_SIZE)
  let offset = c.req.query('offset') != null ? intIn(c.req.query('offset'), 0, 1e6, 0) : (page - 1) * limit
  // focus=梗图id：从这张开始往后取（锚点跳转），前面留 1 张做上下文
  const focus = intIn(c.req.query('focus'), 0, Number.MAX_SAFE_INTEGER, 0)
  if (focus && sort !== 'hot') {
    const f = await c.env.DB.prepare('SELECT created_at, id FROM memes WHERE id = ?').bind(focus).first<{ created_at: number; id: number }>()
    const before = sort === 'old' ? '(m.created_at < ?1 OR (m.created_at = ?1 AND m.id < ?2))' : '(m.created_at > ?1 OR (m.created_at = ?1 AND m.id > ?2))'
    if (f && plain && !unseen && !isDay(day)) {
      // 前面几天的张数从日期目录里加，只数这张图所在的那一天
      const fd = dayOfTs(f.created_at)
      const prior = (await dayStats(c, mode)).filter((d) => (sort === 'old' ? d.day < fd : d.day > fd)).reduce((a, d) => a + d.n, 0)
      const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${galleryCoreFrom(c)} WHERE m.created_at >= ? AND m.created_at < ? AND ${before.replace(/\?1/g, '?').replace(/\?2/g, '?')} AND ${where.join(' AND ')}`)
        .bind(...dayRange(fd), f.created_at, f.created_at, f.id, ...args).first<{ n: number }>()
      offset = Math.max(0, prior + (n?.n ?? 0) - 1)
    } else if (f) {
      const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${galleryCoreFrom(c)} WHERE ${before.replace(/\?1/g, '?').replace(/\?2/g, '?')} AND ${where.join(' AND ')}`)
        .bind(f.created_at, f.created_at, f.id, ...args).first<{ n: number }>()
      offset = Math.max(0, (n?.n ?? 0) - 1)
    }
  }

  // 大偏移量（LINUX DO 伪装按楼层跳转）：先用日期目录定位到那一天，不然 OFFSET 跳过的几千行也算读取
  let qWhere = where, qArgs = args, qOffset = offset
  if (plain && !unseen && sort !== 'hot' && !isDay(day) && offset > 200) {
    const days = await dayStats(c, mode)
    let skip = 0
    for (const d of sort === 'old' ? [...days].reverse() : days) {
      if (skip + d.n > offset) {
        const [s0, s1] = dayRange(d.day)
        qWhere = [...where, sort === 'old' ? 'm.created_at >= ?' : 'm.created_at < ?']
        qArgs = [...args, sort === 'old' ? s0 : s1]
        qOffset = offset - skip
        break
      }
      skip += d.n
    }
  }
  const { results } = await c.env.DB.prepare(
    `SELECT ${MEME_COLS} FROM ${galleryFrom(c)} WHERE ${qWhere.join(' AND ')}
     ORDER BY ${listOrder[sort]} LIMIT ? OFFSET ?`,
  ).bind(...qArgs, limit + 1, qOffset).all<MemeRow>()

  // 首屏附带总数和未看数，用于工具栏「N 张未看」
  let total: number | null = null
  let unseenTotal: number | null = null
  if (offset === 0 && !isDay(day) && plain) {
    const days = await dayStats(c, mode)
    total = days.reduce((a, d) => a + d.n, 0)
    if (u) {
      const seen = await seenByDay(c, u.id, mode)
      unseenTotal = days.reduce((a, d) => a + Math.max(0, d.n - (seen.get(d.day) ?? 0)), 0)
    }
  } else if (offset === 0 && !isDay(day)) {
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN ${seenSql} THEN 1 ELSE 0 END) AS un
       FROM ${galleryCoreFrom(c)} WHERE ${base.where.join(' AND ')}`,
    ).bind(...seenArgs, ...base.args).first<{ n: number; un?: number }>()
    total = row?.n ?? 0
    unseenTotal = row?.un ?? 0
  }
  return c.json({
    items: await decorate(c, results.slice(0, limit)),
    more: results.length > limit, offset, total, unseen_total: unseenTotal, anchor,
  })
}
app.get('/api/memes', browseMemes)
app.post('/api/browse/memes', browseMemes)

// 按天分组的目录：每天多少张、我还有多少张没看。图廊按天折叠和日期跳转用
app.on(['GET', 'POST'], ['/api/days', '/api/browse/days'], async (c) => {
  const { u, where, args, plain, mode, unseen, seenSql, seenArgs } = await listFilter(c)
  const asc = c.req.query('sort') === 'old'
  if (plain) {
    const [days, seen] = await Promise.all([dayStats(c, mode), u ? seenByDay(c, u.id, mode) : Promise.resolve(null)])
    let list = days.map((d) => {
      const un = seen ? Math.max(0, d.n - (seen.get(d.day) ?? 0)) : d.n
      return {
        day: d.day, n: unseen ? un ?? 0 : d.n, unseen: un,
        latest: { at: d.latest_at, by: d.latest_by, id: d.latest_id, src: !!d.latest_src, text: (d.latest_title || snippet(d.latest_content ?? '', 40)).trim() },
      }
    })
    if (unseen) list = list.filter((d) => d.n > 0)
    if (asc) list.reverse()
    // 普通首页把首日卡片随日期目录返回，省掉浏览器等 /days 后再发 /memes 的一次往返。
    // 只覆盖最新排序、首日、无额外筛选；其他路径继续使用原来的列表接口。
    if (c.req.method === 'GET' && c.req.query('first') === '1' && !unseen && !asc && list.length) {
      const day = list[0].day
      const { results } = await c.env.DB.prepare(
        `SELECT ${MEME_COLS} FROM ${galleryFrom(c)} WHERE ${where.join(' AND ')} AND m.created_at >= ? AND m.created_at < ?
         ORDER BY ${listOrder.new} LIMIT 13`,
      ).bind(...args, ...dayRange(day)).all<MemeRow>()
      return c.json({ days: list, firstPage: { day, items: await decorate(c, results.slice(0, 12)), more: results.length > 12,
        offset: 0, anchor: now() + 1 } })
    }
    return c.json({ days: list })
  }
  // 只有一个 MAX 聚合时，SQLite 的裸列取自最大值那一行：顺带拿到每天最新一张的作者和摘要（伪装模式的会话预览）
  const { results } = await c.env.DB.prepare(
    `SELECT ${DAY_SQL} AS day, COUNT(*) AS n, SUM(CASE WHEN ${seenSql} THEN 1 ELSE 0 END) AS unseen,
       MAX(m.created_at) AS latest_at, m.author_name AS latest_by, m.id AS latest_id, (m.source_url IS NOT NULL) AS latest_src, m.title AS latest_title, substr(m.content, 1, 120) AS latest_content
     FROM ${galleryCoreFrom(c)} WHERE ${where.join(' AND ')} GROUP BY day ORDER BY day ${asc ? 'ASC' : 'DESC'}`,
  ).bind(...seenArgs, ...args).all<{
    day: string; n: number; unseen?: number; latest_at: number; latest_id: number; latest_src: number; latest_by: string | null; latest_title: string | null; latest_content: string | null
  }>()
  return c.json({
    days: results.map((d) => ({
      day: d.day, n: d.n, unseen: d.unseen ?? 0,
      latest: { at: d.latest_at, by: d.latest_by, id: d.latest_id, src: !!d.latest_src, text: (d.latest_title || snippet(d.latest_content ?? '', 40)).trim() },
    })),
  })
})

const STRIP_HIDE = /^(第.{1,4}期|梗图合集|摸.{1,2}时刻)$/u
app.get('/api/tags', async (c) => {
  const mode = nsfwMode(c)
  const tags = await cached(c, 'tags:' + (c.get('user') ? '' : 'guest:') + mode, async () => (await c.env.DB.prepare(
    `SELECT t.tag, COUNT(*) AS n FROM ${galleryCoreFrom(c)} JOIN meme_tags t ON t.meme_id = m.id
     WHERE m.hidden = 0 ${NSFW_WHERE[mode] ? 'AND ' + NSFW_WHERE[mode] : ''}
     GROUP BY t.tag ORDER BY n DESC LIMIT 60`,
  ).all<{ tag: string; n: number }>()).results)
  // 从 linux.do 合集导入时带的期数 / 合集名不进标签条（帖子上照常显示、能点）
  return c.json({ tags: tags.filter((t) => !STRIP_HIDE.test(t.tag)).slice(0, 24) })
})

// 图集：按 linux.do 合集帖分组，每组取最热的 4 张做封面
app.on(['GET', 'POST'], ['/api/series', '/api/browse/series'], async (c) => {
  needUser(c)
  const f = await listFilter(c)
  return c.json({ series: f.plain && !f.unseen ? await cached(c, 'series:' + f.mode, () => seriesList(c, f)) : await seriesList(c, f) })
})
async function seriesList(c: C, f: Awaited<ReturnType<typeof listFilter>>) {
  const filter = f.where.join(' AND ')
  const [groups, covers] = await Promise.all([
    c.env.DB.prepare(
      `SELECT series AS name, COUNT(*) AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at,
         SUM(ld_likes + like_count) AS likes
       FROM memes m WHERE series IS NOT NULL AND ${filter} GROUP BY series ORDER BY last_at DESC`,
    ).bind(...f.args).all<{ name: string; n: number; first_at: number; last_at: number; likes: number }>(),
    c.env.DB.prepare(
      `SELECT series, thumb_url, image_url, image_key, nsfw, title FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY series ORDER BY nsfw ASC, ld_likes + like_count DESC, id) AS rk
         FROM memes m WHERE series IS NOT NULL AND ${filter})
       WHERE rk <= 4`,
    ).bind(...f.args).all<{ series: string; thumb_url: string | null; image_url: string | null; image_key: string | null; nsfw: number; title: string | null }>(),
  ])
  return groups.results.map((g) => {
    const cv = covers.results.filter((r) => r.series === g.name)
    return {
      ...g,
      // 说明：这一期最热几张图的标题，有才显示
      desc: cv.map((r) => (r.title ?? '').trim()).filter(Boolean).slice(0, 3).join(' / ').slice(0, 60),
      covers: cv.map((r) => ({ src: r.thumb_url ?? imageOf(r), spoiler: !!r.nsfw })),
    }
  })
}

app.get('/api/memes/:id', async (c) => {
  const id = memeId(c)
  const u = c.get('user')
  const m = await loadMeme(c, id)
  const [[item], tags, pz] = await Promise.all([
    decorate(c, [m], true),
    c.env.DB.prepare('SELECT tag FROM meme_tags WHERE meme_id = ?').bind(id).all<{ tag: string }>(),
    c.env.DB.prepare('SELECT * FROM puzzles WHERE meme_id = ?').bind(id).first<Puzzle>(),
  ])
  return c.json({
    meme: {
      ...item, content: socialPostContent(m.content,m.source_url), images: galleryOf(m), tags: tags.results.map((t) => t.tag), ai_off:!!m.ai_off,
      can_manage: canManage(u, m.author_id), puzzle: pz ? await puzzleView(c, pz) : null,
    },
  })
})
app.get('/api/memes/:id/social-media/:media',async c=>{
 const m=await loadMeme(c,memeId(c)),idx=Number(c.req.param('media'))
 const link=socialLinks(m.source_url||'').find(x=>['x','douyin','weibo','instagram'].includes(x.provider))
 if(!link||!Number.isInteger(idx)||idx<0||idx>11)fail(404,'媒体不存在')
 if(link!.provider==='douyin'||link!.provider==='instagram'){
  const data=await cachedSocialPreview(c,{id:c.get('user')?.id||0},link!),media=data.media?.[idx],video=c.req.query('video')==='1'
  const stored=(m.gallery?JSON.parse(m.gallery):[])[idx] as {external_url?:string;external_video?:string}|undefined
  const backup=video?stored?.external_video:stored?.external_url
  const safeBackup=backup&&(link!.provider==='douyin'?douyinMediaUrl:instagramMediaUrl)(backup,video)
  const url=(video?media?.url:media?.poster||media?.url)||safeBackup
  if(!url)fail(404,'媒体暂不可用，请稍后重试')
  const alternates=[...(video?media?.alternates:media?.posterAlternates||media?.alternates)||[],...(safeBackup?[safeBackup]:[])]
  return socialMediaResponse(c,url!,video?'video':'image',link!.provider,alternates)
 }
 const item=(m.gallery?JSON.parse(m.gallery):[])[idx] as {external_url?:string;external_video?:string}|undefined
 const video=c.req.query('video')==='1',url=video?item?.external_video:item?.external_url
 if(!url||!(link!.provider==='weibo'?weiboMediaUrl:xMediaUrl)(url,video))fail(404,'媒体不存在')
 return socialMediaResponse(c,url!,video?'video':'image',link!.provider)
})

async function loadMeme(c: C, id: number) {
  const m = await c.env.DB.prepare(`SELECT ${MEME_COLS} FROM ${MEME_FROM} WHERE m.id = ? AND m.hidden = 0${guestGalleryWhere(c)}`)
    .bind(id).first<MemeRow>()
  return m ?? fail(404, '这张梗图不存在或已被隐藏')
}

// 互动接口统一返回最新的完整状态，前端直接同步到所有展示这张图的地方
const itemJson = async (c: C, id: number) => c.json({ item: (await decorate(c, [await loadMeme(c, id)], true))[0] })

const RECOUNT = {
  like_count: 'SELECT COUNT(*) FROM likes WHERE meme_id = ?1',
  reaction_count: 'SELECT COUNT(*) FROM reactions WHERE meme_id = ?1',
  reply_count: 'SELECT COUNT(*) FROM short_replies WHERE meme_id = ?1',
  fav_count: 'SELECT COUNT(DISTINCT user_id) FROM favorites WHERE meme_id = ?1',
}
const recount = (c: C, id: number, col: keyof typeof RECOUNT) =>
  c.env.DB.prepare(`UPDATE memes SET ${col} = (${RECOUNT[col]}) WHERE id = ?1`).bind(id)

const sniffImage = (b: Uint8Array): [string, string] | null => {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ['image/png', 'png']
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ['image/jpeg', 'jpg']
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ['image/gif', 'gif']
  const ascii = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return ['image/webp', 'webp']
  return null
}
// 视频：MP4 / MOV（ftyp 盒子）、WebM（EBML 头）。HEIC 也是 ftyp，但浏览器大多放不了，单独拦
const sniffVideo = (b: Uint8Array): [string, string] | 'heic' | null => {
  const ascii = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n))
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4)
    if (/^(heic|heix|hevc|mif1|msf1|avif)$/.test(brand)) return 'heic'
    return brand === 'qt  ' ? ['video/quicktime', 'mov'] : ['video/mp4', 'mp4']
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return ['video/webm', 'webm']
  return null
}
// 先传后发：单个文件一个请求（≤20MB），返回 key；发帖 / 发消息时再引用。这样 12 张图不会挤进一个请求
app.post('/api/uploads', async (c) => {
  const u = needUser(c)
  if (u.silenced) fail(403, '你在 linux.do 处于禁言状态')
  const db = c.env.DB
  const t = now()
  const form = await c.req.formData()
  const f = form.get('file')
  if (!(f instanceof File) || !f.size) fail(400, '请选择文件')
  const file = f as File
  const forAvatar=form.get('for')==='avatar'
  if(forAvatar&&file.size>5*1024*1024)fail(413,'头像不能超过 5 MB，请先缩小图片')
  if (file.size > MAX_UPLOAD) fail(413, '单个文件不能超过 20MB')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const img = sniffImage(bytes)
  if(forAvatar&&!img)fail(415,'头像只支持 PNG / JPG / GIF / WebP 图片')
  const vid = img ? null : sniffVideo(bytes)
  // 群聊可以发任意文件（压缩包、文档等）：一律按二进制存，下载时强制另存为，不在站内打开
  const asFile = form.get('as') === 'file' && ['chat','dm'].includes(String(form.get('for')))
  if (vid === 'heic' && !asFile) fail(415, 'HEIC 格式浏览器看不了：iPhone 可在 设置 → 相机 → 格式 选「兼容性最佳」，或先转成 JPG')
  const kind: [string, string] = asFile
    ? ['application/octet-stream', (file.name.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? 'bin').toLowerCase()]
    : img ?? (vid as [string, string] | null) ?? fail(415, '只支持 PNG / JPG / GIF / WebP 图片和 MP4 / MOV / WebM 视频')
  return c.json(await storeUpload(db,c.env.BUCKET,{
    uid:u.id,nonce:form.get('nonce'),bytes,mime:kind[0],ext:kind[1],purpose:forAvatar?'avatar':form.get('for')==='dm'?'dm':form.get('for')==='chat'?'chat':'meme',
    asFile,limited:rateOn(c)&&u.is_admin!==1,t,
  }))
})

// 发帖 / 发消息时传来的媒体：[{key, poster?, w?, h?, kind?}]。只认本人上传、还没用过的 key，用了就标记
// 存进 gallery 的样子：图本身或封面在 u，视频在 v
const toGallery = (m: Media): GalleryItem & { b?: 1; c?: 1 } => m.kind === 'f' ? { u: `/img/${m.k}`, k: 'f', n: m.n, s: m.s } : ({
  u: `/img/${m.p ?? m.k}`, w: m.w, h: m.h, ...(m.p ? { v: `/img/${m.k}` } : {}), ...(m.kind ? { k: m.kind } : {}), ...(m.o ? { o: `/img/${m.o}` } : {}),
  ...(m.b ? { b: 1 as const } : {}), ...(m.c ? { c: 1 as const } : {}),
})

// 站内限制：管理员可以单独禁某人发群消息 / 评论 / 发帖 / 回应，到期自动解除
type LimitKind = 'chat' | 'comment' | 'post' | 'react'
const LIMIT_KINDS: Record<LimitKind, string> = { chat: '群聊发言', comment: '评论', post: '发帖', react: '回应' }
const fmtUntil = (t: number) => {
  if (!t) return '永久'
  const d = new Date((t + 8 * 3600) * 1000)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
}
async function needNotLimited(c: C, u: User, kind: LimitKind) {
  if (u.is_admin) return
  const r = await c.env.DB.prepare('SELECT until, reason FROM user_limits WHERE user_id = ? AND kind = ? AND (until = 0 OR until > ?)')
    .bind(u.id, kind, now()).first<{ until: number; reason: string | null }>()
  if (!r) return
  fail(403, `你已被禁止${LIMIT_KINDS[kind]}${r.until ? `，到 ${fmtUntil(r.until)} 解除` : ''}${r.reason ? `（${r.reason}）` : ''}`)
}
const activeLimits = async (c: C, uid: number) => (await c.env.DB.prepare(
  'SELECT kind, until, reason, created_at FROM user_limits WHERE user_id = ? AND (until = 0 OR until > ?)',
).bind(uid, now()).all<{ kind: LimitKind; until: number; reason: string | null; created_at: number }>()).results

// 发帖门槛：禁言、信任等级、频率
async function postGate(c: C) {
  const u = needUser(c)
  if (u.silenced) fail(403, '你在 linux.do 处于禁言状态')
  await needNotLimited(c, u, 'post')
  const minTL = intIn(c.env.MIN_POST_TRUST_LEVEL, 0, 4, 1)
  if (u.trust_level < minTL) fail(403, `发帖需要 linux.do 信任等级 ≥ ${minTL}`)
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM memes WHERE author_id = ? AND created_at > ?')
    .bind(u.id, now() - 86400).first<{ n: number }>()
  // 管理员不限；其他人 24 小时内 120 张（「单发」一次就能发十几张）
  if (rateOn(c) && u.is_admin !== 1 && (recent?.n ?? 0) >= 120) fail(429, '一天最多发 120 张，明天再来')
  return u
}
// 整帖慎点或有局部打码的帖子自动带上这个标签（不算 NSFW，只是方便筛 / 屏蔽）
const MASK_TAG = '打码'
type NewMeme = { title: string; content: string; items: Media[]; kind: 'image' | 'text'; spoiler: boolean; tags: string[]; layout?: unknown; ai_off?: boolean }
async function insertMeme(c: C, u: User, p: NewMeme, uploadKeys: string[] = [], fromChat?: {message: ChatRow; uploaderId: number}) {
  const first = p.items[0] as Media | undefined
  // 单张普通图不存 gallery，和以前一样；多张、视频或局部打码才存
  const gallery = p.items.length > 1 || first?.p || first?.o ? JSON.stringify(p.items.map(toGallery)) : null
  const layout = p.items.length > 1 && p.layout !== 'grid' ? 'carousel' : 'grid'
  const insert = c.env.DB.prepare(
    `INSERT INTO memes (title, content, image_key, width, height, gallery, layout, spoiler, author_id, author_name, kind, created_at, ai_off)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(p.title, p.content, first ? first.p ?? first.k : null, first?.w ?? null, first?.h ?? null, gallery, layout,
    p.spoiler ? 1 : 0, u.id, u.username, p.kind, now(),p.ai_off?1:0)
  if ((p.spoiler || p.items.some((x) => x.o)) && !p.tags.includes(MASK_TAG)) p.tags = [...p.tags, MASK_TAG]
  const statements: D1PreparedStatement[] = []
  if(fromChat){
    const m=fromChat.message
    // 复制期间消息可能被撤回、编辑或被另一请求转帖；不允许用过期快照创建新帖。
    statements.push(c.env.DB.prepare(`SELECT json(CASE WHEN EXISTS(
      SELECT 1 FROM chat_messages WHERE id=? AND deleted=0 AND meme_id IS ? AND body=? AND image_key IS ? AND media IS ?
    ) THEN 'true' ELSE 'chat_post_conflict' END)`).bind(m.id,m.meme_id??null,m.body,m.image_key,m.media))
  }
  statements.push(insert)
  if(fromChat)statements.push(c.env.DB.prepare('UPDATE chat_messages SET meme_id=last_insert_rowid(),updated_at=? WHERE id=?').bind(now(),fromChat.message.id))
  if (p.tags.length) statements.push(c.env.DB.prepare(`WITH new_meme AS MATERIALIZED (SELECT last_insert_rowid() AS id)
    INSERT OR IGNORE INTO meme_tags(meme_id,tag) SELECT new_meme.id,j.value FROM new_meme CROSS JOIN json_each(?) j`).bind(JSON.stringify(p.tags)))
  const results = await commitUploadContent(c.env.DB,fromChat?.uploaderId??u.id,uploadKeys,statements)
  const row = results[fromChat?1:0]
  const id = (row.results[0] as {id:number}).id
  c.executionCtx.waitUntil(settleContentRewards(c.env.DB,now(),{source:'post',id}).catch(()=>console.error('content_post_reward_retry')))
  // 标签触发器更新 NSFW 后才检查资格；AI 队列异常不把已成功发出的帖子报成失败。
  await enqueueImageReply(c.env,id,now()).catch(()=>console.warn('ai_image_enqueue_failed'))
  return id
}
const TEXT_MAX = 10000 // 文字帖正文上限；图帖描述 2000

app.post('/api/memes', async (c) => {
  const u = await postGate(c)

  // 两种发法：JSON 引用 /api/uploads 传好的文件（多图、视频），或老的 multipart 单图
  let f: Record<string, unknown>
  let items: Media[]
  if ((c.req.header('content-type') ?? '').includes('application/json')) {
    f = await jsonBody<Record<string, unknown>>(c)
    if(f.share_url!==undefined){
      const link=postShareLink(f.share_url)
      if(Array.isArray(f.items)&&f.items.length)fail(400,'分享链接与上传文件请分别发布')
      const data=await cachedSocialPreview(c,u,link)
      if(!data.available)fail(503,'暂未取得公开内容，请稍后重试；尚未发布')
      const gallery=socialPostGallery(data),content=String(f.content??socialCaption(data.description)).trim().slice(0,TEXT_MAX),title=String(f.title??'').trim().slice(0,80)
      if(!content&&!gallery.length&&!title&&!data.embed)fail(400,'内容为空，尚未发布')
      const at=now(),out=await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO memes(title,content,image_url,width,height,gallery,source_url,author_id,author_name,kind,spoiler,created_at,ai_off)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,1 WHERE NOT EXISTS(SELECT 1 FROM memes WHERE author_id=? AND source_url=? AND created_at>? AND hidden=0)`)
          .bind(title,content,gallery[0]?.u||null,gallery[0]?.w||null,gallery[0]?.h||null,gallery.length?JSON.stringify(gallery):null,link.url,u.id,u.username,gallery.length?'image':'text',data.sensitive||f.spoiler===true?1:0,at,u.id,link.url,at-600),
        c.env.DB.prepare("UPDATE memes SET image_url=replace(image_url,'__MEME_ID__',id),gallery=replace(gallery,'__MEME_ID__',id) WHERE id=last_insert_rowid() AND changes()=1"),
        c.env.DB.prepare('SELECT id FROM memes WHERE author_id=? AND source_url=? AND created_at>? AND hidden=0 ORDER BY id DESC LIMIT 1').bind(u.id,link.url,at-600),
      ])
      const id=Number((out[2].results[0] as {id:number}|undefined)?.id)
      if(!id)fail(409,'发布状态已变化，请重试')
      if(out[0].meta.changes){const tags=parseTags(f.tags);if(tags.length)await c.env.DB.batch(tags.map(tag=>c.env.DB.prepare('INSERT OR IGNORE INTO meme_tags VALUES (?,?)').bind(id,tag)))}
      c.executionCtx.waitUntil(settleContentRewards(c.env.DB,now(),{source:'post',id}).catch(()=>console.error('content_post_reward_retry')))
      return c.json({id,existed:!out[0].meta.changes,external:true})
    }
    if(f.ai_off!==undefined&&typeof f.ai_off!=='boolean')fail(400,'图片自动回应开关无效')
    // 手机网络抖动：帖子其实发出去了、回包丢了，再点一次会因为文件「已用过」失败。10 分钟内同一个人用同一批图发过，就直接认成那一帖
    const first = (Array.isArray(f.items) ? f.items[0] : null) as MediaIn | null
    const fk = first?.poster ? String(first.poster) : first?.key ? String(first.key) : ''
    if (fk) {
      const dup = await c.env.DB.prepare(
        'SELECT m.id FROM memes m JOIN uploads up ON up.key = m.image_key AND up.used = 1 WHERE m.image_key = ? AND m.author_id = ? AND m.created_at > ? AND m.hidden = 0',
      ).bind(fk, u.id, now() - 600).first<{ id: number }>().catch(() => null)
      if (dup) return c.json({ id: dup.id, existed: true })
    }
    items = await prepareMedia(c, u.id, f.items)
    if (!items.length && f.kind !== 'text') fail(400, '请选择图片')
  } else {
    const form = await c.req.formData()
    f = Object.fromEntries([...form.keys()].map((k) => [k, form.get(k)]))
    if(f.ai_off!==undefined&&f.ai_off!=='1'&&f.ai_off!=='0')fail(400,'图片自动回应开关无效')
    const file = form.get('file')
    if (!(file instanceof File)) fail(400, '请选择图片')
    if ((file as File).size > MAX_UPLOAD) fail(413, '图片不能超过 20MB')
    const bytes = new Uint8Array(await (file as File).arrayBuffer())
    const kind = sniffImage(bytes) ?? fail(415, '只支持 PNG / JPG / GIF / WebP')
    const {key} = await storeUpload(c.env.DB,c.env.BUCKET,{uid:u.id,nonce:undefined,bytes,mime:kind[0],ext:kind[1],purpose:'meme',asFile:false,limited:rateOn(c)&&u.is_admin!==1,t:now()})
    items = [{ k: key, w: intIn(f.width, 1, 20000, 0) || null, h: intIn(f.height, 1, 20000, 0) || null, kind: kind[0] === 'image/gif' ? 'g' : undefined }]
  }
  const kind = f.kind === 'text' ? 'text' : 'image'
  const title = String(f.title ?? '').trim().slice(0, 80)
  const content = String(f.content ?? '').trim().slice(0, kind === 'text' ? TEXT_MAX : 2000)
  if (kind === 'text' && !title && !content) fail(400, '写点什么吧')
  const id = await insertMeme(c, u, {
    title, content, items, kind, spoiler: f.spoiler === '1' || f.spoiler === true, tags: parseTags(f.tags), layout: f.layout,ai_off:f.ai_off===true||f.ai_off==='1',
  },mediaKeys(items))
  return c.json({ id })
})

// 发帖后再编辑：配文、描述、标签、慎点、多图排法，以及图本身（保留 / 删 / 换顺序 / 新传 / 重新打码）
// items: [{keep: 原来那张的 u} | {key, poster?, w?, h?, kind?, orig?}]，不传 items 就不动图
app.patch('/api/memes/:id', async (c) => {
  const u = needUser(c)
  const id = memeId(c)
  const m = await loadMeme(c, id)
  if (!canManage(u, m.author_id)) fail(403, '没有权限')
  const f = await jsonBody<Record<string, unknown>>(c)
  const db = c.env.DB
  const sets: string[] = []
  const args: unknown[] = []
  const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); args.push(v) }
  if(f.ai_off!==undefined){if(typeof f.ai_off!=='boolean')fail(400,'图片自动回应开关无效');set('ai_off',f.ai_off?1:0)}
  if (f.title !== undefined) set('title', String(f.title ?? '').trim().slice(0, 80))
  if (f.content !== undefined) set('content', String(f.content ?? '').trim().slice(0, m.kind === 'text' ? TEXT_MAX : 2000))
  if (f.spoiler !== undefined) set('spoiler', f.spoiler === true || f.spoiler === '1' ? 1 : 0)
  let dropped: string[] = []
  let uploadKeys: string[] = []
  let newList: GalleryItem[] | null = null
  if (Array.isArray(f.items)) {
    const old = galleryOf(m)
    const raw = (f.items as Record<string, unknown>[]).slice(0, MAX_ITEMS)
    const fresh = await prepareMedia(c, u.id, raw.filter((r) => !r?.keep))
    uploadKeys = mediaKeys(fresh)
    let k = 0
    const list: GalleryItem[] = []
    for (const r of raw) {
      if (r?.keep) {
        const g = old.find((x) => x.u === String(r.keep))
        if (g && !list.includes(g)) list.push(g)
      } else if (r?.key && fresh[k]) list.push(toGallery(fresh[k++]))
    }
    if (!list.length && m.kind !== 'text') fail(400, '至少留一张图')
    newList = list
    const first = list[0] as GalleryItem | undefined
    const r2 = (s?: string) => (s?.startsWith('/img/') ? s.slice(5) : null)
    // 单张普通图不存 gallery；第一张是站内文件就记 image_key，否则（历史外链图）记 image_url
    const plain = !first || (list.length === 1 && !first.v && !first.o)
    set('gallery', plain ? null : JSON.stringify(list))
    set('image_key', r2(first?.u))
    set('image_url', !first || r2(first.u) ? null : first.u)
    set('thumb_url', !first || r2(first.u) ? null : first.t ?? null)
    set('width', first?.w ?? null)
    set('height', first?.h ?? null)
    // 换下来的站内文件：没人再用了就从 R2 删掉
    const keep = new Set(list.flatMap((g) => [g.u, g.v, g.o]).map(r2).filter(Boolean))
    dropped = [...new Set(old.flatMap((g) => [g.u, g.v, g.o]).map(r2).filter((x): x is string => !!x && !keep.has(x)))]
  }
  if (f.layout !== undefined) set('layout', f.layout === 'grid' ? 'grid' : 'carousel')
  const stmts = sets.length ? [db.prepare(`UPDATE memes SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id)] : []
  if (f.tags !== undefined) {
    stmts.push(db.prepare('DELETE FROM meme_tags WHERE meme_id = ?').bind(id))
    for (const t of parseTags(f.tags)) stmts.push(db.prepare('INSERT OR IGNORE INTO meme_tags VALUES (?, ?)').bind(id, t))
  }
  // 「打码」标签跟着慎点 / 局部打码走
  if (f.tags !== undefined || f.spoiler !== undefined || newList) {
    const spoiler = f.spoiler !== undefined ? f.spoiler === true || f.spoiler === '1' : !!m.spoiler
    const masked = spoiler || (newList ?? galleryOf(m)).some((g) => g.o)
    stmts.push(masked
      ? db.prepare('INSERT OR IGNORE INTO meme_tags VALUES (?, ?)').bind(id, MASK_TAG)
      : db.prepare('DELETE FROM meme_tags WHERE meme_id = ? AND tag = ?').bind(id, MASK_TAG))
  }
  if(f.ai_off===true)stmts.push(db.prepare("UPDATE ai_jobs SET state='skipped',err='post_disabled',updated_at=? WHERE target_id=? AND kind='img_reply' AND state='pending'").bind(now(),id))
  if (stmts.length) await commitUploadContent(db,u.id,uploadKeys,stmts)
  if (dropped.length) c.executionCtx.waitUntil(c.env.BUCKET.delete(dropped).catch(() => {}))
  return c.json({ ok: true })
})

// 一键切换 NSFW：开 = 加「NSFW」标签；关 = 去掉所有敏感标签和「慎点」。memes.nsfw 由触发器跟着变
app.post('/api/memes/:id/nsfw', async (c) => {
  const u = needUser(c)
  const id = memeId(c)
  const m = await loadMeme(c, id)
  if (!canManage(u, m.author_id)) fail(403, '没有权限')
  const { on } = await jsonBody<{ on?: boolean }>(c)
  const db = c.env.DB
  const marks = SENSITIVE_TAGS.map(() => '?').join(', ')
  await db.batch(on
    ? [db.prepare('INSERT OR IGNORE INTO meme_tags VALUES (?, ?)').bind(id, 'NSFW')]
    : [db.prepare(`DELETE FROM meme_tags WHERE meme_id = ? AND tag IN (${marks})`).bind(id, ...SENSITIVE_TAGS),
      db.prepare('UPDATE memes SET spoiler = 0 WHERE id = ? AND spoiler = 1').bind(id),
      // 「打码」跟着慎点走；还有局部打码的图就留着
      ...(galleryOf(m).some((g) => g.o) ? [] : [db.prepare('DELETE FROM meme_tags WHERE meme_id = ? AND tag = ?').bind(id, MASK_TAG)])])
  return itemJson(c, id)
})

app.delete('/api/memes/:id', async (c) => {
  const u = needUser(c)
  const id = intIn(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER, 0)
  const m = await c.env.DB.prepare('SELECT author_id FROM memes WHERE id = ?').bind(id).first<{ author_id: number | null }>()
  if (!m) fail(404, '不存在')
  if (!canManage(u, m!.author_id)) fail(403, '没有权限')
  await c.env.DB.prepare('UPDATE memes SET hidden = 1 WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// ---------- 回应 & 评论 ----------

// ---------- 喜欢 / 表情 / 一句回应 ----------

app.post('/api/memes/:id/reactions', async (c) => {
  const u = needUser(c)
  await needNotLimited(c, u, 'react')
  const id = memeId(c)
  const { emoji } = await c.req.json<{ emoji: string }>()
  if (typeof emoji !== 'string' || !isReaction(emoji)) fail(400, '不支持的表情')
  await loadMeme(c, id)
  const del = await c.env.DB.prepare('DELETE FROM reactions WHERE meme_id = ? AND user_id = ? AND emoji = ?')
    .bind(id, u.id, emoji).run()
  if (del.meta.changes === 0) {
    const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM reactions WHERE meme_id = ? AND user_id = ?')
      .bind(id, u.id).first<{ n: number }>()
    if ((n?.n ?? 0) >= 5) fail(429, '一张图最多点 5 个表情')
  }
  await c.env.DB.batch([
    ...(del.meta.changes === 0
      ? [c.env.DB.prepare('INSERT OR IGNORE INTO reactions VALUES (?, ?, ?, ?)').bind(id, u.id, emoji, now())] : []),
    recount(c, id, 'reaction_count'),
  ])
  return itemJson(c, id)
})

app.post('/api/memes/:id/like', async (c) => {
  const u = needUser(c)
  await needNotLimited(c, u, 'react')
  const id = memeId(c)
  await loadMeme(c, id)
  const del = await c.env.DB.prepare('DELETE FROM likes WHERE user_id = ? AND meme_id = ?').bind(u.id, id).run()
  await c.env.DB.batch([
    ...(del.meta.changes === 0
      ? [c.env.DB.prepare('INSERT OR IGNORE INTO likes (user_id, meme_id, created_at) VALUES (?, ?, ?)').bind(u.id, id, now())] : []),
    recount(c, id, 'like_count'),
  ])
  return itemJson(c, id)
})

// 一句回应：12 字以内（一个平台表情算 1 个字），不能带链接
const STICKER_RE = /\[([a-z]+:[a-z0-9_]+)\]/g
function cleanReply(raw: unknown) {
  const text = String(raw ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (!text) fail(400, '说一句吧')
  const plain = text.replace(STICKER_RE, (m, k) => (STICKERS.has(k) ? '□' : m))
  if ([...plain].length > REPLY_MAX) fail(400, `一句回应最多 ${REPLY_MAX} 个字`)
  if (/https?:|www\.|[a-z0-9-]+\.(com|cn|net|org|io|top|xyz|me)\b/i.test(text)) fail(400, '一句回应里不能带链接')
  return text
}

app.put('/api/memes/:id/reply', async (c) => {
  const u = needUser(c)
  if (u.silenced) fail(403, '你在 linux.do 处于禁言状态')
  await needNotLimited(c, u, 'react')
  const id = memeId(c)
  const text = cleanReply((await c.req.json<{ text: string }>()).text)
  const meme = await loadMeme(c, id)
  // 满了只拦新来的人，已经回应过的还能改自己那句
  if (meme.reply_count >= REPLY_CAP) {
    const had = await c.env.DB.prepare('SELECT 1 FROM short_replies WHERE meme_id = ? AND user_id = ?').bind(id, u.id).first()
    if (!had) fail(409, `这张图的回应已满 ${REPLY_CAP} 条，去评论区说吧`)
  }
  const rate = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n, MAX(created_at) AS t FROM short_replies WHERE user_id = ? AND created_at > ?',
  ).bind(u.id, now() - 3600).first<{ n: number; t: number | null }>()
  if (rateOn(c) && rate?.t && now() - rate.t < 2) fail(429, '手速太快了，缓一缓')
  if (rateOn(c) && (rate?.n ?? 0) >= 120) fail(429, '这一小时回应得够多了，歇会儿')
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO short_replies (meme_id, user_id, text, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(meme_id, user_id) DO UPDATE SET text = excluded.text, created_at = excluded.created_at`,
    ).bind(id, u.id, text, now()),
    recount(c, id, 'reply_count'),
  ])
  return itemJson(c, id)
})

app.delete('/api/memes/:id/reply', async (c) => {
  const u = needUser(c)
  const id = memeId(c)
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM short_replies WHERE meme_id = ? AND user_id = ?').bind(id, u.id),
    recount(c, id, 'reply_count'),
  ])
  return itemJson(c, id)
})

// 帖子上谁点了表情 / 说了什么回应（人多时前端列表展示）
app.get('/api/memes/:id/who', async (c) => {
  const id = memeId(c)
  await loadMeme(c, id)
  const db = c.env.DB
  const [reacts, replies] = await db.batch([
    db.prepare(`SELECT r.emoji, r.created_at AS at, u.username, u.name, u.avatar FROM reactions r LEFT JOIN users u ON u.id = r.user_id
      WHERE r.meme_id = ? ORDER BY r.created_at LIMIT 500`).bind(id),
    db.prepare(`SELECT s.text, s.created_at AS at, u.username, u.name, u.avatar FROM short_replies s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.meme_id = ? ORDER BY s.created_at LIMIT 500`).bind(id),
  ])
  return c.json({ reactions: reacts.results, replies: replies.results })
})

// 发图者 / 管理员清理某一句（所有人的同一句一起删）
app.delete('/api/memes/:id/replies', async (c) => {
  const u = needUser(c)
  const id = memeId(c)
  const m = await loadMeme(c, id)
  if (!canManage(u, m.author_id)) fail(403, '没有权限')
  const text = String(c.req.query('text') ?? '')
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM short_replies WHERE meme_id = ? AND text = ?').bind(id, text),
    recount(c, id, 'reply_count'),
  ])
  return itemJson(c, id)
})

// ---------- 收藏 ----------

type Folder = { id: number; name: string; sort: number }

async function ensureFolders(c: C, uid: number) {
  const list = () => c.env.DB.prepare(
    `SELECT f.id, f.name, f.sort, (SELECT COUNT(*) FROM favorites v WHERE v.folder_id = f.id) AS n
     FROM fav_folders f WHERE f.user_id = ? ORDER BY f.sort, f.id`,
  ).bind(uid).all<Folder & { n: number }>().then((r) => r.results)
  const got = await list()
  if (got.length) return got
  await c.env.DB.batch(DEFAULT_FOLDERS.map((name, i) =>
    c.env.DB.prepare('INSERT OR IGNORE INTO fav_folders (user_id, name, sort, created_at) VALUES (?, ?, ?, ?)')
      .bind(uid, name, i, now())))
  return list()
}

const folderName = (raw: unknown) => {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 12)
  return name || fail(400, '收藏夹名字不能为空')
}

app.get('/api/folders', async (c) => c.json({ folders: await ensureFolders(c, needUser(c).id) }))

app.post('/api/folders', async (c) => {
  const u = needUser(c)
  const name = folderName((await c.req.json<{ name: string }>()).name)
  const list = await ensureFolders(c, u.id)
  if (list.length >= 20) fail(400, '最多 20 个收藏夹')
  const row = await c.env.DB.prepare(
    `INSERT INTO fav_folders (user_id, name, sort, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, name) DO NOTHING RETURNING id`,
  ).bind(u.id, name, list.length, now()).first<{ id: number }>()
  if (!row) fail(409, '已经有同名收藏夹了')
  return c.json({ folders: await ensureFolders(c, u.id), id: row!.id })
})

app.patch('/api/folders/:id', async (c) => {
  const u = needUser(c)
  const name = folderName((await c.req.json<{ name: string }>()).name)
  try {
    await c.env.DB.prepare('UPDATE fav_folders SET name = ? WHERE id = ? AND user_id = ?').bind(name, memeId(c), u.id).run()
  } catch { fail(409, '已经有同名收藏夹了') }
  return c.json({ folders: await ensureFolders(c, u.id) })
})

app.delete('/api/folders/:id', async (c) => {
  const u = needUser(c)
  const fid = memeId(c)
  const f = await c.env.DB.prepare('SELECT id FROM fav_folders WHERE id = ? AND user_id = ?').bind(fid, u.id).first()
  if (!f) fail(404, '收藏夹不存在')
  const affected = await c.env.DB.prepare('SELECT meme_id FROM favorites WHERE folder_id = ?').bind(fid).all<{ meme_id: number }>()
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM favorites WHERE folder_id = ?').bind(fid),
    c.env.DB.prepare('DELETE FROM fav_folders WHERE id = ?').bind(fid),
    ...affected.results.map((r) => recount(c, r.meme_id, 'fav_count')),
  ])
  return c.json({ folders: await ensureFolders(c, u.id) })
})

// 切换某个收藏夹；不传 folder_id 时用第一个收藏夹（一键收藏）
app.post('/api/memes/:id/fav', async (c) => {
  const u = needUser(c)
  const id = memeId(c)
  await loadMeme(c, id)
  const folders = await ensureFolders(c, u.id)
  const body = await c.req.json<{ folder_id?: number }>().catch(() => ({} as { folder_id?: number }))
  const fid = body.folder_id ?? folders[0].id
  if (!folders.some((f) => f.id === fid)) fail(404, '收藏夹不存在')
  const del = await c.env.DB.prepare('DELETE FROM favorites WHERE user_id = ? AND meme_id = ? AND folder_id = ?')
    .bind(u.id, id, fid).run()
  await c.env.DB.batch([
    ...(del.meta.changes === 0
      ? [c.env.DB.prepare('INSERT OR IGNORE INTO favorites VALUES (?, ?, ?, ?)').bind(u.id, id, fid, now())] : []),
    recount(c, id, 'fav_count'),
  ])
  return itemJson(c, id)
})

app.delete('/api/memes/:id/fav', async (c) => {
  const u = needUser(c)
  const id = memeId(c)
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM favorites WHERE user_id = ? AND meme_id = ?').bind(u.id, id),
    recount(c, id, 'fav_count'),
  ])
  return itemJson(c, id)
})

// ---------- 看过 ----------

// 批量记录；前端用 sendBeacon 发 text/plain，这里自己解析
app.post('/api/views', async (c) => {
  const u = c.get('user')
  if (!u) return c.json({ ok: true })
  const t = now()
  let visits: { id: number; at: number }[] = []
  try {
    const body = JSON.parse(await c.req.text()) as { ids?: unknown[]; visits?: { id: unknown; at: unknown }[] }
    const input = Array.isArray(body.visits) ? body.visits : Array.isArray(body.ids) ? body.ids.map(id => ({ id, at: t })) : null
    if (!input) throw new TypeError('invalid_views_body')
    visits = input.slice(0, 100).map(v => ({ id: Number(v.id), at: Number(v.at) }))
    if (visits.some(v => !Number.isSafeInteger(v.id) || v.id <= 0 || !Number.isSafeInteger(v.at) || v.at < t - 30 * 86400 || v.at > t + 300)) fail(400, '浏览记录时间或帖子编号无效')
    // 容忍设备时钟略快，但不能把已发生的浏览存到未来，否则未看分页与日期计数不一致。
    visits = visits.map(v => ({ ...v, at: Math.min(v.at, t) }))
  } catch { fail(400, '格式不对') }
  const ids = [...new Set(visits.map(v => v.id))]
  if (ids.length) {
    await c.env.DB.batch([c.env.DB.prepare(
      `INSERT OR IGNORE INTO views (user_id, meme_id, seen_at)
       SELECT ?1,m.id,MIN(CAST(json_extract(j.value,'$.at') AS INTEGER))
       FROM json_each(?2) j JOIN memes m ON m.id=json_extract(j.value,'$.id') GROUP BY m.id`,
    ).bind(u.id, JSON.stringify(visits)), c.env.DB.prepare(
      `INSERT OR IGNORE INTO daily_post_views(user_id,day,meme_id,seen_at)
       SELECT ?1,date(json_extract(j.value,'$.at'),'unixepoch','+8 hours'),m.id,json_extract(j.value,'$.at')
       FROM json_each(?2) j CROSS JOIN memes m ON m.id=json_extract(j.value,'$.id')
       WHERE m.hidden=0`,
    ).bind(u.id, JSON.stringify(visits))])
  }
  return c.json({ ok: true, recorded: true, user_id: u.id })
})

// ---------- 锚点 ----------
// 返回时带上所在日期，前端据此跳到那一天、从那张开始加载

const anchorList = async (c: C, uid: number) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.meme_id AS id, a.note, a.created_at AS at, m.title, m.thumb_url, m.image_url, m.image_key, m.spoiler,
       m.created_at AS meme_at, ${DAY_SQL} AS day
     FROM anchors a JOIN memes m ON m.id = a.meme_id AND m.hidden = 0
     WHERE a.user_id = ? ORDER BY a.created_at DESC`,
  ).bind(uid).all<{ id: number; note: string; at: number; title: string; thumb_url: string | null; image_url: string | null
    image_key: string | null; spoiler: number; meme_at: number; day: string }>()
  return results.map(({ thumb_url, image_url, image_key, ...a }) => ({
    ...a, spoiler: !!a.spoiler, thumb: thumb_url ?? imageOf({ image_url, image_key }),
  }))
}

app.get('/api/anchors', async (c) => {
  const u = c.get('user')
  return c.json({ anchors: u ? await anchorList(c, u.id) : [] })
})

app.put('/api/anchors/:id', async (c) => {
  const u = needUser(c)
  const id = memeId(c)
  const body = await c.req.json<{ note?: string }>().catch(() => ({ note: '' }))
  const note = String(body.note ?? '').normalize('NFKC').trim().slice(0, 20)
  await loadMeme(c, id)
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM anchors WHERE user_id = ? AND meme_id != ?').bind(u.id, id).first<{ n: number }>()
  if ((n?.n ?? 0) >= ANCHOR_MAX) fail(409, `锚点最多 ${ANCHOR_MAX} 个，先删掉几个旧的`)
  await c.env.DB.prepare(
    `INSERT INTO anchors (user_id, meme_id, note, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, meme_id) DO UPDATE SET note = excluded.note`,
  ).bind(u.id, id, note, now()).run()
  return c.json({ anchors: await anchorList(c, u.id) })
})

app.delete('/api/anchors/:id', async (c) => {
  const u = needUser(c)
  await c.env.DB.prepare('DELETE FROM anchors WHERE user_id = ? AND meme_id = ?').bind(u.id, memeId(c)).run()
  return c.json({ anchors: await anchorList(c, u.id) })
})

// ---------- 我的 ----------

// 每种记录统一成 (meme_id, kind, val, ref, at)，再和梗图拼起来
const ACTS: Record<string, (folder: number | null) => [string, unknown[]]> = {
  fav: (folder) => [
    `SELECT meme_id, 'fav' AS kind, NULL AS val, NULL AS ref, MAX(created_at) AS at FROM favorites
     WHERE user_id = ?${folder ? ' AND folder_id = ?' : ''} GROUP BY meme_id`, folder ? [folder] : []],
  like: () => [`SELECT meme_id, 'like' AS kind, NULL AS val, NULL AS ref, created_at AS at FROM likes WHERE user_id = ?`, []],
  reply: () => [
    `SELECT meme_id, 'reply' AS kind, text AS val, NULL AS ref, created_at AS at FROM short_replies WHERE user_id = ?
     UNION ALL SELECT meme_id, 'emoji', emoji, NULL, created_at FROM reactions WHERE user_id = ?`, ['@uid']],
  comment: () => [
    `SELECT meme_id, 'comment' AS kind, body AS val, id AS ref, created_at AS at FROM comments WHERE user_id = ? AND deleted = 0`, []],
  post: () => [`SELECT id AS meme_id, 'post' AS kind, NULL AS val, NULL AS ref, created_at AS at FROM memes WHERE author_id = ?`, []],
  seen: () => [`SELECT meme_id, 'seen' AS kind, NULL AS val, NULL AS ref, seen_at AS at FROM views WHERE user_id = ?`, []],
}

app.get('/api/me/items', async (c) => {
  const u = needUser(c)
  const tab = c.req.query('tab') ?? 'fav'
  const make = ACTS[tab] ?? fail(400, '未知分类')
  const [sql, extra] = make(intIn(c.req.query('folder'), 0, Number.MAX_SAFE_INTEGER, 0) || null)
  const actArgs = [u.id, ...extra.map((v) => (v === '@uid' ? u.id : v))]
  const page = intIn(c.req.query('page'), 1, 1000, 1)
  const size = 20
  const where = ['m.hidden = 0']
  const args: unknown[] = []
  const q = (c.req.query('q') ?? '').trim()
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (s) => '\\' + s)}%`
    where.push(`(m.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\' OR a.val LIKE ? ESCAPE '\\')`)
    args.push(like, like, like)
  }
  const order = c.req.query('sort') === 'old' ? 'a.at ASC' : 'a.at DESC'
  const from = `(${sql}) a JOIN memes m ON m.id = a.meme_id LEFT JOIN users u ON u.id = m.author_id WHERE ${where.join(' AND ')}`
  const [rows, total] = await Promise.all([
    c.env.DB.prepare(
      `SELECT ${MEME_COLS}, a.kind AS act_kind, a.val AS act_val, a.ref AS act_ref, a.at AS act_at
       FROM ${from} ORDER BY ${order}, m.id DESC LIMIT ? OFFSET ?`,
    ).bind(...actArgs, ...args, size + 1, (page - 1) * size)
      .all<MemeRow & { act_kind: string; act_val: string | null; act_ref: number | null; act_at: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${from}`).bind(...actArgs, ...args).first<{ n: number }>(),
  ])
  const list = rows.results.slice(0, size)
  const items = await decorate(c, list)
  return c.json({
    items: items.map((it, i) => ({
      ...it,
      act: { kind: list[i].act_kind, val: list[i].act_val?.slice(0, 200) ?? null, ref: list[i].act_ref, at: list[i].act_at },
    })),
    more: rows.results.length > size, total: total?.n ?? 0,
  })
})

app.get('/api/me/stats', async (c) => {
  const u = needUser(c)
  const one = (sql: string) => c.env.DB.prepare(sql).bind(u.id).first<{ n: number }>().then((r) => r?.n ?? 0)
  const [fav, like, reply, emoji, comment, post, seen] = await Promise.all([
    one('SELECT COUNT(DISTINCT meme_id) AS n FROM favorites WHERE user_id = ?'),
    one('SELECT COUNT(*) AS n FROM likes WHERE user_id = ?'),
    one('SELECT COUNT(*) AS n FROM short_replies WHERE user_id = ?'),
    one('SELECT COUNT(*) AS n FROM reactions WHERE user_id = ?'),
    one('SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND deleted = 0'),
    one('SELECT COUNT(*) AS n FROM memes WHERE author_id = ? AND hidden = 0'),
    one('SELECT COUNT(*) AS n FROM views WHERE user_id = ?'),
  ])
  return c.json({ fav, like, reply: reply + emoji, comment, post, seen })
})

// ---------- 摸鱼统计 / 徽章 ----------
// 今天（北京时间）：发了几张、看了几张（其中涩的）、群里水了几条、回应几次、看了几条群消息（读到的位置之前、今天发的别人的消息）
app.get('/api/me/today', async (c) => {
  const u = needUser(c)
  const t = now()
  const a = Date.parse(dayOfTs(t) + 'T00:00:00+08:00') / 1000
  const r = await c.env.DB.prepare(
    `WITH today_views AS (SELECT meme_id FROM views WHERE user_id=?1 AND seen_at>=?2
       UNION SELECT meme_id FROM daily_post_views WHERE user_id=?1 AND day=?3)
     SELECT (SELECT COUNT(*) FROM memes WHERE author_id = ?1 AND hidden = 0 AND created_at >= ?2) AS posts,
       (SELECT COUNT(*) FROM today_views) AS seen,
       (SELECT COUNT(*) FROM views WHERE user_id=?1 AND seen_at>=?2) AS new_seen,
       (SELECT COUNT(*) FROM today_views v JOIN memes m ON m.id=v.meme_id WHERE m.nsfw=1) AS seen_nsfw,
       (SELECT COUNT(*) FROM chat_messages WHERE user_id = ?1 AND created_at >= ?2 AND deleted = 0 AND system_kind IS NULL) AS msgs,
       (SELECT COUNT(*) FROM chat_reactions WHERE user_id = ?1 AND created_at >= ?2) + (SELECT COUNT(*) FROM chat_boosts WHERE user_id = ?1 AND created_at >= ?2) AS reacts,
       (SELECT COUNT(*) FROM reactions WHERE user_id = ?1 AND created_at >= ?2) + (SELECT COUNT(*) FROM short_replies WHERE user_id = ?1 AND created_at >= ?2)
         + (SELECT COUNT(*) FROM likes WHERE user_id = ?1 AND created_at >= ?2) AS post_reacts,
       (SELECT COUNT(*) FROM chat_messages x JOIN chat_members cm ON cm.group_id = x.group_id AND cm.user_id = ?1
         WHERE x.created_at >= ?2 AND x.id <= cm.last_read AND x.user_id != ?1 AND x.deleted = 0) AS browsed`,
  ).bind(u.id, a, dayOfTs(t)).first()
  return c.json({ day: dayOfTs(t), ...r })
})

const badgesOf = (c: C, uid: number) => c.env.DB.prepare('SELECT badge AS id, n, first_at, last_day FROM user_badges WHERE user_id = ? ORDER BY first_at, badge')
  .bind(uid).all<{ id: string; n: number; first_at: number; last_day: string }>().then((r) => r.results)

// 结算某一天（北京时间）的徽章。门槛按小站的量定，「之神 / 王」类只给当天第一（并列都给）
async function settleBadges(c: C, day: string) {
  const a = Date.parse(day + 'T00:00:00+08:00') / 1000
  const b = a + 86400
  const db = c.env.DB
  type Row = { uid: number; n: number; ns?: number; night?: number }
  const [views, posts, chat, reacts] = await db.batch([
    db.prepare(`SELECT v.user_id AS uid, COUNT(*) AS n, SUM(m.nsfw) AS ns,
        SUM(CAST(strftime('%H', v.seen_at, 'unixepoch', '+8 hours') AS INTEGER) BETWEEN 1 AND 4) AS night
      FROM views v JOIN memes m ON m.id = v.meme_id JOIN users u ON u.id=v.user_id AND u.kind='user' WHERE v.seen_at >= ?1 AND v.seen_at < ?2 GROUP BY v.user_id`).bind(a, b),
    db.prepare(`SELECT author_id AS uid, COUNT(*) AS n, SUM(nsfw) AS ns FROM memes
      WHERE hidden = 0 AND created_at >= ?1 AND created_at < ?2 AND author_id IN (SELECT id FROM users WHERE kind='user') GROUP BY author_id`).bind(a, b),
    db.prepare("SELECT user_id AS uid, COUNT(*) AS n FROM chat_messages WHERE created_at >= ?1 AND created_at < ?2 AND deleted = 0 AND system_kind IS NULL AND user_id IN (SELECT id FROM users WHERE kind='user') GROUP BY user_id").bind(a, b),
    db.prepare(`SELECT uid, COUNT(*) AS n FROM (
        SELECT user_id AS uid FROM chat_reactions WHERE created_at >= ?1 AND created_at < ?2
        UNION ALL SELECT user_id FROM chat_boosts WHERE created_at >= ?1 AND created_at < ?2
        UNION ALL SELECT user_id FROM reactions WHERE created_at >= ?1 AND created_at < ?2
        UNION ALL SELECT user_id FROM short_replies WHERE created_at >= ?1 AND created_at < ?2) WHERE uid IN (SELECT id FROM users WHERE kind='user') GROUP BY uid`).bind(a, b),
  ])
  const V = views.results as Row[], P = posts.results as Row[], CH = chat.results as Row[], R = reacts.results as Row[]
  const got: [number, string][] = []
  const all = (rows: Row[], f: (r: Row) => number, min: number, id: string) => rows.forEach((r) => f(r) >= min && got.push([r.uid, id]))
  const top = (rows: Row[], f: (r: Row) => number, min: number, id: string) => {
    const best = Math.max(0, ...rows.map(f))
    if (best >= min) rows.forEach((r) => f(r) === best && got.push([r.uid, id]))
  }
  all(V, (r) => r.n, 200, 'moyu_pro')
  top(V, (r) => r.n, 500, 'moyu_god')
  all(P, (r) => r.n, 5, 'post_pro')
  top(P, (r) => r.n, 10, 'post_god')
  top(P, (r) => r.ns ?? 0, 3, 'sese')
  top(V, (r) => r.ns ?? 0, 50, 'chunse')
  top(CH, (r) => r.n, 50, 'water')
  top(R, (r) => r.n, 30, 'react')
  top(V, (r) => r.night ?? 0, 50, 'night')
  const t = now()
  const stmts = got.flatMap(([uid, id]) => [
    // 日期可能倒序补结算；以唯一获奖日志判断是否已累计，不以 last_day 排除旧日期。
    db.prepare(`INSERT INTO user_badges (user_id, badge, n, first_at, last_day)
      SELECT ?1, ?2, 1, ?3, ?4 WHERE NOT EXISTS (
        SELECT 1 FROM badge_log WHERE user_id = ?1 AND badge = ?2 AND day = ?4)
      ON CONFLICT (user_id, badge) DO UPDATE SET n = n + 1,
        last_day = MAX(user_badges.last_day, excluded.last_day)`).bind(uid, id, t, day),
    db.prepare('INSERT OR IGNORE INTO badge_log (user_id, badge, day, at) VALUES (?, ?, ?, ?)').bind(uid, id, day, t),
    // 正戴着这枚徽章的，把装扮里的次数（bn）同步一下，别处显示等级不用再查表
    db.prepare(`UPDATE users SET deco = json_set(deco, '$.bn', (SELECT n FROM user_badges WHERE user_id = ?1 AND badge = ?2))
      WHERE id = ?1 AND deco IS NOT NULL AND json_valid(deco) AND json_extract(deco, '$.bd') = ?2`).bind(uid, id),
  ])
  // 三条构成一个授予事务，分批不得截断日志、累计与佩戴进度。
  for (let i = 0; i < stmts.length; i += 48) await db.batch(stmts.slice(i, i + 48))
  return got.length
}
// 不用定时任务：每天第一个打开网站的人顺手结算昨天的（badge_runs 保证只结算一次）
let settledDay = ''
function settleLater(c: C) {
  const t = now()
  const y = dayOfTs(t - 86400)
  if (settledDay === y) return
  c.executionCtx.waitUntil((async () => {
    const r = await c.env.DB.prepare('INSERT OR IGNORE INTO badge_runs (day, at) VALUES (?, ?) RETURNING day').bind(y, t).first()
    settledDay = y
    if (!r) return
    try { await settleBadges(c, y) } catch (e) {
      console.error(e)
      settledDay = ''
      await c.env.DB.prepare('DELETE FROM badge_runs WHERE day = ?').bind(y).run()
    }
  })().catch(() => {}))
}
// 管理员手动重算某天（重复算不会重复计数）
app.post('/api/admin/badges/settle', async (c) => {
  needSiteAdmin(c)
  const day = String((await jsonBody<{ day?: string }>(c)).day ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(400, '日期格式 YYYY-MM-DD')
  await c.env.DB.prepare('INSERT OR IGNORE INTO badge_runs (day, at) VALUES (?, ?)').bind(day, now()).run()
  return c.json({ ok: true, awarded: await settleBadges(c, day) })
})

// ---------- 互动提醒 ----------
// 别人给我发的图点喜欢、表情、一句回应、评论；不另建表，直接从这几张表按时间捞
// 每一类能在设置里单独关掉；「新帖」默认关（别人发的新图，图多了会刷屏）
const NOTIF_PARTS = {
  farm_conflict: `SELECT 'farm_conflict' AS kind,e.id AS meme_id,-2 AS gid,e.actor_id AS user_id,e.body AS val,e.created_at AS at FROM farm_conflict_events e WHERE e.user_id=?1 AND e.created_at>?2`,
  packet: `SELECT 'packet' AS kind,m.id AS meme_id,m.group_id AS gid,p.owner_id AS user_id,e.body AS val,e.created_at AS at FROM packet_events e
   JOIN ldc_packets p ON p.packet_id=e.packet_id JOIN chat_redpacks r ON r.id=e.packet_id JOIN chat_messages m ON m.id=r.message_id JOIN chat_members cm ON cm.group_id=m.group_id AND cm.user_id=?1
   WHERE e.user_id=?1 AND e.created_at>?2 AND m.deleted=0 AND m.created_at>=cm.joined_at AND m.id>=${CHAT_HISTORY_FLOOR} AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE group_id=m.group_id AND user_id=?1)`,

  like: `SELECT 'like' AS kind, l.meme_id, 0 AS gid, l.user_id, NULL AS val, l.created_at AS at FROM likes l JOIN memes m ON m.id = l.meme_id
    WHERE m.author_id = ?1 AND m.hidden = 0 AND l.user_id != ?1 AND l.created_at > ?2`,
  emoji: `SELECT 'emoji' AS kind, r.meme_id, 0 AS gid, r.user_id, r.emoji AS val, r.created_at AS at FROM reactions r JOIN memes m ON m.id = r.meme_id
    WHERE m.author_id = ?1 AND m.hidden = 0 AND r.user_id != ?1 AND r.created_at > ?2`,
  reply: `SELECT 'reply' AS kind, s.meme_id, 0 AS gid, s.user_id, s.text AS val, s.created_at AS at FROM short_replies s JOIN memes m ON m.id = s.meme_id
    WHERE m.author_id = ?1 AND m.hidden = 0 AND s.user_id != ?1 AND s.created_at > ?2`,
  comment: `SELECT 'comment' AS kind, c.meme_id, 0 AS gid, c.user_id, c.body AS val, c.created_at AS at FROM comments c JOIN memes m ON m.id = c.meme_id
    WHERE m.author_id = ?1 AND m.hidden = 0 AND c.user_id != ?1 AND c.deleted = 0 AND c.created_at > ?2`,
  // 回复我的评论（帖子是我发的那条已经算在 comment 里，不重复提醒）
  creply: `SELECT 'creply' AS kind, c.meme_id, 0 AS gid, c.user_id, c.body AS val, c.created_at AS at FROM comments p
    CROSS JOIN comments c INDEXED BY idx_comments_reply_live ON c.reply_to = p.id JOIN memes m ON m.id = c.meme_id
    WHERE p.user_id = ?1 AND m.author_id IS NOT ?1 AND m.hidden = 0 AND c.user_id != ?1 AND c.deleted = 0 AND c.created_at > ?2`,
  post: `SELECT 'post' AS kind, m.id AS meme_id, 0 AS gid, m.author_id AS user_id, NULL AS val, m.created_at AS at FROM memes m
    WHERE m.hidden = 0 AND m.author_id != ?1 AND m.created_at > ?2`,
  // 评论里 @ 我（帖子是我的、或回复我的已经各算一条，不重复）
  mention: `SELECT 'mention' AS kind, c.meme_id, 0 AS gid, c.user_id, c.body AS val, c.created_at AS at FROM comments c INDEXED BY idx_comments_mentions
    CROSS JOIN memes m ON m.id = c.meme_id LEFT JOIN comments p ON p.id = c.reply_to
    WHERE c.created_at > ?2 AND c.deleted = 0 AND instr(c.body, '@') > 0 AND c.user_id != ?1 AND m.hidden = 0 AND m.author_id IS NOT ?1 AND p.user_id IS NOT ?1
      AND instr(lower(c.body), '@' || lower((SELECT username FROM users WHERE id = ?1))) > 0`,
  // 帖子正文 / 标题里 @ 我
  post_at: `SELECT 'post_at' AS kind, m.id AS meme_id, 0 AS gid, m.author_id AS user_id, m.title AS val, m.created_at AS at FROM memes m INDEXED BY idx_memes_mentions
    WHERE m.hidden = 0 AND (instr(m.title, '@') > 0 OR instr(m.content, '@') > 0) AND m.created_at > ?2 AND m.author_id IS NOT ?1
      AND instr(lower(m.title || ' ' || m.content), '@' || lower((SELECT username FROM users WHERE id = ?1))) > 0`,
  // 有人申请回群：只给管理员 / 群管。meme_id 放 0，gid 放群 id
  join_req: `SELECT 'join_req' AS kind, 0 AS meme_id, r.group_id AS gid, r.user_id, b.kind AS val, r.created_at AS at FROM chat_join_reqs r
    JOIN chat_bans b ON b.group_id = r.group_id AND b.user_id = r.user_id
    WHERE r.status = 0 AND r.created_at > ?2 AND (SELECT is_admin = 1 OR role = 'gadmin' FROM users WHERE id = ?1)`,
  // 得到徽章：gid 放 -1（不连帖子也不连群），meme_id 放 badge_log 的 rowid，val 是徽章 id
  badge: `SELECT 'badge' AS kind, l.rowid AS meme_id, -1 AS gid, l.user_id, l.badge AS val, l.at FROM badge_log l
    WHERE l.user_id = ?1 AND l.at > ?2`,
  // 群聊：meme_id 放消息 id，gid 放群 id
  chat_at: `SELECT 'chat_at' AS kind, x.id AS meme_id, x.group_id AS gid, x.user_id, x.body AS val, x.created_at AS at FROM chat_messages x INDEXED BY idx_chat_msg_mentions
    JOIN chat_members cm ON cm.group_id = x.group_id AND cm.user_id = ?1
    WHERE 0 AND x.created_at > ?2 AND x.created_at >= cm.joined_at AND x.id >= ${CHAT_HISTORY_FLOOR} AND x.deleted = 0 AND instr(x.body, '@') > 0 AND x.user_id != ?1
      AND instr(lower(x.body), '@' || lower((SELECT username FROM users WHERE id = ?1))) > 0`,
  // 回复我的群消息（同时 @ 了我的算在 chat_at 里）
  chat_reply: `SELECT 'chat_reply' AS kind, x.id AS meme_id, x.group_id AS gid, x.user_id, x.body AS val, x.created_at AS at FROM chat_messages x
    JOIN chat_messages p ON p.id = x.reply_to JOIN chat_members cm ON cm.group_id = x.group_id AND cm.user_id = ?1
    WHERE x.created_at > ?2 AND x.created_at >= cm.joined_at AND x.id >= ${CHAT_HISTORY_FLOOR}
      AND p.group_id = x.group_id AND p.created_at >= cm.joined_at AND p.id >= ${CHAT_HISTORY_FLOOR}
      AND x.deleted = 0 AND p.user_id = ?1 AND x.user_id != ?1
      AND instr(lower(x.body), '@' || lower((SELECT username FROM users WHERE id = ?1))) = 0`,
} as const
const NOTIF_RECENT_INDEX: Partial<Record<keyof typeof NOTIF_PARTS, readonly [string, string]>> = {
  like: ['likes l', 'idx_likes_recent'], emoji: ['reactions r', 'idx_reactions_recent'],
  reply: ['short_replies s', 'idx_replies_recent'], comment: ['comments c', 'idx_comments_recent'],
}
type NotifPrefs = Record<keyof typeof NOTIF_PARTS | 'chat' | 'ai_comment', boolean>
const NOTIF_DEFAULT: NotifPrefs = {
  like: true, emoji: true, reply: true, comment: true, creply: true, post: false, mention: true, chat_at: true, chat_reply: true, chat: true,
  packet: true, post_at: true, join_req: true, badge: true, ai_comment: true, farm_conflict: true,
}
function notifPrefs(u: User): NotifPrefs {
  let raw: Record<string, unknown> = {}
  try { raw = JSON.parse(u.notif_prefs || '{}') } catch {}
  return Object.fromEntries(Object.entries(NOTIF_DEFAULT).map(([k, v]) => [k, typeof raw[k] === 'boolean' ? raw[k] : v])) as NotifPrefs
}
// 没逐条点过的才算未读：时间点之后、且不在 notif_reads 里
const notifSql = (p: NotifPrefs, recent = false) => {
  const parts = (Object.keys(NOTIF_PARTS) as (keyof typeof NOTIF_PARTS)[]).filter((k) => p[k]).map((k) => {
    const hint = recent && NOTIF_RECENT_INDEX[k]
    const part = hint ? NOTIF_PARTS[k].replace(`FROM ${hint[0]}`, `FROM ${hint[0]} INDEXED BY ${hint[1]}`) : NOTIF_PARTS[k]
    return p.ai_comment === false && ['comment','creply','mention'].includes(k)
      ? `SELECT * FROM (${part}) WHERE user_id != ${AI_BOT_ID}` : part
  })
  // D1 限制一个复合 SELECT 的项数，四个一组包成子查询再拼
  const chunks: string[] = []
  for (let i = 0; i < parts.length; i += 4) chunks.push(`SELECT * FROM (${parts.slice(i, i + 4).join('\n  UNION ALL ')})`)
  return chunks.length ? chunks.join('\n UNION ALL ') :`SELECT 'like' AS kind, 0 AS meme_id, 0 AS gid, 0 AS user_id, NULL AS val, 0 AS at WHERE ?1 IS NULL AND ?2 IS NULL AND 0`
}
const NOT_READ = `NOT EXISTS (SELECT 1 FROM notif_reads r WHERE r.user_id = ?1 AND r.kind = n.kind
  AND r.meme_id = CASE WHEN n.kind = 'join_req' THEN n.gid ELSE n.meme_id END AND r.actor_id = n.user_id AND r.at = n.at)
  AND NOT (n.kind IN ('chat_at', 'chat_reply') AND n.meme_id <= COALESCE((SELECT last_read FROM chat_members WHERE group_id = n.gid AND user_id = ?1), 0))`
// ↑ 群消息：已读游标过了这条（在群里看过了）就不再算未读提醒
// 少量作者走原来的按帖子索引；大量历史帖作者走近期互动索引。
// 缓存只影响查询计划，数据仍每次实时查询；跨门槛延迟至多一小时只影响成本。
const notifPlanCache = new Map<number, { recent: boolean; until: number }>()
async function notifRecentPlan(db: D1Database, uid: number) {
  const cached = notifPlanCache.get(uid), t = now()
  if (cached && cached.until > t) return cached.recent
  const found = await db.prepare('SELECT EXISTS(SELECT 1 FROM memes INDEXED BY idx_memes_author_id WHERE author_id=? LIMIT 1 OFFSET 2999) AS large_author').bind(uid).first<{ large_author: number }>()
  const recent = !!found?.large_author
  if (notifPlanCache.size >= 500) notifPlanCache.delete(notifPlanCache.keys().next().value!)
  notifPlanCache.set(uid, { recent, until: t + 3600 })
  return recent
}
app.get('/api/notifs', async (c) => {
  const u = needUser(c)
  const read = u.notif_read ?? 0
  const since = now() - 30 * 86400
  const prefs = notifPrefs(u)
  const db = c.env.DB
  const sql = notifSql(prefs, await notifRecentPlan(db, u.id))
  // 未读优先的前60条足以给出0～59的准确红标；仅满60条未读时再查询100上限。
  const list = await db.prepare(
      `SELECT n.*, u.username, u.name, u.avatar, m.title, m.thumb_url, m.image_url, m.image_key, g.name AS group_name,
       CASE WHEN n.kind='badge' THEN COALESCE((SELECT n FROM user_badges WHERE user_id=n.user_id AND badge=n.val),0) END AS badge_n,
       (m.id IS NOT NULL OR g.id IS NOT NULL OR n.kind IN ('badge','farm_conflict')) AS displayable
       FROM (SELECT n.*, n.at > ?3 AND ${NOT_READ} AS unread FROM (${sql}) n ORDER BY unread DESC, at DESC LIMIT 60) n
       LEFT JOIN users u ON u.id = n.user_id LEFT JOIN memes m ON m.id = n.meme_id AND n.gid = 0
       LEFT JOIN chat_groups g ON g.id = n.gid AND n.gid > 0
       ORDER BY n.unread DESC, n.at DESC`,
    ).bind(u.id, since, read).all<Record<string, unknown> & { displayable: number; gid: number; group_name: string | null; meme_id: number; at: number; val: string | null; kind: string; unread: number; thumb_url: string | null; image_url: string | null; image_key: string | null }>()
  // 与旧统计口径一致：在过滤已移除的显示对象之前计数。
  let unread = list.results.filter(r=>r.unread).length
  if (unread === 60) unread = (await db.prepare(`SELECT COUNT(*) AS n FROM (SELECT * FROM (${sql}) n WHERE ${NOT_READ} LIMIT 100)`)
    .bind(u.id, Math.max(read,since)).first<{n:number}>())?.n ?? 0
  const alerts=isOwner(c,u)?await aiAlerts(db,u.id,since,read,now()):[]
  return c.json({
    unread: Math.min(100,unread+alerts.filter(n=>n.unread).length), read_at: read, prefs,
    items: [...list.results.filter(r=>r.displayable).map(({ displayable, thumb_url, image_url, image_key, ...r }) => ({
      ...r, val: r.gid > 0 && r.kind !== 'join_req' ? chatPreview(r.val ?? '', 60) : ['comment', 'creply', 'mention', 'post_at'].includes(r.kind) ? snippet(r.val ?? '', 60) : r.val,
      thumb: thumb_url ?? (image_key ? `/img/${image_key}` : image_url), unread: !!r.unread,
    })),...alerts].sort((a,b)=>Number(b.unread)-Number(a.unread)||b.at-a.at).slice(0,60),
  })
})
// 不带 item：全部已读；带 item：只标这一条
app.post('/api/notifs/read', async (c) => {
  const u = needUser(c)
  const { item } = await jsonBody<{ item?: { kind?: unknown; meme_id?: unknown; user_id?: unknown; at?: unknown } }>(c)
  const db = c.env.DB
  if (item) {
    const kind = String(item.kind ?? '')
    if(kind==='ai_alert'){
      if(!isOwner(c,u))fail(403,'只有站长能查看 AI 提醒')
      const t=now(),alerts=await aiAlerts(db,u.id,t-30*86400,u.notif_read??0,t)
      const alert=alerts.find(n=>n.meme_id===item.meme_id&&n.at===item.at&&item.user_id===0)
      if(!alert)fail(400,'提醒不存在或已过期')
      await db.prepare('INSERT OR IGNORE INTO notif_reads(user_id,kind,meme_id,actor_id,at) VALUES(?,?,?,?,?)').bind(u.id,kind,alert!.meme_id,0,alert!.at).run()
      return c.json({ok:true})
    }
    if (!(kind in NOTIF_PARTS)) fail(400, '不认识的提醒')
    const big = Number.MAX_SAFE_INTEGER
    // 入群申请按「群 + 人」区分：meme_id 记群 id
    const mid = kind === 'join_req' ? intIn((item as { gid?: unknown }).gid, 0, big, 0) : intIn(item.meme_id, 0, big, 0)
    await db.prepare('INSERT OR IGNORE INTO notif_reads (user_id, kind, meme_id, actor_id, at) VALUES (?, ?, ?, ?, ?)')
      .bind(u.id, kind, mid, intIn(item.user_id, -big, big, 0), intIn(item.at, 0, big, 0)).run()
    return c.json({ ok: true })
  }
  const t = now()
  await db.batch([
    db.prepare('UPDATE users SET notif_read = ? WHERE id = ?').bind(t, u.id),
    db.prepare('DELETE FROM notif_reads WHERE user_id = ? AND at <= ?').bind(u.id, t),
  ])
  return c.json({ ok: true })
})
app.put('/api/notifs/prefs', async (c) => {
  const u = needUser(c)
  const body = await jsonBody<Record<string, unknown>>(c)
  const cur = notifPrefs(u)
  for (const k of Object.keys(NOTIF_DEFAULT) as (keyof NotifPrefs)[]) if (typeof body[k] === 'boolean') cur[k] = body[k] as boolean
  await c.env.DB.prepare('UPDATE users SET notif_prefs = ? WHERE id = ?').bind(JSON.stringify(cur), u.id).run()
  return c.json({ prefs: cur })
})

// ---------- 公告 ----------
// site：网站公告，取最新一条启用的；daily：每日公告，只在指定那天（北京时间）显示
type Notice = { id: number; kind: 'site' | 'daily'; day: string | null; body: string; active: number; created_at: number }
app.get('/api/notices', async (c) => {
  const today = dayOfTs(now())
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM (SELECT * FROM notices WHERE kind = 'site' AND active = 1 ORDER BY id DESC LIMIT 1)
     UNION ALL SELECT * FROM (SELECT * FROM notices WHERE kind = 'daily' AND active = 1 AND day = ? ORDER BY id DESC LIMIT 1)`,
  ).bind(today).all<Notice>()
  return c.json({ today, notices: results })
})
const needSiteAdmin = (c: C) => {
  const u = needUser(c)
  if (!u.is_admin) fail(403, '只有管理员能做这个')
  return u
}
// 官方资格只由站长维护，JSON佩戴项与资格撤销放在同一事务中。
app.on(['PUT','DELETE'], '/api/admin/official-titles/:username/:title', async c => {
  const actor = needUser(c)
  if (!isOwner(c, actor)) fail(403, '只有站长能授予或收回官方称号')
  const title = officialTitleId(c.req.param('title'))
  if (!title) fail(400, '没有这个官方称号')
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').bind(c.req.param('username')).first<{ id: number }>()
  if (!user) fail(404, '没有这个用户')
  const db = c.env.DB, id = user!.id, t = now(), grant = c.req.method === 'PUT'
  await db.batch(grant ? [
    db.prepare("INSERT INTO official_title_log(user_id,title,action,actor_id,created_at) SELECT ?1,?2,'grant',?3,?4 WHERE NOT EXISTS(SELECT 1 FROM user_official_titles WHERE user_id=?1 AND title=?2)").bind(id,title,actor.id,t),
    db.prepare("UPDATE users SET deco=json_set(COALESCE(deco,'{}'),'$.ot',?), updated_at=? WHERE id=? AND json_extract(COALESCE(deco,'{}'),'$.ot') IS NULL AND NOT EXISTS(SELECT 1 FROM user_official_titles WHERE user_id=users.id)").bind(title,t,id),
    db.prepare('INSERT OR IGNORE INTO user_official_titles(user_id,title,granted_by,granted_at) VALUES(?,?,?,?)').bind(id,title,actor.id,t),
  ] : [
    db.prepare("INSERT INTO official_title_log(user_id,title,action,actor_id,created_at) SELECT user_id,title,'revoke',?,? FROM user_official_titles WHERE user_id=? AND title=?").bind(actor.id,t,id,title),
    db.prepare('DELETE FROM user_official_titles WHERE user_id=? AND title=?').bind(id,title),
    db.prepare("UPDATE users SET deco=json_remove(deco,'$.ot'), updated_at=? WHERE id=? AND json_extract(deco,'$.ot')=?").bind(t,id,title),
  ])
  return c.json({ ok: true, official_titles: await officialTitlesOf(c,id) })
})
// 任命管理身份：只有固定 ID 站长能改；role = admin 网站管理员 / gadmin 群管 / null 普通人
app.put('/api/admin/users/:id/role', async (c) => {
  const me = needUser(c)
  if (!isOwner(c, me)) fail(403, '只有站长能设置管理身份')
  const id = intIn(c.req.param('id'), -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0)
  const raw = (await jsonBody<{ role?: unknown }>(c)).role
  const role = raw === 'admin' || raw === 'gadmin' ? raw : null
  const t = await c.env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(id).first<{ id: number; username: string }>()
  if (!t) fail(404, '没有这个用户')
  if (isOwner(c, t)) fail(400, '站长的身份不能改')
  await c.env.DB.prepare('UPDATE users SET role = ?, is_admin = ? WHERE id = ?').bind(role, role === 'admin' ? 1 : 0, id).run()
  return c.json({ ok: true, role, is_admin: role === 'admin' })
})
// 成员管理：搜人、看限制、禁言 / 禁评 / 禁发帖 / 禁回应
app.get('/api/admin/users', async (c) => {
  needSiteAdmin(c)
  const q = (c.req.query('q') ?? '').trim().slice(0, 30)
  const only = c.req.query('limited') === '1'
  const like = `%${q.replace(/[\\%_]/g, (x) => '\\' + x)}%`
  const t = now()
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.name, u.nick, u.avatar, u.trust_level, u.is_admin, u.role, u.fancy AS fancy_set, u.silenced, u.created_at, u.last_seen, u.disabled, u.kind,
       (SELECT json_group_array(provider) FROM identities WHERE user_id=u.id) AS methods,
       (SELECT username FROM users WHERE id=u.invited_by) AS inviter,
       (SELECT COUNT(*) FROM memes WHERE author_id = u.id AND hidden = 0) AS posts,
       (SELECT COUNT(*) FROM comments WHERE user_id = u.id AND deleted = 0) AS comments,
       (SELECT json_group_array(json_object('kind', kind, 'until', until, 'reason', reason)) FROM user_limits
         WHERE user_id = u.id AND (until = 0 OR until > ?1)) AS limits
     FROM users u
     WHERE u.kind='user' AND (?2 = '' OR u.username LIKE ?3 ESCAPE '\\' OR u.name LIKE ?3 ESCAPE '\\' OR u.nick LIKE ?3 ESCAPE '\\')
       AND (?4 = 0 OR EXISTS (SELECT 1 FROM user_limits WHERE user_id = u.id AND (until = 0 OR until > ?1)))
     ORDER BY (u.username = ?2 COLLATE NOCASE) DESC, u.last_seen DESC LIMIT 50`,
  ).bind(t, q, like, only ? 1 : 0).all<Record<string, unknown> & { limits: string }>()
  return c.json({ now: t, owner: isOwner(c, c.get('user')), users: results.map((r) => ({
    ...r, methods: JSON.parse(String(r.methods || '[]')), limits: JSON.parse(r.limits || '[]'), owner: isOwner(c, { id: Number(r.id) }),
    fancy: isFancy({ is_admin: r.is_admin as number, trust_level: r.trust_level as number, fancy: r.fancy_set as number | null }),
  })) })
})
// 炫彩昵称：fancy = 1 授予 / 0 回收 / null 恢复默认（信任等级 3 以上有）
app.put('/api/admin/users/:id/fancy', async (c) => {
  needSiteAdmin(c)
  const id = intIn(c.req.param('id'), -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0)
  const raw = (await jsonBody<{ fancy?: unknown }>(c)).fancy
  const v = raw === 1 || raw === true ? 1 : raw === 0 || raw === false ? 0 : null
  const r = await c.env.DB.prepare('UPDATE users SET fancy = ? WHERE id = ? RETURNING is_admin, trust_level, fancy')
    .bind(v, id).first<{ is_admin: number; trust_level: number; fancy: number | null }>()
  if (!r) fail(404, '没有这个用户')
  return c.json({ ok: true, fancy_set: r!.fancy, fancy: isFancy(r) })
})
const adminTarget = async (c: C) => {
  const me = needSiteAdmin(c)
  const id = intIn(c.req.param('id'), -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0)
  const t = await c.env.DB.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').bind(id).first<{ id: number; username: string; is_admin: number }>()
  if (!t) fail(404, '没有这个用户')
  if (t!.is_admin || t!.id === me.id) fail(400, '不能限制管理员')
  const kind = (c.req.param('kind') ?? '') as LimitKind
  return { me, t: t!, kind }
}
app.put('/api/admin/users/:id/limits', async (c) => {
  const { me, t } = await adminTarget(c)
  const b = await jsonBody<{ kind?: string; minutes?: number; reason?: string }>(c)
  const kind = String(b.kind ?? '') as LimitKind
  if (!(kind in LIMIT_KINDS)) fail(400, '不认识的限制类型')
  const minutes = intIn(b.minutes, 0, 60 * 24 * 3650, 0)
  const until = minutes ? now() + minutes * 60 : 0
  const reason = String(b.reason ?? '').trim().slice(0, 100) || null
  await c.env.DB.prepare(
    `INSERT INTO user_limits (user_id, kind, until, reason, by_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, kind) DO UPDATE SET until = excluded.until, reason = excluded.reason, by_id = excluded.by_id, created_at = excluded.created_at`,
  ).bind(t.id, kind, until, reason, me.id, now()).run()
  return c.json({ ok: true, until })
})
app.delete('/api/admin/users/:id/limits/:kind', async (c) => {
  const { t, kind } = await adminTarget(c)
  await c.env.DB.prepare('DELETE FROM user_limits WHERE user_id = ? AND kind = ?').bind(t.id, kind).run()
  return c.json({ ok: true })
})

app.get('/api/admin/notices', async (c) => {
  needSiteAdmin(c)
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM notices WHERE kind = 'site' OR day >= ? ORDER BY kind DESC, COALESCE(day, '') ASC, id DESC LIMIT 100`,
  ).bind(dayOfTs(now() - 7 * 86400)).all<Notice>()
  return c.json({ today: dayOfTs(now()), notices: results })
})
// 同一天的每日公告只留一条：再设就覆盖
app.post('/api/admin/notices', async (c) => {
  needSiteAdmin(c)
  const f = await jsonBody<{ kind?: unknown; day?: unknown; body?: unknown }>(c)
  const kind = f.kind === 'daily' ? 'daily' : 'site'
  const body = String(f.body ?? '').replace(/\r/g, '').trim().slice(0, 2000)
  if (!body) fail(400, '公告内容不能为空')
  const day = kind === 'daily' ? String(f.day ?? '') : null
  if (kind === 'daily' && !isDay(day!)) fail(400, '请选日期')
  const db = c.env.DB
  await db.batch([
    ...(kind === 'daily' ? [db.prepare("DELETE FROM notices WHERE kind = 'daily' AND day = ?").bind(day)] : []),
    db.prepare('INSERT INTO notices (kind, day, body, active, created_at) VALUES (?, ?, ?, 1, ?)').bind(kind, day, body, now()),
  ])
  return c.json({ ok: true })
})
app.patch('/api/admin/notices/:id', async (c) => {
  needSiteAdmin(c)
  const f = await jsonBody<{ active?: unknown }>(c)
  await c.env.DB.prepare('UPDATE notices SET active = ? WHERE id = ?')
    .bind(f.active ? 1 : 0, intIn(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER, 0)).run()
  return c.json({ ok: true })
})
app.delete('/api/admin/notices/:id', async (c) => {
  needSiteAdmin(c)
  await c.env.DB.prepare('DELETE FROM notices WHERE id = ?').bind(intIn(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER, 0)).run()
  return c.json({ ok: true })
})

app.get('/api/memes/:id/comments', async (c) => {
  const id = intIn(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER, 0)
  const u = c.get('user')
  if (!u) await loadMeme(c, id)
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, c.user_id, u.username, u.name, u.avatar, u.trust_level, u.deco, u.kind, m.author_id,
       c.reply_to, p.deleted AS r_deleted, p.body AS r_body, pu.username AS r_username, pu.name AS r_name
     FROM comments c JOIN users u ON u.id = c.user_id JOIN memes m ON m.id=c.meme_id
     LEFT JOIN comments p ON p.id = c.reply_to LEFT JOIN users pu ON pu.id = p.user_id
     WHERE c.meme_id = ? AND c.deleted = 0 ORDER BY c.id ASC LIMIT 500`,
  ).bind(id).all<{ id: number; user_id: number; kind:string; author_id:number|null; reply_to: number | null; r_deleted: number | null; r_body: string | null; r_username: string | null; r_name: string | null } & Record<string, unknown>>()
  return c.json({
    comments: results.map(({ reply_to, r_deleted, r_body, r_username, r_name, author_id, ...r }) => ({
      ...r, deco: decoOf(r.deco), can_delete: canDeleteComment(u,{...r,author_id}),
      reply_to: reply_to && r_username != null
        ? { id: reply_to, username: r_username, name: r_name, deleted: !!r_deleted, text: r_deleted ? '' : snippet(r_body ?? '', 60) }
        : null,
    })),
  })
})

app.post('/api/memes/:id/comments', async (c) => {
  const u = needUser(c)
  if (u.silenced) fail(403, '你在 linux.do 处于禁言状态')
  await needNotLimited(c, u, 'comment')
  const id = intIn(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER, 0)
  const b = await jsonBody<{ body?: string; reply_to?: unknown }>(c)
  const body = String(b.body ?? '').trim().slice(0, 1000)
  if (!body) fail(400, '说点什么吧')
  const exists = await c.env.DB.prepare('SELECT 1 FROM memes WHERE id = ? AND hidden = 0').bind(id).first()
  if (!exists) fail(404, '不存在')
  // 回复某条评论：必须是同一帖下、没删的
  const rid = intIn(b.reply_to, 0, Number.MAX_SAFE_INTEGER, 0)
  const parent = rid ? await c.env.DB.prepare(
    'SELECT c.id, c.body, u.username, u.name FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ? AND c.meme_id = ? AND c.deleted = 0',
  ).bind(rid, id).first<{ id: number; body: string; username: string; name: string | null }>() : null
  const last = await c.env.DB.prepare('SELECT MAX(created_at) AS t FROM comments WHERE user_id = ?')
    .bind(u.id).first<{ t: number | null }>()
  if (rateOn(c) && last?.t && now() - last.t < 5) fail(429, '慢一点，5 秒后再评论')

  const t = now()
  const [ins] = await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO comments (meme_id, user_id, body, reply_to, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .bind(id, u.id, body, parent?.id ?? null, t),
    c.env.DB.prepare('UPDATE memes SET comment_count = comment_count + 1 WHERE id = ?').bind(id),
  ])
  const cid = (ins.results[0] as { id: number }).id
  return c.json({
    comment: { id: cid, body, created_at: t, user_id: u.id, username: u.username, name: u.name, avatar: u.avatar,
      trust_level: u.trust_level, can_delete: true,
      reply_to: parent ? { id: parent.id, username: parent.username, name: parent.name, deleted: false, text: snippet(parent.body, 60) } : null },
  })
})

app.delete('/api/comments/:id', async (c) => {
  const u = needUser(c)
  const id = intIn(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER, 0)
  const row = await c.env.DB.prepare('SELECT c.user_id, u.kind, m.author_id FROM comments c JOIN users u ON u.id=c.user_id JOIN memes m ON m.id=c.meme_id WHERE c.id = ? AND c.deleted = 0')
    .bind(id).first<{ user_id: number; kind:string; author_id:number|null }>()
  if (!row) fail(404, '不存在')
  if (!canDeleteComment(u, row!)) fail(403, '没有权限')
  await deleteComment(c.env.DB,id,u)
  return c.json({ ok: true })
})

// ---------- 群聊 ----------
// 默认群（迷友）所有登录用户自动加入；建群、拉人、踢人、改名、解散只有管理员能做
const CHAT_PAGE = 40
const CHAT_BODY_MAX = 2000
type ChatRow = {
  id: number; group_id: number; user_id: number; body: string; image_key: string | null; width: number | null; height: number | null
  reply_to: number | null; deleted: number; created_at: number; updated_at: number; media: string | null; edited_at?: number | null
  username: string | null; name: string | null; avatar: string | null; trust_level: number | null; is_admin: number | null
  fancy?: number | null; deco?: string | null; seq: number; meme_id?: number | null; redpack_id?: string | null; system_kind?: string | null; system_ref?: string | null
}
const CHAT_FIELDS = `x.*, u.username, u.name, u.avatar, u.trust_level, u.is_admin, u.fancy, u.deco`
const CHAT_SELECT = `SELECT ${CHAT_FIELDS}
  FROM chat_messages x LEFT JOIN users u ON u.id = x.user_id`
// ORDER BY id otherwise makes SQLite scan the whole group on every idle poll.
const CHAT_UPDATES_SELECT = `SELECT ${CHAT_FIELDS}
  FROM chat_messages x INDEXED BY idx_chat_msg_upd LEFT JOIN users u ON u.id = x.user_id`
// Start from packets, rather than testing every historic message for a packet.
const CHAT_PACKET_SELECT = `SELECT ${CHAT_FIELDS}
  FROM chat_redpacks p CROSS JOIN chat_messages x ON x.id=p.message_id LEFT JOIN users u ON u.id=x.user_id`
// 短句回应（boost）：每人每条一句，最多 12 个字
const BOOST_MAX = 12
// 预览用：去掉引用块、折叠成一行
const chatPreview = (s: string, n = 60) => {
  const t = s.replace(/\[quote[^\]]*\][\s\S]*?\[\/quote\]/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}
// 被回复的原文：去掉引用块，保留换行，太长才截
const chatRefText = (s: string, n = 600) => {
  const t = s.replace(/\[quote[^\]]*\][\s\S]*?\[\/quote\]/g, '').replace(/\n{3,}/g, '\n\n').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}
const likeEsc = (s: string) => s.replace(/[\\%_]/g, (x) => '\\' + x)

// 新加入的人从「现在」开始算未读，不然一进来就是 999+
// 群管理（改名、拉人、移人、公告、入群申请）：管理员和群管都行；建群、解散只有网站管理员
const needAdmin = (c: C) => {
  const u = needUser(c)
  if (!isChatAdmin(u)) fail(403, '只有管理员能管理群组')
  return u
}
const msgMedia = (m: { media?: string | null }): Media[] | null => {
  if (!m.media) return null
  try { return JSON.parse(m.media) as Media[] } catch { return null }
}

// 被回复的那条：图只看第一项是不是真的图（文件附件不算图），有字就给字
function refOf(r: { id: number; body: string; image_key: string | null; media: string | null; deleted: number; username: string | null; name: string | null; avatar: string | null
  is_admin: number | null; trust_level: number | null; fancy: number | null; deco: string | null }) {
  const first = msgMedia(r)?.[0]
  const file = first?.kind === 'f' ? first : null
  const pic = !r.deleted && !file && r.image_key ? `/img/${r.image_key}` : null
  return {
    id: r.id, username: r.username, name: r.name, avatar: r.avatar, deleted: !!r.deleted, fancy: isFancy(r), deco: decoOf(r.deco),
    image: !!pic, thumb: pic, file: !r.deleted && file ? file.n ?? '文件' : null, text: r.deleted ? '' : chatRefText(r.body),
  }
}
// @ 已读：消息里 @ 到的群成员，last_read 过了这条就算看到了
const AT_RE = /(?<![\w@.])@([A-Za-z0-9_][\w.-]{0,30}[\w])/g
const atNames = (body: string) => [...new Set([...chatRefText(body, 4000).matchAll(AT_RE)].map((x) => x[1].toLowerCase()))].slice(0, 20)
async function atReads(c: C, rows: { id: number; group_id: number; body: string; deleted: number }[]) {
  const out = new Map<number, Record<string, boolean>>()
  const want = rows.filter((r) => !r.deleted && r.body?.includes('@')).map((r) => ({ r, names: atNames(r.body) })).filter((x) => x.names.length)
  if (!want.length) return out
  const gids = [...new Set(want.map((x) => x.r.group_id))]
  const names = [...new Set(want.flatMap((x) => x.names))]
  const { results } = await c.env.DB.prepare(
    `SELECT cm.group_id, lower(u.username) AS n, cm.last_read FROM json_each(?2) names
     CROSS JOIN users u ON u.username = names.value COLLATE NOCASE
     CROSS JOIN chat_members cm ON cm.user_id = u.id
     WHERE cm.group_id IN (SELECT value FROM json_each(?1))`,
  ).bind(JSON.stringify(gids), JSON.stringify(names)).all<{ group_id: number; n: string; last_read: number }>()
  const lr = new Map(results.map((x) => [x.group_id + ':' + x.n, x.last_read]))
  for (const { r, names: ns } of want) {
    const o: Record<string, boolean> = {}
    for (const n of ns) { const v = lr.get(r.group_id + ':' + n); if (v !== undefined) o[n] = v >= r.id }
    if (Object.keys(o).length) out.set(r.id, o)
  }
  return out
}
async function decorateMsgs(c: C, rows: ChatRow[]) {
  if (!rows.length) return []
  const u = c.get('user')
  const ids = JSON.stringify(rows.map((r) => r.id))
  const refs = JSON.stringify([...new Set(rows.map((r) => r.reply_to).filter(Boolean))])
  const [reacts, quoted, boosts, reads, replied, road, packets] = await Promise.all([
    c.env.DB.prepare(
      // who：最早点的三个人，前端在表情旁边叠头像
      `SELECT r.message_id, r.emoji, COUNT(*) AS n, MAX(r.user_id = ?) AS mine,
         (SELECT json_group_array(json_object('username', w.username, 'name', w.name, 'avatar', w.avatar))
          FROM (SELECT r2.user_id FROM chat_reactions r2 WHERE r2.message_id = r.message_id AND r2.emoji = r.emoji
                ORDER BY r2.created_at LIMIT 3) t JOIN users w ON w.id = t.user_id) AS who
       FROM chat_reactions r WHERE r.message_id IN (SELECT value FROM json_each(?)) GROUP BY r.message_id, r.emoji ORDER BY MIN(r.created_at)`,
    ).bind(u?.id ?? -1, ids).all<{ message_id: number; emoji: string; n: number; mine: number; who: string | null }>(),
    refs === '[]' ? { results: [] } : c.env.DB.prepare(
      `SELECT x.id, x.group_id, x.body, x.image_key, x.media, x.deleted, u.username, u.name, u.avatar, u.is_admin, u.trust_level, u.fancy, u.deco
       FROM chat_messages x LEFT JOIN users u ON u.id = x.user_id
       WHERE x.id IN (SELECT value FROM json_each(?1))
       AND EXISTS(SELECT 1 FROM chat_members cm WHERE cm.group_id=x.group_id AND cm.user_id=?2 AND x.created_at>=cm.joined_at AND x.id>=${CHAT_HISTORY_FLOOR})
       AND EXISTS(SELECT 1 FROM chat_messages source WHERE source.id IN (SELECT value FROM json_each(?3)) AND source.reply_to=x.id AND source.group_id=x.group_id)`,
    ).bind(refs,u?.id??0,ids).all<{ id: number; group_id:number; body: string; image_key: string | null; media: string | null; deleted: number; username: string | null; name: string | null; avatar: string | null
      is_admin: number | null; trust_level: number | null; fancy: number | null; deco: string | null }>(),
    c.env.DB.prepare(
      `SELECT b.message_id, b.text, b.user_id, b.created_at, b.ai_status, b.ai_score, u.kind, u.username, u.name, u.avatar, u.deco FROM chat_boosts b LEFT JOIN users u ON u.id = b.user_id
       WHERE b.message_id IN (SELECT value FROM json_each(?)) ORDER BY b.created_at`,
    ).bind(ids).all<{ deco: string | null; message_id: number; text: string; user_id: number; created_at: number; ai_status:string;ai_score:number|null;kind:string|null;username: string | null; name: string | null; avatar: string | null }>(),
    atReads(c, rows),
    // 反向引用：这一批里每条被多少条（没撤回的）消息回复过；走 idx_chat_msg_reply
    c.env.DB.prepare(
      `SELECT reply_to AS id, COUNT(*) AS n FROM chat_messages
       WHERE reply_to IN (SELECT value FROM json_each(?)) AND deleted = 0 GROUP BY reply_to`,
    ).bind(ids).all<{ id: number; n: number }>(),
    c.env.DB.prepare('SELECT source_msg_id AS mid, id FROM road_items INDEXED BY idx_road_source_msg WHERE source_msg_id IN (SELECT value FROM json_each(?)) AND hidden = 0 AND source_hidden = 0')
      .bind(ids).all<{ mid: number; id: number }>(),
    rows.some((r) => !r.deleted && (r.redpack_id || sharedPacket(r.body))) ? c.env.DB.prepare(
      `SELECT p.message_id, p.mode, p.game, p.prompt, p.provider, p.notify_at, p.draw_data, COALESCE(lp.mode,fp.mode) AS ldc_mode, COALESCE(lp.room_revision,fp.room_revision) AS guess_revision, lp.total_cents AS ldc_total,lp.payment_provider AS payment_provider, COALESCE(lp.response_mode,fp.response_mode) AS ldc_response_mode, CASE WHEN COALESCE(lp.response_mode,fp.response_mode)='similarity' THEN COALESCE(lp.answer_length,fp.answer_length) ELSE NULL END AS ldc_answer_length, CASE WHEN cp.packet_id IS NOT NULL THEN json_object('state',CASE WHEN cp.expires_at<=unixepoch() THEN 'expired' WHEN cp.remaining_count=0 THEN 'exhausted' ELSE 'active' END,'claimed',EXISTS(SELECT 1 FROM coin52_packet_slots WHERE packet_id=p.id AND recipient_id=${u?.id??0}),'remaining',cp.remaining_count,'total',cp.count,'claimed_count',cp.count-cp.remaining_count,'expires_at',cp.expires_at,'kind',cp.mode) ELSE v.data END AS snapshot, v.synced_at, o.solved_at,
       (SELECT COUNT(*) FROM chat_redpack_opens s WHERE s.packet_id=p.id AND s.solved_at IS NOT NULL) AS opened
       FROM chat_redpacks p LEFT JOIN chat_redpack_opens o ON o.packet_id=p.id AND o.user_id=?
       LEFT JOIN chat_redpack_external_views v ON v.packet_id=p.id AND v.user_id=?
       LEFT JOIN ldc_packets lp ON lp.packet_id=p.id
       LEFT JOIN guess_free_rounds fp ON fp.packet_id=p.id
       LEFT JOIN coin52_packets cp ON cp.packet_id=p.id
       WHERE p.message_id IN (SELECT value FROM json_each(?))`,
    ).bind(u?.id ?? 0, u?.id ?? 0, ids).all<{ message_id: number; mode: string; game: string; prompt: string; provider: string; notify_at: number | null; draw_data:string|null; ldc_mode:string|null;guess_revision:number|null;ldc_total:number|null;payment_provider:string|null;ldc_response_mode:string|null;ldc_answer_length:number|null; snapshot: string | null; synced_at: number | null; solved_at: number | null; opened: number }>() : { results: [] },
  ])
  const packetMap = new Map(packets.results.map((p) => [p.message_id, { mode: p.mode, game: p.game, prompt: p.prompt, provider: p.provider, ldc_mode:p.ldc_mode,guess_revision:p.guess_revision,ldc_total:p.ldc_total,payment_provider:p.payment_provider,ldc_response_mode:p.ldc_response_mode,ldc_answer_length:p.ldc_answer_length, notify_at: p.notify_at, draw: p.draw_data?JSON.parse(p.draw_data):null, snapshot: packetSnapshotView(p.snapshot), synced_at: p.synced_at, solved: !!p.solved_at, opened: p.opened }]))
  const roadIds = new Map(road.results.map((r) => [r.mid, r.id]))
  const rc = new Map(replied.results.map((r) => [r.id, r.n]))
  const bs = new Map<number, { deco: ReturnType<typeof decoOf>; text: string; mine: boolean; username: string | null; name: string | null; avatar: string | null; at: number;ai:boolean;status:string;score:number|null }[]>()
  for (const b of boosts.results) {
    const ai=b.kind==='bot'&&!!b.ai_status
    bs.set(b.message_id, [...(bs.get(b.message_id) ?? []), { deco: decoOf(b.deco), text: b.text, mine: !ai&&!!u && u.id === b.user_id, username: b.username, name: ai?'欢欢':b.name, avatar: ai?'/ai-avatar.svg':b.avatar, at: b.created_at,ai,status:ai?b.ai_status:'',score:ai?b.ai_score:null }])
  }
  const rx = new Map<number, { emoji: string; count: number; mine: boolean; who: unknown[] }[]>()
  for (const r of reacts.results) {
    let who: unknown[] = []
    try { who = JSON.parse(r.who || '[]') } catch {}
    rx.set(r.message_id, [...(rx.get(r.message_id) ?? []), { emoji: r.emoji, count: r.n, mine: !!r.mine, who }])
  }
  const q = new Map(quoted.results.map((r) => [r.id, r]))
  return rows.map((m) => {
    const r = m.reply_to ? q.get(m.reply_to) : null
    return {
      id: m.id, group_id: m.group_id, deleted: !!m.deleted, system_kind: m.system_kind ?? null, system_ref: m.system_ref ?? null,
      body: m.deleted ? '' : m.body,
      image: m.deleted || !m.image_key ? null : `/img/${m.image_key}`, width: m.width, height: m.height,
      media: m.deleted ? null : msgMedia(m)?.map(toGallery) ?? null,
      created_at: m.created_at, updated_at: m.updated_at, edited_at: m.deleted ? null : m.edited_at ?? null,
      user: { id: m.user_id, username: m.username ?? '佚名', name: m.name, avatar: m.avatar, trust_level: m.trust_level ?? 0, is_admin: !!m.is_admin, fancy: isFancy(m), deco: decoOf(m.deco) },
      reply_to: r?.group_id===m.group_id ? refOf(r) : null,
      reply_count: rc.get(m.id) ?? 0,
      reactions: rx.get(m.id) ?? [],
      boosts: m.deleted ? [] : bs.get(m.id) ?? [],
      at_read: reads.get(m.id) ?? null,
      mine: !!u && u.id === m.user_id,
      can_delete: !m.deleted && !m.redpack_id && !packetMap.has(m.id) && !sharedPacket(m.body) && !!u && ((!m.system_kind && u.id === m.user_id) || isChatAdmin(u)),
      can_edit: !m.deleted && !m.redpack_id && !packetMap.has(m.id) && !sharedPacket(m.body) && !m.system_kind && !!u && u.id === m.user_id,
      redpack: m.deleted || !packetMap.has(m.id) ? null : { ...packetMap.get(m.id), shared: !m.redpack_id, cover: m.redpack_id && m.image_key ? `/img/${m.image_key}` : null },
      meme_id: m.meme_id ?? null,
      road_id: m.deleted ? null : roadIds.get(m.id) ?? null,
    }
  })
}

app.get('/api/chat/groups', async (c) => {
  const u = c.get('user')
  if (!u) return c.json({ groups: [], gone: [], can_manage: false, dm_unread: 0 })
  await joinDefaultGroups(c, u.id).run()
  // 不在里面的群：被移出（kick）或自己退出（left），带上申请状态
  const gone = await c.env.DB.prepare(
    `SELECT g.id, g.name, g.is_default, b.kind, r.status AS req, r.created_at AS req_at FROM chat_bans b JOIN chat_groups g ON g.id = b.group_id
     LEFT JOIN chat_join_reqs r ON r.group_id = b.group_id AND r.user_id = b.user_id
     WHERE b.user_id = ? AND NOT EXISTS (SELECT 1 FROM chat_members m WHERE m.group_id = b.group_id AND m.user_id = b.user_id)
     ORDER BY g.is_default DESC, b.created_at DESC`,
  ).bind(u.id).all<{ id: number; name: string; is_default: number; kind: string; req: number | null; req_at: number | null }>()
  const pend = isChatAdmin(u) ? await c.env.DB.prepare('SELECT group_id AS gid, COUNT(*) AS n FROM chat_join_reqs WHERE status = 0 GROUP BY group_id')
    .all<{ gid: number; n: number }>() : null
  const pm = new Map((pend?.results ?? []).map((x) => [x.gid, x.n]))
  const { results } = await c.env.DB.prepare(
    `SELECT g.id, g.name, g.is_default, g.created_at, cm.last_read, cm.muted, g.notice, g.notice_at,
       g.member_count-(SELECT COUNT(*) FROM chat_members bm JOIN users bu ON bu.id=bm.user_id WHERE bm.group_id=g.id AND bu.kind='bot') AS members,
       (SELECT COUNT(*) FROM chat_members om JOIN users ou ON ou.id = om.user_id WHERE om.group_id = g.id AND ou.kind='user' AND ou.last_seen > ?3) AS online,
       (SELECT COUNT(*) FROM (SELECT 1 FROM chat_messages m WHERE m.group_id = g.id AND m.id > cm.last_read AND m.created_at>=cm.joined_at AND m.deleted = 0 AND m.user_id != ?1 LIMIT 100)) AS unread,
       (SELECT COUNT(*) FROM (SELECT 1 FROM chat_messages m INDEXED BY idx_chat_msg_at_unread WHERE m.group_id = g.id AND m.id > cm.last_read AND m.deleted = 0 AND m.user_id != ?1
          AND m.created_at>=cm.joined_at AND instr(m.body,'@') > 0 AND m.body LIKE ?2 ESCAPE '\\' LIMIT 20)) AS at_me,
       l.id AS last_id, l.body AS last_body, l.image_key AS last_image, l.deleted AS last_deleted, l.created_at AS last_at,
       lu.username AS last_by, lu.name AS last_by_name
     FROM chat_members cm JOIN chat_groups g ON g.id = cm.group_id
     LEFT JOIN chat_messages l ON l.id = (SELECT MAX(id) FROM chat_messages WHERE group_id = g.id) AND l.created_at>=cm.joined_at AND l.id>=${CHAT_HISTORY_FLOOR}
     LEFT JOIN users lu ON lu.id = l.user_id
     WHERE cm.user_id = ?1 ORDER BY g.is_default DESC, COALESCE(l.created_at, g.created_at) DESC`,
  ).bind(u.id, `%@${likeEsc(u.username)}%`, now() - 300).all<ChatGroup & {
    members: number; online: number; unread: number; at_me: number; muted: number; last_id: number | null; last_body: string | null; last_image: string | null
    last_deleted: number | null; last_at: number | null; last_by: string | null; last_by_name: string | null
    notice: string | null; notice_at: number | null
  }>()
  // 与已有群列表刷新共用一次请求；只读当前用户的未读尾部，不拉取私信正文。
  const dmUnread = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM (
    SELECT m.id FROM dm_threads t JOIN dm_messages m INDEXED BY idx_dm_messages_thread
      ON m.thread_id=t.id AND m.id>t.read_low
    WHERE t.user_low=?1 AND t.last_message_id>t.read_low AND m.sender_id<>?1
    UNION ALL
    SELECT m.id FROM dm_threads t JOIN dm_messages m INDEXED BY idx_dm_messages_thread
      ON m.thread_id=t.id AND m.id>t.read_high
    WHERE t.user_high=?1 AND t.last_message_id>t.read_high AND m.sender_id<>?1
    LIMIT 100
  )`).bind(u.id).first<{n:number}>()
  return c.json({
    can_manage: isChatAdmin(u), can_create: false, dm_unread: dmUnread?.n ?? 0,
    gone: gone.results.map((x) => ({ id: x.id, name: x.name, is_default: !!x.is_default, kind: x.kind === 'left' ? 'left' : 'kick', req: x.req, req_at: x.req_at })),
    groups: results.map((g) => ({
      id: g.id, name: g.name, is_default: !!g.is_default, members: g.members, online: g.online, unread: g.unread, at_me: g.at_me, muted: !!g.muted, last_read: g.last_read,
      notice: g.notice || null, notice_at: g.notice_at || null, reqs: pm.get(g.id) ?? 0,
      latest: g.last_id ? {
        id: g.last_id, at: g.last_at, by: g.last_by_name || g.last_by,
        text: g.last_deleted ? '[消息已撤回]' : chatPreview(g.last_body ?? '') || (g.last_image ? '[图片]' : ''),
      } : null,
    })),
  })
})

// 按用户名拉人；返回实际加进去的人数和没找到的名字（没登录过本站的人不在 users 表里）
async function addMembers(c: C, gid: number, names: string[]) {
  const list = JSON.stringify([...new Set(names.map((s) => String(s).trim().replace(/^@/, '')).filter(Boolean))].slice(0, 200))
  const [found, , , ins] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT username FROM users WHERE kind='user' AND username COLLATE NOCASE IN (SELECT value FROM json_each(?))").bind(list),
    // 被移出 / 自己退出过的，管理员重新拉就解除
    c.env.DB.prepare(`DELETE FROM chat_bans WHERE group_id = ? AND user_id IN
      (SELECT id FROM users WHERE kind='user' AND username COLLATE NOCASE IN (SELECT value FROM json_each(?)))`).bind(gid, list),
    c.env.DB.prepare(`DELETE FROM chat_join_reqs WHERE group_id = ? AND user_id IN
      (SELECT id FROM users WHERE kind='user' AND username COLLATE NOCASE IN (SELECT value FROM json_each(?)))`).bind(gid, list),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO chat_members (group_id, user_id, joined_at, last_read)
       SELECT ?1, id, ?2, (SELECT COALESCE(MAX(m.id), 0) FROM chat_messages m WHERE m.group_id = ?1)
       FROM users WHERE kind='user' AND username COLLATE NOCASE IN (SELECT value FROM json_each(?3)) RETURNING user_id`,
    ).bind(gid, now(), list),
  ])
  const have = new Set((found.results as { username: string }[]).map((r) => r.username.toLowerCase()))
  // 触发器的改动也会算进 meta.changes，用 RETURNING 的行数
  return { added: ins.results.length, missing: (JSON.parse(list) as string[]).filter((n) => !have.has(n.toLowerCase())) }
}
const groupId = (c: C) => intIn(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER, 0)

app.post('/api/chat/groups', async (c) => {
  needSiteAdmin(c)
  fail(403, '新建群聊已关闭')
})

app.patch('/api/chat/groups/:id', async (c) => {
  needAdmin(c)
  const name = String((await jsonBody<{ name?: string }>(c)).name ?? '').trim().slice(0, 20)
  if (!name) fail(400, '群名不能为空')
  const r = await c.env.DB.prepare('UPDATE chat_groups SET name = ? WHERE id = ?').bind(name, groupId(c)).run()
  if (!r.meta.changes) fail(404, '群不存在')
  return c.json({ ok: true })
})

app.delete('/api/chat/groups/:id', async (c) => {
  needSiteAdmin(c)
  const gid = groupId(c)
  const g = await c.env.DB.prepare('SELECT is_default FROM chat_groups WHERE id = ?').bind(gid).first<{ is_default: number }>()
  if (!g) fail(404, '群不存在')
  if (gid === 1 || g!.is_default) fail(400, '迷友群不能解散')
  const { results: imgs } = await c.env.DB.prepare('SELECT image_key, media FROM chat_messages WHERE group_id = ? AND image_key IS NOT NULL')
    .bind(gid).all<{ image_key: string; media: string | null }>()
  const keys = [...new Set(imgs.flatMap((r) => [r.image_key, ...mediaKeys(msgMedia(r) ?? [])]))]
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE road_items SET source_hidden = 1, updated_at = ? WHERE source_group_id = ?').bind(now(), gid),
    c.env.DB.prepare('DELETE FROM chat_reactions WHERE message_id IN (SELECT id FROM chat_messages WHERE group_id = ?)').bind(gid),
    c.env.DB.prepare('DELETE FROM chat_boosts WHERE message_id IN (SELECT id FROM chat_messages WHERE group_id = ?)').bind(gid),
    c.env.DB.prepare('DELETE FROM chat_messages WHERE group_id = ?').bind(gid),
    c.env.DB.prepare('DELETE FROM chat_members WHERE group_id = ?').bind(gid),
    c.env.DB.prepare('DELETE FROM chat_groups WHERE id = ?').bind(gid),
  ])
  for (let i = 0; i < keys.length; i += 1000) await c.env.BUCKET.delete(keys.slice(i, i + 1000))
  return c.json({ ok: true })
})

app.get('/api/chat/groups/:id/activity-stats',async c=>{
  const gid=groupId(c);const {u}=await needMember(c,gid,false);await assertCurrentAccess(c,u.id,gid)
  c.header('cache-control','private, max-age=30');return c.json(await chatRankView(c,gid,u.id))
})

app.get('/api/chat/groups/:id/members', async (c) => {
  const { g } = await needMember(c, groupId(c))
  // @ 补全不需要装扮、简介和成员管理字段，沿用同一鉴权与排序。
  if (c.req.query('view') === 'mention') {
    const { results } = await c.env.DB.prepare(
      `SELECT u.username, u.name, u.avatar FROM chat_members cm
       JOIN users u ON u.id = cm.user_id WHERE cm.group_id = ? AND u.kind='user'
       ORDER BY (u.last_seen > ?) DESC, cm.joined_at ASC, cm.rowid ASC LIMIT 300`,
    ).bind(g.id, now() - 180).all()
    return c.json({ members: results })
  }
  const [list, total] = await c.env.DB.batch([
    c.env.DB.prepare(
      // 在线的（3 分钟内有动静）排前面，其余按进群先后
      `SELECT u.id, u.username, u.name, u.avatar, u.trust_level, u.is_admin, u.role, u.fancy, u.deco, u.bio, u.last_seen, cm.joined_at FROM chat_members cm
       JOIN users u ON u.id = cm.user_id WHERE cm.group_id = ? AND u.kind='user'
       ORDER BY (u.last_seen > ?) DESC, cm.joined_at ASC, cm.rowid ASC LIMIT 300`,
    ).bind(g.id, now() - 180),
    c.env.DB.prepare("SELECT member_count-(SELECT COUNT(*) FROM chat_members bm JOIN users bu ON bu.id=bm.user_id WHERE bm.group_id=g.id AND bu.kind='bot') AS n, created_by FROM chat_groups g WHERE id = ?").bind(g.id),
  ])
  // creator = 建群的人；默认群没有建群人，前端按 owner（站长）当群主
  const creator = (total.results[0] as { created_by: number | null }).created_by
  return c.json({
    group: { id: g.id, name: g.name, is_default: !!g.is_default },
    members: (list.results as (User & { is_admin: number })[]).map((m) => ({ ...m, is_admin: !!m.is_admin, fancy: isFancy(m), deco: decoOf(m.deco), last_seen: m.last_seen || null,
      creator: creator != null && m.id === creator, owner: creator == null && isOwner(c, m) })),
    now: now(),
    total: (total.results[0] as { n: number }).n,
  })
})

app.post('/api/chat/groups/:id/members', async (c) => {
  needAdmin(c)
  const gid = groupId(c)
  const g = await c.env.DB.prepare('SELECT is_default FROM chat_groups WHERE id = ?').bind(gid).first<{ is_default: number }>()
  if (!g) fail(404, '群不存在')
  const names = (await jsonBody<{ usernames?: unknown }>(c)).usernames
  if (!Array.isArray(names) || !names.length) fail(400, '选几个人吧')
  return c.json(await addMembers(c, gid, (names as unknown[]).map(String)))
})

// 管理员踢人，或者自己退群（uid 传自己的 id）。记进 chat_bans，默认群也不会再自动拉回来
app.delete('/api/chat/groups/:id/members/:uid', async (c) => {
  const u = needUser(c)
  const gid = groupId(c)
  // 本地测试账号的 id 是负数
  const uid = intIn(c.req.param('uid'), -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0)
  if (uid !== u.id && !isChatAdmin(u)) fail(403, '只有管理员能移出别人')
  const g = await c.env.DB.prepare('SELECT is_default FROM chat_groups WHERE id = ?').bind(gid).first<{ is_default: number }>()
  if (!g) fail(404, '群不存在')
  if (uid !== u.id) {
    const t = await c.env.DB.prepare('SELECT is_admin, role FROM users WHERE id = ?').bind(uid).first<{ is_admin: number; role: string | null }>()
    if (t?.is_admin) fail(400, '不能移出管理员')
    if (t?.role === 'gadmin' && !u.is_admin) fail(400, '群管只能由管理员移出')
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM chat_members WHERE group_id = ? AND user_id = ?').bind(gid, uid),
    c.env.DB.prepare('INSERT OR REPLACE INTO chat_bans (group_id, user_id, created_at, kind) VALUES (?, ?, ?, ?)')
      .bind(gid, uid, now(), uid === u.id ? 'left' : 'kick'),
    c.env.DB.prepare('DELETE FROM chat_join_reqs WHERE group_id = ? AND user_id = ?').bind(gid, uid),
  ])
  return c.json({ ok: true })
})

// 不在群里的人申请回群：同一时间一条；被拒后 10 分钟内不能再申请
app.post('/api/chat/groups/:id/join-req', async (c) => {
  const u = needUser(c)
  const gid = groupId(c)
  const ban = await c.env.DB.prepare('SELECT kind FROM chat_bans WHERE group_id = ? AND user_id = ?').bind(gid, u.id).first()
  if (!ban) fail(400, '你还在群里，或者这个群不收申请')
  const r = await c.env.DB.prepare('SELECT status, created_at FROM chat_join_reqs WHERE group_id = ? AND user_id = ?').bind(gid, u.id)
    .first<{ status: number; created_at: number }>()
  if (r?.status === 0) return c.json({ ok: true, req: 0 })
  if (r?.status === 2 && now() - r.created_at < 600) fail(429, '刚申请过，过一会儿再试')
  await c.env.DB.prepare(
    `INSERT INTO chat_join_reqs (group_id, user_id, status, created_at) VALUES (?, ?, 0, ?)
     ON CONFLICT (group_id, user_id) DO UPDATE SET status = 0, created_at = excluded.created_at`,
  ).bind(gid, u.id, now()).run()
  return c.json({ ok: true, req: 0 })
})

// 管理员 / 群管看：不在这个群里的人（被移出、自己退出、申请中）。其他人看不到
app.get('/api/chat/groups/:id/outside', async (c) => {
  needAdmin(c)
  const gid = groupId(c)
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.name, u.avatar, u.trust_level, u.last_seen, b.kind, b.created_at AS gone_at, r.status AS req, r.created_at AS req_at
     FROM chat_bans b JOIN users u ON u.id = b.user_id LEFT JOIN chat_join_reqs r ON r.group_id = b.group_id AND r.user_id = b.user_id
     WHERE b.group_id = ? AND u.kind='user' AND NOT EXISTS (SELECT 1 FROM chat_members m WHERE m.group_id = b.group_id AND m.user_id = b.user_id)
     ORDER BY (r.status = 0) DESC, COALESCE(r.created_at, b.created_at) DESC LIMIT 300`,
  ).bind(gid).all()
  return c.json({ now: now(), users: results })
})

// 处理申请：ok = true 拉回群，false 拒绝
app.post('/api/chat/groups/:id/join-req/:uid', async (c) => {
  needAdmin(c)
  const gid = groupId(c)
  const uid = intIn(c.req.param('uid'), -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0)
  const ok = !!(await jsonBody<{ ok?: boolean }>(c)).ok
  const t = await c.env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(uid).first<{ username: string }>()
  if (!t) fail(404, '没有这个用户')
  if (!(await c.env.DB.prepare('SELECT 1 FROM chat_groups WHERE id = ?').bind(gid).first())) fail(404, '群不存在')
  if (ok) return c.json({ ok: true, ...(await addMembers(c, gid, [t!.username])) })
  await c.env.DB.prepare('UPDATE chat_join_reqs SET status = 2, created_at = ? WHERE group_id = ? AND user_id = ?').bind(now(), gid, uid).run()
  return c.json({ ok: true })
})

// 群公告：管理员 / 群管改，空就是撤掉
app.put('/api/chat/groups/:id/notice', async (c) => {
  needAdmin(c)
  const text = String((await jsonBody<{ notice?: string }>(c)).notice ?? '').replace(/\r/g, '').trim().slice(0, 1000)
  const t = now()
  const r = await c.env.DB.prepare('UPDATE chat_groups SET notice = ?, notice_at = ? WHERE id = ?').bind(text || null, text ? t : null, groupId(c)).run()
  if (!r.meta.changes) fail(404, '群不存在')
  return c.json({ ok: true, notice: text || null, notice_at: text ? t : null })
})

// 搜用户：拉人、@ 人、只看某些人的帖都用
app.get('/api/chat/users', async (c) => {
  needUser(c)
  const q = (c.req.query('q') ?? '').trim().slice(0, 30)
  if (!q) return c.json({ users: [] })
  const like = `%${q.replace(/[\\%_]/g, (s) => '\\' + s)}%`
  const { results } = await c.env.DB.prepare(
    `SELECT id, username, name, avatar, trust_level FROM users
     WHERE kind='user' AND (username LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY (username = ? COLLATE NOCASE) DESC, updated_at DESC LIMIT 20`,
  ).bind(like, like, q).all()
  return c.json({ users: results })
})

// 公告引用只取一条；始终验证引用来源群的成员权限，不更新已读游标。
app.get('/api/chat/groups/:id/messages/:mid', async (c) => {
  const { g } = await needMember(c, groupId(c))
  const raw = c.req.param('mid')
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) fail(400, '消息编号无效')
  const row = await c.env.DB.prepare(`${CHAT_SELECT} WHERE x.group_id = ? AND x.id = ? AND x.created_at>=? AND x.id>=${g.history_floor}`)
    .bind(g.id, Number(raw),g.joined_at).first<ChatRow>()
  if (!row) return fail(404, '原消息不存在')
  if (row.deleted) throw new HTTPException(410, { message: '原消息已撤回' })
  const [message] = await decorateMsgs(c, [row])
  return c.json({ message })
})

// 群文件：仅显式打开时读取；部分索引覆盖所有附件位置，按消息游标分页。
app.get('/api/chat/groups/:id/files', async (c) => {
  const { g } = await needMember(c, groupId(c))
  const before = intIn(c.req.query('before'), 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  const rows = (await c.env.DB.prepare(`SELECT x.id,x.user_id,x.media,x.created_at,u.username,u.name FROM (
    SELECT id,user_id,media,created_at FROM chat_messages INDEXED BY idx_chat_files_page
    WHERE group_id=? AND id<? AND id>=${g.history_floor} AND created_at>=? AND deleted=0
      AND instr(CASE WHEN json_valid(media) THEN json(media) ELSE '[]' END,'"kind":"f"')>0
    ORDER BY id DESC LIMIT 21
  ) x JOIN users u ON u.id=x.user_id ORDER BY x.id DESC`).bind(g.id,before,g.joined_at).all<{
    id:number; user_id:number; media:string; created_at:number; username:string; name:string|null
  }>()).results
  const page=rows.slice(0,20)
  return c.json({items:page.flatMap(row=>{
    const media:unknown=JSON.parse(row.media)
    return (Array.isArray(media)?media:[]).filter(m=>m && m.kind==='f' && typeof m.k==='string').map(m=>({
      message_id:row.id,created_at:row.created_at,by:row.name||row.username,...toGallery(m),
    }))
  }),before:page.at(-1)?.id??null,more:rows.length>20})
})

// 消息：默认取最新一页；before=更早一页；after=轮询新消息，配合 since 拿到撤回 / 表情变化
app.get('/api/chat/groups/:id/messages', async (c) => {
  const { g } = await needMember(c, groupId(c))
  const MAX = Number.MAX_SAFE_INTEGER
  const after = intIn(c.req.query('after'), 0, MAX, 0)
  const before = intIn(c.req.query('before'), 0, MAX, 0)
  const since = intIn(c.req.query('since'), 0, MAX, 0)
  // until：从 before 往前一口气取到这条为止（搜索结果、回复原文跳到很早的消息）
  const until = intIn(c.req.query('until'), 0, MAX, 0)
  // around：直接取某条前后各一段（跳到没加载的消息时用，前端另开一个「跳转窗口」，不和往上翻的历史混在一起）
  const around = intIn(c.req.query('around'), 0, MAX, 0)
  const db = c.env.DB
  let rows: ChatRow[]
  let more: boolean
  let moreAfter: boolean | undefined
  const updates = after && since ? db.prepare(`${CHAT_UPDATES_SELECT} WHERE x.group_id = ? AND x.id <= ? AND x.id>=${g.history_floor} AND x.updated_at >= ? AND x.created_at>=? ORDER BY x.id LIMIT 200`)
    .bind(g.id, after, since,g.joined_at) : null
  // 仅纯增量调用方可明确省略总数；首屏、历史跳转和默认 API 保留楼层总数。
  const skipTotal = after > 0 && !around && !(until && before) && c.req.query('include_total') === '0'
  const totalQuery = skipTotal ? null : db.prepare('SELECT MAX(seq) AS total FROM chat_messages WHERE group_id = ?').bind(g.id)
  let changed: ChatRow[] = []
  let stat: { total: number | null } | null = null
  let pollBatched = false
  if (around) {
    const [up, down] = await db.batch([
      db.prepare(`${CHAT_SELECT} WHERE x.group_id = ? AND x.id <= ? AND x.id>=${g.history_floor} AND x.created_at>=? ORDER BY x.id DESC LIMIT 26`).bind(g.id, around,g.joined_at),
      db.prepare(`${CHAT_SELECT} WHERE x.group_id = ? AND x.id > ? AND x.id>=${g.history_floor} AND x.created_at>=? ORDER BY x.id ASC LIMIT 26`).bind(g.id, around,g.joined_at),
    ])
    const a = up.results as ChatRow[]
    const b = down.results as ChatRow[]
    more = a.length > 25
    moreAfter = b.length > 25
    rows = [...a.slice(0, 25).reverse(), ...b.slice(0, 25)]
  } else if (until && before) {
    rows = (await db.prepare(`${CHAT_SELECT} WHERE x.group_id = ? AND x.id < ? AND x.id >= ? AND x.created_at>=? ORDER BY x.id DESC LIMIT 400`)
      .bind(g.id, before, Math.max(g.history_floor, until),g.joined_at).all<ChatRow>()).results
    // 太远了（中间隔着 400 条以上）就只给到这里，前端再接着要
    const last = rows[rows.length - 1]
    more = !!(await db.prepare(`SELECT 1 FROM chat_messages WHERE group_id = ? AND id < ? AND id>=${g.history_floor} AND created_at>=? LIMIT 1`).bind(g.id, last ? last.id : before,g.joined_at).first())
    // 往前再多带几条上文
    if (last && last.id <= until) {
      const ctx = (await db.prepare(`${CHAT_SELECT} WHERE x.group_id = ? AND x.id < ? AND x.id>=${g.history_floor} AND x.created_at>=? ORDER BY x.id DESC LIMIT 10`).bind(g.id, last.id,g.joined_at).all<ChatRow>()).results
      rows.push(...ctx)
      more = ctx.length === 10
    }
    rows.reverse()
  } else if (after) {
    // 同一增量响应合为一次往返；本站轮询不读取总数，避免重复 MAX 查询。
    const batch = await db.batch([
      db.prepare(`${CHAT_SELECT} WHERE x.group_id = ? AND x.id > ? AND x.id>=${g.history_floor} AND x.created_at>=? ORDER BY x.id ASC LIMIT 101`).bind(g.id, after,g.joined_at),
      ...(updates ? [updates] : []), ...(totalQuery ? [totalQuery] : []),
    ])
    rows = batch[0].results as ChatRow[]
    changed = updates ? batch[1].results as ChatRow[] : []
    if (totalQuery) stat = batch[batch.length - 1].results[0] as { total: number | null }
    pollBatched = true
    more = rows.length > 100
    rows = rows.slice(0, 100)
  } else {
    rows = (await db.prepare(`${CHAT_SELECT} WHERE x.group_id = ? AND (?2 = 0 OR x.id < ?2) AND x.id>=${g.history_floor} AND x.created_at>=?4 ORDER BY x.id DESC LIMIT ?3`)
      .bind(g.id, before, CHAT_PAGE + 1,g.joined_at).all<ChatRow>()).results
    more = rows.length > CHAT_PAGE
    rows = rows.slice(0, CHAT_PAGE).reverse()
  }
  if (!pollBatched && updates) changed = (await updates.all<ChatRow>()).results
  // 楼层号：撤回的消息也占楼（像论坛一样显示「已撤回」），所以每页里是连续的
  // 楼层号 = seq（触发器按群递增），撤回的也占楼
  if (!pollBatched && totalQuery) stat = await totalQuery.first<{ total: number | null }>()
  const items = (await decorateMsgs(c, rows)).map((m, i) => ({ ...m, floor: rows[i].seq }))
  return c.json({
    group: { id: g.id, name: g.name, is_default: !!g.is_default, history_since:g.joined_at },
    items, changed: await decorateMsgs(c, changed), more, ...(moreAfter !== undefined ? { more_after: moreAfter } : {}),
    ...(!skipTotal ? { total: stat?.total ?? 0 } : {}), last_read: g.last_read, now: now(),
  })
})

// 历史消息搜索：按内容 / 发送人找，新的在前，before 翻页
app.get('/api/chat/groups/:id/search', async (c) => {
  const { g } = await needMember(c, groupId(c))
  const q = (c.req.query('q') ?? '').trim().slice(0, 50)
  const who = (c.req.query('user') ?? '').trim().replace(/^@/, '').slice(0, 40)
  const before = intIn(c.req.query('before'), 0, Number.MAX_SAFE_INTEGER, 0)
  const img = c.req.query('img') === '1'
  if (!q && !who && !img) return c.json({ items: [], more: false })
  const where = ['x.group_id = ?', 'x.deleted = 0', 'x.created_at>=?', `x.id>=${g.history_floor}`]
  const args: (string | number)[] = [g.id,g.joined_at]
  if (q) { where.push("x.body LIKE ? ESCAPE '\\'"); args.push(`%${likeEsc(q)}%`) }
  if (img) where.push('x.image_key IS NOT NULL')
  if (before) { where.push('x.id < ?'); args.push(before) }
  let query = `${CHAT_SELECT} WHERE ${where.join(' AND ')} ORDER BY x.id DESC LIMIT 31`
  if (who) {
    const pattern = `%${likeEsc(who)}%`
    const senders = (await c.env.DB.prepare("SELECT id FROM users WHERE username LIKE ?1 ESCAPE '\\' OR name LIKE ?1 ESCAPE '\\' LIMIT 9").bind(pattern).all<{id:number}>()).results
    if (!senders.length) return c.json({ items: [], more: false })
    if (senders.length <= 8) {
      // 每人最多取31条，再合并全局前31；不能先取一个人的全部历史后排序。
      const perSender = `SELECT id FROM (SELECT x.id FROM chat_messages x INDEXED BY idx_chat_msg_sender_page WHERE ${where.join(' AND ')} AND x.user_id = ? ORDER BY x.id DESC LIMIT 31)`
      const chunks: string[] = []
      for (let i = 0; i < senders.length; i += 4) chunks.push(`SELECT id FROM (${senders.slice(i,i+4).map(()=>perSender).join(' UNION ALL ')})`)
      query = `${CHAT_SELECT} WHERE x.id IN (${chunks.join(' UNION ALL ')}) ORDER BY x.id DESC LIMIT 31`
      const bound = senders.flatMap(s=>[...args,s.id]); args.splice(0,args.length,...bound)
    } else {
      // 广泛匹配保留群内倒序早停，避免遍历每位发送人的历史。
      where.push("(u.username LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')"); args.push(pattern,pattern)
      query = `${CHAT_SELECT} WHERE ${where.join(' AND ')} ORDER BY x.id DESC LIMIT 31`
    }
  }
  const rows = (await c.env.DB.prepare(query).bind(...args).all<ChatRow>()).results
  const list = rows.slice(0, 30)
  const items = await decorateMsgs(c, list)
  return c.json({ items: items.map((m, i) => ({ ...m, floor: list[i].seq })), more: rows.length > 30 })
})

// 同一条消息别存两遍：手机网络抖一下，请求其实到了但回包丢了，再点「重试」就会重复。
// 同一个人、同一个群、同样的内容 / 回复 / 第一张图，10 秒内（点重试的 2 分钟内）当成同一条，直接把已有的那条还回去
async function chatDup(c: C, gid: number, uid: number, body: string, replyTo: number, img: string | null, retry: boolean,joinedAt:number) {
  const db = c.env.DB
  const row = await db.prepare(
    `SELECT id FROM chat_messages WHERE user_id = ? AND group_id = ? AND created_at > ? AND deleted = 0 AND redpack_id IS NULL AND system_kind IS NULL AND body = ?
       AND COALESCE(reply_to, 0) = ? AND image_key IS ? ORDER BY id DESC LIMIT 1`,
  ).bind(uid, gid, Math.max(joinedAt-1,now() - (retry ? 120 : 10)), body, replyTo, img).first<{ id: number }>()
  if (!row) return null
  // 新红包发出后再次说同一个口令，是新的有效参与，不能被旧消息去重吞掉。
  if (!retry && await db.prepare(`SELECT 1 FROM chat_messages m JOIN chat_redpacks p ON p.message_id=m.id
    WHERE m.group_id=? AND m.id>? AND m.deleted=0 AND p.mode='phrase' AND p.phrase=? LIMIT 1`).bind(gid, row.id, body).first()) return null
  const shared = sharedPacket(body)
  if (shared) await db.batch(sharedPacketStatements(db, row.id, body, shared))
  const full = (await db.prepare(`${CHAT_SELECT} WHERE x.id = ?`).bind(row.id).all<ChatRow>()).results
  const [message] = await decorateMsgs(c, full)
  // A fresh user submission can retry a failed AI reply. Transport retries still deduplicate.
  if (!retry && message.boosts.some((b) => b.ai && b.status === 'error')) return null
  return { ...message, floor: full[0].seq }
}

app.post('/api/chat/groups/:id/messages', async (c) => {
  const { u, g } = await needMember(c, groupId(c))
  if (u.silenced) fail(403, '你在 linux.do 处于禁言状态')
  await needNotLimited(c, u, 'chat')
  const db = c.env.DB
  const t = now()
  const rate = await db.prepare(
    `SELECT MAX(created_at) AS last, COUNT(*) AS n,
       (SELECT COUNT(*) FROM chat_messages INDEXED BY idx_chat_msg_media_rate
        WHERE user_id=?2 AND created_at>?3 AND system_kind IS NULL AND image_key IS NOT NULL) AS imgs
     FROM chat_messages INDEXED BY idx_chat_msg_user
     WHERE user_id=?2 AND created_at>?1 AND system_kind IS NULL`,
  ).bind(t - 60, u.id, t - 86400).first<{ last: number | null; n: number | null; imgs: number | null }>()
  let body = ''
  let replyTo = 0
  let file: File | null = null
  let dims = { w: 0, h: 0 }
  let media: Media[] = []
  let favoriteGuard:D1PreparedStatement|null=null
  if ((c.req.header('content-type') ?? '').includes('multipart/form-data')) {
    const form = await c.req.formData()
    body = String(form.get('body') ?? '')
    replyTo = intIn(form.get('reply_to'), 0, Number.MAX_SAFE_INTEGER, 0)
    if (rateOn(c) && rate?.last && t - rate.last < 1) fail(429, '慢一点')
    if (rateOn(c) && (rate?.n ?? 0) >= 30) fail(429, '发得太快了，歇一会儿')
    const f = form.get('file')
    if (f instanceof File && f.size) file = f
    dims = { w: intIn(form.get('width'), 1, 20000, 0), h: intIn(form.get('height'), 1, 20000, 0) }
  } else {
    const b = await jsonBody<{ body?: string; reply_to?: number; media?: unknown; retry?: unknown; favorite?:unknown }>(c)
    body = String(b.body ?? '')
    replyTo = intIn(b.reply_to, 0, Number.MAX_SAFE_INTEGER, 0)
    // 先查重（媒体认领之后就不能再认领了，所以放在认领前面）
    const m0 = Array.isArray(b.media) ? b.media[0] as { key?: unknown; poster?: unknown } | undefined : undefined
    const img0 = m0 ? String(m0.poster || m0.key || '') || null : null
    const dup = await chatDup(c, g.id, u.id, body.replace(/\r/g, '').trim().slice(0, CHAT_BODY_MAX), replyTo, img0, !!b.retry,g.joined_at)
    if (dup) return c.json({ message: dup, dup: true })
    favoriteGuard=await favoriteSendGuard(c,u.id,b.favorite,body)
    if (rateOn(c) && rate?.last && t - rate.last < 1) fail(429, '慢一点')
    if (rateOn(c) && (rate?.n ?? 0) >= 30) fail(429, '发得太快了，歇一会儿')
    if (Array.isArray(b.media) && b.media.length) {
      if (rateOn(c) && u.is_admin !== 1 && (rate?.imgs ?? 0) >= 120) fail(429, '今天发的图够多了（一天 120 张），明天再来')
      media = await prepareMedia(c, u.id, b.media, true)
    }
  }
  body = body.replace(/\r/g, '').trim().slice(0, CHAT_BODY_MAX)
  if (!body && !file && !media.length) fail(400, '说点什么吧')

  let key: string | null = null
  let legacyUpload: string | null = null
  if (file) {
    if (file.size > MAX_UPLOAD) fail(413, '图片不能超过 20MB')
    if (rateOn(c) && u.is_admin !== 1 && (rate?.imgs ?? 0) >= 120) fail(429, '今天发的图够多了（一天 120 张），明天再来')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const kind = sniffImage(bytes) ?? fail(415, '只支持 PNG / JPG / GIF / WebP')
    const stored = await storeUpload(c.env.DB,c.env.BUCKET,{uid:u.id,nonce:undefined,bytes,mime:kind[0],ext:kind[1],purpose:'chat',asFile:false,limited:rateOn(c)&&u.is_admin!==1,t})
    key = legacyUpload = stored.key
  } else if (media.length) {
    // image_key 放第一张的图（视频放封面），老的预览、计数逻辑照常用
    key = media[0].p ?? media[0].k
    dims = { w: media[0].w ?? 0, h: media[0].h ?? 0 }
  }
  if (replyTo) {
    const ok = await db.prepare(`SELECT 1 FROM chat_messages WHERE id = ? AND group_id = ? AND created_at>=? AND id>=${g.history_floor}`).bind(replyTo, g.id,g.joined_at).first()
    if (!ok) replyTo = 0
  }
  const multi = media.length > 1 || !!media[0]?.p || !!media[0]?.o || !!media[0]?.b || media[0]?.kind === 'f'
  const mediaJson = multi ? JSON.stringify(media) : null
  const roadAttachments = media.length ? media.filter((m) => m.kind !== 'f').map(toGallery)
    : key ? [{ u: `/img/${key}`, w: dims.w, h: dims.h }] : []
  const committed = await commitUploadContent(db,u.id,legacyUpload?[legacyUpload]:mediaKeys(media),[...(favoriteGuard?[favoriteGuard]:[]),db.prepare(
    `INSERT INTO chat_messages (group_id, user_id, body, image_key, width, height, media, reply_to, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(g.id, u.id, body, key, key ? dims.w || null : null, key ? dims.h || null : null,
    mediaJson, replyTo || null, t, t), ...chatRoadStatements(db, null, body, roadAttachments, t)]).catch(error=>{
      if(String(error).includes('favorite_source_changed'))fail(409,'来源消息已变化，请重新打开收藏')
      throw error
    })
  const inserted=committed[favoriteGuard?1:0]
  const id = (inserted.results[0] as { id: number }).id
  // The sidebar is plain conversation; guessing and hints use the dedicated guess-room routes.
  const [full, floor] = await db.batch([
    db.prepare(`${CHAT_SELECT} WHERE x.id = ?`).bind(id),
    db.prepare('SELECT seq AS n FROM chat_messages WHERE id = ?').bind(id),
  ])
  // 发送不代表读完旧消息；只由实际读到最新的 /read 请求推进游标。
  const [message] = await decorateMsgs(c, full.results as ChatRow[])
  return c.json({ message: { ...message, floor: (floor.results[0] as { n: number }).n } })
})

async function chatMessage(c: C) {
  const u = needUser(c)
  const id = intIn(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER, 0)
  const m = await c.env.DB.prepare(`${CHAT_SELECT} WHERE x.id = ?`).bind(id).first<ChatRow>()
  if (!m) fail(404, '消息不存在')
  const {g}=await needMember(c, m!.group_id)
  if(m!.created_at<g.joined_at||m!.id<g.history_floor)fail(404,'消息不在你的可见范围内')
  if (m!.system_kind && c.req.method !== 'GET' && !(c.req.method === 'DELETE' && isChatAdmin(u))) fail(400, '系统提醒不能修改或回应')
  return { u, m: m!, g }
}

// ---------- 群聊红包：独立解锁，不涉及金额 ----------
type ChatPacket = PacketConfig & ExternalPacket & { id: string; message_id: number; notify_at: number | null; draw_data:string|null }
function packetSnapshotView(raw: string | null) {
  if(!raw)return null
  const s=JSON.parse(raw)
  if(!s.claimed && s.state==='active' && !['timed_draw','lottery'].includes(s.kind) && s.expires_at>0 && s.expires_at<=now())s.state='expired'
  return s
}
async function packetImage(c: C, p: PacketConfig) {
  if (!p.post_id) return null
  const m = await c.env.DB.prepare('SELECT * FROM memes WHERE id=? AND hidden=0').bind(p.post_id).first<MemeRow & { nsfw: number }>()
  if (!m) return null
  const im = galleryOf(m)[p.image_index]
  if (!im?.u || im.k === 'v' || im.k === 'f') return null
  // 只将预先合成的线索图交给未解锁成员。旧包没有线索图时也不能回退到原图。
  return { u: im.o || im.u, clue: p.clue_key ? `/img/${p.clue_key}` : null, nsfw: !!m.nsfw }
}
async function loadChatPacket(c: C) {
  const { u, m } = await chatMessage(c)
  if (m.deleted) fail(404, '红包不存在或已撤回')
  const p = await c.env.DB.prepare('SELECT * FROM chat_redpacks WHERE message_id=?')
    .bind(m.id).first<ChatPacket>()
  if (!p) fail(404, '红包不存在或已撤回')
  return { u, m, p: p! }
}
async function chatPacketView(c: C, p: ChatPacket, uid: number) {
  if(p.provider==='coin52')return {id:p.id,provider:'coin52',mode:'open',game:'coin52',prompt:p.prompt,coin52:await coinPacketView(c.env.DB,p.id,uid,now())}
  if(['ldc','free_guess'].includes(p.game)){
    const cover=await c.env.DB.prepare('SELECT image_key FROM chat_messages WHERE id=?').bind(p.message_id).first<{image_key:string|null}>()
    return {id:p.id,provider:'native',mode:'open',game:p.game,prompt:p.prompt,cover:cover?.image_key?`/img/${cover.image_key}`:null,ldc:await nativeView(c,p.id,uid)}
  }
  const [state, count, image, view, cover, rank, reward] = await Promise.all([
    c.env.DB.prepare('SELECT solved_at, attempts FROM chat_redpack_opens WHERE packet_id=? AND user_id=?')
      .bind(p.id, uid).first<{ solved_at: number | null; attempts: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM chat_redpack_opens WHERE packet_id=? AND solved_at IS NOT NULL').bind(p.id).first<{ n: number }>(),
    p.mode === 'image' ? packetImage(c, p) : null,
    c.env.DB.prepare(`SELECT v.data,v.synced_at,p.draw_data FROM chat_redpacks p
      LEFT JOIN chat_redpack_external_views v ON v.packet_id=p.id AND v.user_id=? WHERE p.id=?`).bind(uid,p.id).first<{data: string|null; synced_at: number|null;draw_data:string|null}>(),
    c.env.DB.prepare('SELECT image_key,body FROM chat_messages WHERE id=?').bind(p.message_id).first<{image_key:string|null;body:string}>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM chat_redpack_successes WHERE packet_id=? AND seq <=
      (SELECT seq FROM chat_redpack_successes WHERE packet_id=? AND user_id=?)
      AND (?<>'native' OR NOT EXISTS(SELECT 1 FROM chat_redpack_opens o WHERE o.packet_id=? AND o.solved_at IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM chat_redpack_successes s WHERE s.packet_id=o.packet_id AND s.user_id=o.user_id)))`)
      .bind(p.id,p.id,uid,p.provider,p.id).first<{n:number}>(),
    p.provider==='native' ? c.env.DB.prepare('SELECT * FROM ldc_packets WHERE packet_id=?').bind(p.id).first<NativePacket>() : null,
  ])
  const solved = !!state?.solved_at
  const sharedCode=p.id.startsWith('shared:')&&p.provider==='fish' ? sharedPacket(cover?.body||'') : null
  const externalCode=p.external_code||(sharedCode?.provider===p.provider&&sharedCode.external_ref===p.external_ref?sharedCode.external_code:null)
  return { id: p.id, mode: p.mode, game: p.game, prompt: p.prompt, length: [...p.secret].length,
    provider: p.provider, notify_at: p.notify_at, draw:view?.draw_data?JSON.parse(view.draw_data):null, snapshot: packetSnapshotView(view?.data ?? null), synced_at: view?.synced_at,
    reward:reward?await nativeView(c,p.id,uid,reward):undefined,
    cover: !p.id.startsWith('shared:') && cover?.image_key ? `/img/${cover.image_key}` : null, rank: rank?.n || null, rank_scope: p.provider==='native'?'开包次序':'本群成功回报顺序',
    external: p.provider !== 'native' ? { provider: p.provider, ref: p.external_ref, ref_kind: p.external_kind, code:externalCode||undefined,
      url: packetReferenceUrl({provider:p.provider,external_ref:p.external_ref,external_kind:p.external_kind}) } : undefined,
    phrase: p.mode === 'phrase' ? p.phrase : undefined,
    clue: p.mode === 'cipher' && !solved ? packetClue(p) : undefined,
    image: image && { u: solved ? image.u : image.clue, mask: p.mask, nsfw: image.nsfw },
    unavailable: p.mode === 'image' && !image, attempts: state?.attempts ?? 0,
    solved, opened: count?.n ?? 0, secret: solved&&(!reward||!['open','phrase'].includes(p.mode)) ? p.secret : undefined,
    post_id: solved && image ? p.post_id : undefined }
}
app.post('/api/chat/groups/:id/redpacks', async (c) => {
  const { u, g } = await needMember(c, groupId(c))
  if (u.silenced) fail(403, '你在 linux.do 处于禁言状态')
  await needNotLimited(c, u, 'chat')
  const b = await boundedJson(c)
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(String(b.nonce ?? ''))) fail(400, '发送标识无效，请重新打开红包面板')
  if(b.provider==='coin52'){
    const id=await sha256(`redpack:${u.id}:${g.id}:${b.nonce}`)
    try{await createCoinPacket(c.env.DB,{id,uid:u.id,group:g.id,body:b,t:now()})}catch(e){if(e instanceof Error&&e.message.startsWith('D1_'))throw e;return fail(400,e instanceof Error?e.message:'D币红包创建失败')}
    const row=await c.env.DB.prepare(`${CHAT_SELECT} WHERE x.redpack_id=?`).bind(id).first<ChatRow>()
    if(!row)return fail(409,'红包正在同步，请重试确认')
    return c.json({message:(await decorateMsgs(c,[row]))[0]})
  }
  const isFree=b.provider==='free_guess',isLdc=b.provider==='ldc'||isFree
  let p: PacketConfig, external: ExternalPacket
  try {
    external = isLdc?{provider:'native',external_ref:'',external_kind:''}:cleanExternalPacket(b)
    p = isLdc?{secret:isFree?'无奖励猜词':'LDC红包奖励',mode:'open',game:isFree?'free_guess':'ldc',prompt:packetText(b.prompt).slice(0,120),phrase:'',post_id:null,image_index:0,mask:4,mask_bits:null,clue_key:null}:cleanPacket(b)
  } catch (e) { return fail(400, (e as Error).message) }
  let notifyAt = b.notify_at == null || b.notify_at === '' ? null : Number(b.notify_at)
  if (notifyAt !== null && (!Number.isSafeInteger(notifyAt) || notifyAt < now() + 60 || notifyAt > now() + 90 * 86400)) fail(400, '提醒时间需在1分钟后至90天内')
  const drawAt=Number(b.draw_at),drawKind=String(b.draw_kind)
  const draw=['hb','fish'].includes(external.provider)&&['lottery','timed_draw'].includes(drawKind)&&Number.isSafeInteger(drawAt)&&drawAt>now()-86400&&drawAt<=now()+90*86400
    ? {kind:drawKind,draw_at:drawAt,draw_deadline:external.provider==='fish',draw_complete:false}:null
  if(draw)notifyAt=drawAt
  const nativeDraw=isLdc&&!isFree&&b.draw_at!=null?{kind:'lottery',draw_at:Number(b.draw_at),draw_complete:false}:null
  const id = await sha256(`redpack:${u.id}:${g.id}:${b.nonce}`)
  const db = c.env.DB, t = now()
  const old = await db.prepare(`${CHAT_SELECT} WHERE x.redpack_id=?`).bind(id).first<ChatRow>()
  if (old) {
    if (old.deleted) fail(409, '这份红包已经撤回，请重新创建')
    return c.json({ message: (await decorateMsgs(c, [old]))[0] })
  }
  if(isLdc&&['guess','clues'].includes(String(b.mode))&&await db.prepare("SELECT 1 FROM guess_queue WHERE group_id=? AND state IN('queued','starting') LIMIT 1").bind(g.id).first())fail(409,'已有等候中的猜词，请选择参与排队或保存草稿')
  const nativeStatements=isLdc?await nativeCreation(c,b,u,id,g.id):external.provider==='native'&&b.ldc_reward===true?await puzzleRewardCreation(c,b,u,id):[]
  if (p.mode === 'image' && !await packetImage(c, p)) fail(400, '帖子不存在、已隐藏或所选内容不是图片')
  // 红包独立限制，避免关闭普通聊天频控时无限创建游戏。
  const rate = await db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE user_id=? AND redpack_id IS NOT NULL AND created_at>?')
    .bind(u.id, t - 60).first<{ n: number }>()
  if ((rate?.n ?? 0) >= 10) fail(429, '红包发得太快了，一分钟最多 10 个')
  const coverKey = b.cover_key == null || b.cover_key === '' ? null : String(b.cover_key)
  if (coverKey && !await db.prepare("SELECT 1 FROM uploads WHERE key=? AND user_id=? AND used=0 AND mime LIKE 'image/%'")
    .bind(coverKey,u.id).first()) fail(400,'封面已失效，请上传自己的图片')
  if (p.clue_key === coverKey && p.clue_key) fail(400, '线索图和封面不能使用同一文件')
  if (p.clue_key && !await db.prepare("SELECT 1 FROM uploads WHERE key=? AND user_id=? AND used=0 AND mime IN ('image/png','image/jpeg','image/webp') AND size<=3145728")
    .bind(p.clue_key,u.id).first()) fail(400,'图片线索已失效，请重新选择区域')
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,redpack_id,image_key)
      SELECT ?,?,'[红包]',?,?,?,? WHERE (? IS NULL OR EXISTS(SELECT 1 FROM uploads WHERE key=? AND user_id=? AND used=0 AND mime LIKE 'image/%'))
      AND (? IS NULL OR EXISTS(SELECT 1 FROM uploads WHERE key=? AND user_id=? AND used=0 AND mime IN ('image/png','image/jpeg','image/webp') AND size<=3145728))`)
      .bind(g.id, u.id, t, t, id, coverKey,coverKey,coverKey,u.id,p.clue_key,p.clue_key,u.id),
    db.prepare(`INSERT OR IGNORE INTO chat_redpacks(id,message_id,secret,mode,game,prompt,phrase,post_id,image_index,mask,clue_key,mask_bits,provider,external_ref,external_kind,notify_at,external_code,draw_data)
      SELECT ?,id,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM chat_messages WHERE redpack_id=? AND user_id=? AND group_id=? AND deleted=0`)
      .bind(id, p.secret, p.mode, p.game, p.prompt, p.phrase, p.post_id, p.image_index, p.mask, p.clue_key, p.mask_bits, external.provider, external.external_ref, external.external_kind, notifyAt,external.external_code||null,draw||nativeDraw?JSON.stringify(draw||nativeDraw):null, id, u.id, g.id),
    db.prepare(`UPDATE uploads SET used=1 WHERE key=? AND user_id=? AND used=0
      AND EXISTS(SELECT 1 FROM chat_messages WHERE redpack_id=? AND image_key=uploads.key)`)
      .bind(coverKey,u.id,id),
    db.prepare(`UPDATE uploads SET used=1 WHERE key=? AND user_id=? AND used=0
      AND EXISTS(SELECT 1 FROM chat_redpacks WHERE id=? AND clue_key=uploads.key)`)
      .bind(p.clue_key,u.id,id),
    ...nativeStatements,
  ]).catch(error=>{if(String(error).includes('fish_capacity_changed'))fail(409,'Fish 待发额度刚刚发生变化，请重新提交以核对最新余额；本次未创建红包');if(String(error).includes('dcoin_balance_insufficient'))fail(409,'D币余额不足，请调整金额或追加上限');if(String(error).includes('ldc_account_changed'))fail(409,'支付渠道状态已变化，请刷新后重试');if(String(error).includes('ldc_active_game'))fail(409,'群里已有进行中的猜词红包，请等猜中、结束或到期后再发起');if(/UNIQUE constraint failed: ldc_word_history\./.test(String(error)))fail(409,'自动题目与历史题库重复，请重新生成；未创建红包、未扣款');throw error})
  const m = (await db.prepare(`${CHAT_SELECT} WHERE x.redpack_id=?`).bind(id).first<ChatRow>())!
  if (!m) fail(400,'图片线索或封面已被使用，请重新上传')
  const [message] = await decorateMsgs(c, [m])
  return c.json({ message: { ...message, floor: m.seq } })
})
app.get('/api/chat/messages/:id/redpack', async (c) => {
  const { u, p } = await loadChatPacket(c)
  c.header('Cache-Control', 'no-store')
  return c.json({ packet: await chatPacketView(c, p, u.id) })
})
app.post('/api/chat/messages/:id/redpack/coin52-claim',async c=>{
  const {u,p,m}=await loadChatPacket(c)
  if(p.provider!=='coin52')return fail(400,'不是D币红包')
  try{await claimCoinPacket(c.env.DB,p.id,u.id,now())}catch(e){if(e instanceof Error&&e.message.startsWith('D1_'))throw e;return fail(409,e instanceof Error?e.message:'领取失败，请重试')}
  return c.json({packet:await chatPacketView(c,p,u.id),message:(await decorateMsgs(c,[m]))[0]})
})
// 用户主动打开红包袋时，每次只整理少量旧分享；不会访问外站或领取积分。
app.post('/api/chat/groups/:id/redpacks/import', async (c) => {
  const { g } = await needMember(c, groupId(c))
  const b = await jsonBody<{ before?: number; scope?: string }>(c)
  const before = intIn(b.before, 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  const start = b.scope === 'all' ? 0 : Math.floor((now() + 28800) / 86400) * 86400 - 28800
  // Bound the index range before inspecting message text; sparse shares must not scan the whole group.
  const rows = (await c.env.DB.prepare(`SELECT id,body,created_at,deleted,redpack_id,system_kind FROM chat_messages
    WHERE group_id=? AND id<? AND id>=${g.history_floor} AND created_at>=? ORDER BY id DESC LIMIT 100`).bind(g.id, before,g.joined_at).all<{
      id: number; body: string; created_at: number; deleted: number; redpack_id: string | null; system_kind: string | null
    }>()).results
  let recognized = 0
  let next: number | null = rows.length === 100 ? rows[99].id : null
  for (const [index, row] of rows.entries()) {
    if (row.created_at < start || row.deleted || row.redpack_id || row.system_kind) continue
    const shared = sharedPacket(row.body)
    if (shared) { await c.env.DB.batch(sharedPacketStatements(c.env.DB, row.id, row.body, shared)); recognized++ }
    if (recognized === 10) {
      next = index < rows.length - 1 || rows.length === 100 ? row.id : null
      break
    }
  }
  c.header('Cache-Control', 'no-store')
  return c.json({ recognized, next })
})
app.get('/api/chat/groups/:id/redpacks/available', async (c) => {
  const { u, g } = await needMember(c, groupId(c))
  const current=now()
  const dayStart=Math.max(g.joined_at,Math.floor((current+28800)/86400)*86400-28800)
  const fresh=current-600
  // 只在进入群聊、红包状态变化或页面重新可见时查询；不加入三秒消息轮询。
  const available=await c.env.DB.prepare(`SELECT p.id FROM chat_redpacks p CROSS JOIN chat_messages x ON x.id=p.message_id
    LEFT JOIN chat_redpack_opens o ON o.packet_id=p.id AND o.user_id=?
    LEFT JOIN ldc_packets lp ON lp.packet_id=p.id
    LEFT JOIN ldc_awards la ON la.packet_id=p.id AND la.recipient_id=?
    LEFT JOIN chat_redpack_external_views v ON v.packet_id=p.id AND v.user_id=?
    WHERE x.group_id=? AND x.user_id<>? AND x.id>=${g.history_floor} AND x.created_at>=? AND x.deleted=0 AND (
      (p.provider='coin52' AND EXISTS(SELECT 1 FROM coin52_packets cp WHERE cp.packet_id=p.id AND cp.remaining_count>0 AND cp.refunded_at IS NULL AND cp.expires_at>unixepoch()) AND NOT EXISTS(SELECT 1 FROM coin52_packet_slots cs WHERE cs.packet_id=p.id AND cs.recipient_id=?1)) OR
      (p.provider='native' AND p.game NOT IN ('ldc','free_guess') AND o.solved_at IS NULL) OR
      (p.game='ldc' AND lp.mode IN ('fixed','random') AND lp.state='open' AND lp.ends_at>? AND la.id IS NULL
        AND EXISTS(SELECT 1 FROM ldc_awards slots WHERE slots.packet_id=p.id AND slots.state='ready')) OR
      (p.provider<>'native' AND v.data IS NOT NULL AND v.synced_at>=? AND json_extract(v.data,'$.state')='active'
        AND COALESCE(json_extract(v.data,'$.claimed'),0)=0 AND json_extract(v.data,'$.blocked') IS NULL
        AND (json_extract(v.data,'$.remaining') IS NULL OR json_extract(v.data,'$.remaining')>0)
        AND (json_extract(v.data,'$.total') IS NULL OR json_extract(v.data,'$.claimed_count') IS NULL OR json_extract(v.data,'$.claimed_count')<json_extract(v.data,'$.total'))
        AND (COALESCE(json_extract(v.data,'$.expires_at'),0)=0 OR json_extract(v.data,'$.expires_at')>?))
    ) LIMIT 1`).bind(u.id,u.id,u.id,g.id,u.id,dayStart,current,fresh,current).first<{id:string}>()
  c.header('Cache-Control','no-store')
  return c.json({has_available:!!available})
})
app.get('/api/chat/groups/:id/redpacks', async (c) => {
  const { u, g } = await needMember(c, groupId(c))
  const before = intIn(c.req.query('before'), 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  const view = c.req.query('view') || 'all'
  const current=now()
  const todayStart=Math.floor((current+28800)/86400)*86400-28800
  // 往日仅归档展示，不修改红包本身的领取或开奖状态。
  const dayStart=Math.max(g.joined_at,view==='history'?0:todayStart)
  const terminal = `(x.deleted=1 OR (p.provider='coin52' AND (EXISTS(SELECT 1 FROM coin52_packets cp WHERE cp.packet_id=p.id AND (cp.remaining_count=0 OR cp.expires_at<=${current})) OR EXISTS(SELECT 1 FROM coin52_packet_slots cs WHERE cs.packet_id=p.id AND cs.recipient_id=?1))) OR (p.provider='native' AND o.solved_at IS NOT NULL) OR
    (p.game='free_guess' AND (fp.state='closed' OR fp.ends_at<=${current} OR fp.winner_id IS NOT NULL)) OR
    (p.game='ldc' AND (lp.state='closed' OR lp.ends_at<=${current} OR la.recipient_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM ldc_awards slots WHERE slots.packet_id=p.id AND slots.state='ready'))) OR
    (v.data IS NOT NULL AND (json_extract(v.data,'$.claimed')=1 OR json_extract(v.data,'$.state') IN ('exhausted','expired','cancelled','drawn','not_won') OR
      (json_extract(v.data,'$.state')='active' AND (
        COALESCE(json_extract(v.data,'$.remaining'),-1)=0 OR
        (json_extract(v.data,'$.total') IS NOT NULL AND json_extract(v.data,'$.claimed_count')>=json_extract(v.data,'$.total')) OR
        (COALESCE(json_extract(v.data,'$.kind'),'unknown') NOT IN ('timed_draw','lottery') AND COALESCE(json_extract(v.data,'$.expires_at'),0)>0 AND json_extract(v.data,'$.expires_at')<=${current}))))))`
  const puzzle = `(p.game='free_guess' OR (p.game='ldc' AND lp.mode IN ('guess','clues')) OR
    (p.provider='native' AND p.mode IN ('phrase','cipher','image')))`
  const externalReady=`(p.provider<>'native' AND v.data IS NOT NULL AND v.synced_at>=${current-600}
    AND json_extract(v.data,'$.state')='active' AND COALESCE(json_extract(v.data,'$.claimed'),0)=0
    AND json_extract(v.data,'$.blocked') IS NULL
    AND (json_extract(v.data,'$.remaining') IS NULL OR json_extract(v.data,'$.remaining')>0)
    AND (json_extract(v.data,'$.total') IS NULL OR json_extract(v.data,'$.claimed_count') IS NULL OR json_extract(v.data,'$.claimed_count')<json_extract(v.data,'$.total'))
    AND (COALESCE(json_extract(v.data,'$.expires_at'),0)=0 OR json_extract(v.data,'$.expires_at')>${current}))`
  const nativeReady=`((p.provider='native' AND p.game NOT IN ('ldc','free_guess') AND o.solved_at IS NULL) OR
    (p.game='ldc' AND lp.mode IN ('fixed','random') AND lp.state='open' AND lp.ends_at>${current} AND la.id IS NULL
      AND EXISTS(SELECT 1 FROM ldc_awards slots WHERE slots.packet_id=p.id AND slots.state='ready')))`
  const coinReady=`(p.provider='coin52' AND EXISTS(SELECT 1 FROM coin52_packets cp WHERE cp.packet_id=p.id AND cp.remaining_count>0 AND cp.refunded_at IS NULL AND cp.expires_at>${current}) AND NOT EXISTS(SELECT 1 FROM coin52_packet_slots cs WHERE cs.packet_id=p.id AND cs.recipient_id=?1))`
  const ready=`(${nativeReady} OR ${externalReady} OR ${coinReady})`
  const other='x.user_id<>?1'
  const category = view==='mine' ? 'x.user_id=?1' : view==='puzzle' ? `${other} AND NOT ${terminal} AND ${puzzle}` : view==='pending'
    ? `${other} AND NOT ${terminal} AND NOT ${puzzle} AND ${ready}`
    : view==='check' ? `${other} AND p.provider NOT IN ('native','coin52') AND NOT ${terminal} AND NOT ${puzzle} AND NOT ${externalReady}`
    : view==='history' ? `(x.created_at<${todayStart} OR (${other} AND ${terminal}))` : '1=1'
  const rows = (await c.env.DB.prepare(`${CHAT_PACKET_SELECT}
    LEFT JOIN chat_redpack_opens o ON o.packet_id=p.id AND o.user_id=?
    LEFT JOIN chat_redpack_external_views v ON v.packet_id=p.id AND v.user_id=?
    LEFT JOIN ldc_packets lp ON lp.packet_id=p.id
       LEFT JOIN guess_free_rounds fp ON fp.packet_id=p.id
    LEFT JOIN ldc_awards la ON la.packet_id=p.id AND la.recipient_id=?
    WHERE x.group_id=? AND x.id<? AND x.id>=${g.history_floor} AND x.created_at>=? AND ${category} ORDER BY x.id DESC LIMIT 31`)
    .bind(u.id,u.id,u.id,g.id,before,dayStart).all<ChatRow>()).results
  const more = rows.length > 30
  c.header('Cache-Control','no-store')
  return c.json({ items: await decorateMsgs(c,rows.slice(0,30)), more, next: more ? rows[29].id : null })
})
app.get('/api/chat/groups/:id/redpacks/matches', async (c) => {
  const { u, g } = await needMember(c,groupId(c))
  const mid = intIn(c.req.query('message_id'),1,Number.MAX_SAFE_INTEGER,0)
  const said = await c.env.DB.prepare(`SELECT body FROM chat_messages WHERE id=? AND group_id=? AND user_id=? AND deleted=0
    AND redpack_id IS NULL AND system_kind IS NULL AND id>=${g.history_floor} AND created_at>=?`).bind(mid,g.id,u.id,g.joined_at).first<{body:string}>()
  if (!said) fail(403,'只能查询自己在本群发送的有效口令')
  const rows = (await c.env.DB.prepare(`${CHAT_PACKET_SELECT}
    LEFT JOIN chat_redpack_opens o ON o.packet_id=p.id AND o.user_id=?
    WHERE x.group_id=? AND x.id<? AND x.id>=${g.history_floor} AND x.deleted=0 AND x.user_id<>? AND p.mode='phrase' AND p.phrase=? AND x.created_at>=?
    AND (p.provider<>'native' OR o.solved_at IS NULL) ORDER BY x.id DESC LIMIT 10`)
    .bind(u.id,g.id,mid,u.id,said!.body,g.joined_at).all<ChatRow>()).results
  c.header('Cache-Control','no-store')
  return c.json({ items: await decorateMsgs(c,rows) })
})
app.post('/api/chat/messages/:id/redpack/sync', async (c) => {
  const { u,p,m } = await loadChatPacket(c)
  if (p.provider === 'native'||p.provider==='coin52') fail(400,'站内红包无需同步平台领取状态')
  const b = await jsonBody<Record<string,unknown>>(c)
  if (!['active','exhausted','expired','cancelled','drawn','unmatched','registered','drawing','not_won','payment_pending','simulation','draft','unconfirmed'].includes(String(b.state))) fail(400,'红包平台状态无法识别')
  const data = cleanPacketSnapshot(b)
  // 个人查询快照；不作为群内共享余量或支付凭证，不能影响任何人的领取授权。
  // 只有原发包/分享者可同步群内摘要。普通成员的回报仅存在其个人查询中。
  // 连接器不是平台签名，不能让任意成员占用一次性群通知或改写他人的红包时间。
  const known=p.draw_data?JSON.parse(p.draw_data):null
  const candidate=u.id===m.user_id&&['hb','fish'].includes(p.provider)?publicPacketDraw(data):null
  const draw=candidate&&candidate.draw_at>now()-90*86400&&candidate.draw_at<=now()+90*86400&&
    (!known||(candidate.kind===known.kind&&candidate.draw_at===known.draw_at))?candidate:null
  await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO chat_redpack_external_views(packet_id,user_id,data,synced_at) VALUES(?,?,?,?)
    ON CONFLICT(packet_id,user_id) DO UPDATE SET data=excluded.data,synced_at=excluded.synced_at`)
    .bind(p.id,u.id,JSON.stringify(data),now()),...(draw?drawSyncStatements(c.env.DB,p,draw,u.name||u.username||String(u.id),now()):[])])
  if(draw)p.draw_data=JSON.stringify(draw)
  if(data.claimed)await c.env.DB.prepare('INSERT OR IGNORE INTO chat_redpack_successes(packet_id,user_id,created_at) VALUES(?,?,?)').bind(p.id,u.id,now()).run()
  return c.json({ packet: await chatPacketView(c,p,u.id), message:(await decorateMsgs(c,[m]))[0] })
})
// 在线连接器到点后最多一次读取；多窗口共用数据库租约，不另加轮询或Cron。
app.post('/api/chat/messages/:id/redpack/draw-lease',async c=>{
  const {u,p,m}=await loadChatPacket(c),at=now()
  if(u.id!==m.user_id||!['hb','fish'].includes(p.provider))return c.json({acquired:false})
  const lease=await c.env.DB.prepare(`UPDATE chat_redpacks SET draw_lease_until=?,draw_attempts=draw_attempts+1
    WHERE id=? AND draw_data IS NOT NULL AND json_extract(draw_data,'$.draw_at')<=?
    AND draw_announced_at IS NULL AND COALESCE(draw_lease_until,0)<=? AND draw_attempts<12 RETURNING id`)
    .bind(at+60,p.id,at,at).first()
  return c.json(lease?{acquired:true,packet:await chatPacketView(c,p,u.id)}:{acquired:false})
})
app.post('/api/chat/messages/:id/redpack/open', async (c) => {
  const { u, m, p } = await loadChatPacket(c)
  if(['ldc','free_guess','coin52'].includes(p.game))fail(409,'请通过红包领取或猜词专区参与')
  const b = await jsonBody<{ answer?: unknown }>(c)
  c.header('Cache-Control', 'no-store')
  const db = c.env.DB, t = now()
  const existing = await db.prepare('SELECT solved_at FROM chat_redpack_opens WHERE packet_id=? AND user_id=?').bind(p.id, u.id).first<{ solved_at: number | null }>()
  if (!existing?.solved_at) {
    if (p.mode === 'image' && !await packetImage(c, p)) fail(404, '关联帖子不可用，这个红包暂时无法解锁')
    const attempt = await db.prepare(`INSERT INTO chat_redpack_opens(packet_id,user_id,attempts,window_at,window_n)
      SELECT ?,?,1,?,1 WHERE EXISTS(SELECT 1 FROM chat_messages WHERE id=? AND deleted=0)
      ON CONFLICT(packet_id,user_id) DO UPDATE SET attempts=attempts+1,
        window_n=CASE WHEN window_at<=? THEN 1 ELSE window_n+1 END,
        window_at=CASE WHEN window_at<=? THEN ? ELSE window_at END
      WHERE solved_at IS NULL AND (window_at<=? OR window_n<?)
      RETURNING attempts`).bind(p.id, u.id, t, m.id, t - 60, t - 60, t, t - 60, p.provider === 'native' && p.mode !== 'open' ? 5 : 20).first()
    // 并发的另一请求可能已经解锁；读取最新状态后再判定频控。
    const won = await db.prepare('SELECT solved_at FROM chat_redpack_opens WHERE packet_id=? AND user_id=?').bind(p.id, u.id).first<{ solved_at: number | null }>()
    if (!attempt && !won?.solved_at) { c.header('Retry-After', '60'); fail(429, '这一分钟尝试太多了，请稍后再试') }
    if (!won?.solved_at) {
      if (p.mode === 'phrase') {
        const said = await db.prepare(`SELECT 1 FROM chat_messages WHERE group_id=? AND user_id=? AND id>? AND deleted=0 AND redpack_id IS NULL AND system_kind IS NULL AND body=? LIMIT 1`)
          .bind(m.group_id, u.id, m.id, p.phrase).first()
        if (!said) fail(400, '先在这个群里亲自发送上面的完整口令，再回来开包')
      } else if (p.mode !== 'open' && packetText(b.answer) !== p.secret) fail(400, '还差一点，谜底不对。再看看线索！')
      await db.batch([
        db.prepare(`UPDATE chat_redpack_opens SET solved_at=COALESCE(solved_at,?) WHERE packet_id=? AND user_id=?
          AND EXISTS(SELECT 1 FROM chat_messages WHERE id=? AND deleted=0)`).bind(t, p.id, u.id, m.id),
        db.prepare('UPDATE chat_messages SET updated_at=? WHERE id=? AND deleted=0').bind(t, m.id),
        db.prepare(`INSERT OR IGNORE INTO chat_redpack_successes(packet_id,user_id,created_at)
          SELECT packet_id,user_id,solved_at FROM chat_redpack_opens WHERE packet_id=? AND user_id=? AND solved_at IS NOT NULL AND ?='native'
          AND EXISTS(SELECT 1 FROM chat_messages WHERE id=? AND deleted=0)`).bind(p.id,u.id,p.provider,m.id),
      ])
    }
  }
  // 撤回与开包并发时，以最后一次读取的消息状态为准。
  const fresh = await db.prepare(`${CHAT_SELECT} WHERE x.id=? AND x.deleted=0`).bind(m.id).first<ChatRow>()
  if (!fresh) fail(404, '红包已撤回')
  let rewardError=''
  if(p.provider==='native'){
    const reward=await db.prepare('SELECT * FROM ldc_packets WHERE packet_id=?').bind(p.id).first<NativePacket>()
    if(reward&&u.id!==reward.owner_id)try{await claimNative(c,reward,u,undefined)}catch(error){rewardError=String((error as Error).message||'LDC 发放尚未完成').slice(0,180);if(Number((error as {status?:number}).status||0)>=500||!(error as {status?:number}).status)console.error('puzzle_reward_auto_claim_failed',{packet_id:p.id})}
  }
  const packet=await chatPacketView(c,p,u.id)
  return c.json({packet:rewardError?{...packet,reward_error:rewardError}:packet,message:(await decorateMsgs(c,[fresh!]))[0]})
})

// 群聊消息里的图一键转成帖子：图复制一份到 m/（撤回消息会删掉聊天里的文件），文字当描述
app.post('/api/chat/messages/:id/to-post', async (c) => {
  const { u: me, m } = await chatMessage(c)
  if (m.deleted) fail(400, '消息已撤回')
  await needNotLimited(c, me, 'post')
  if (m.meme_id) {
    const ok = await c.env.DB.prepare('SELECT 1 FROM memes WHERE id = ? AND hidden = 0').bind(m.meme_id).first()
    if (ok) return c.json({ id: m.meme_id, existed: true })
  }
  const src: Media[] = (msgMedia(m) ?? (m.image_key ? [{ k: m.image_key, w: m.width, h: m.height }] : []))
    .filter((x) => x.kind !== 'f').map(({ b: _b, c: _c, ...x }) => x)
  const me2 = await postGate(c)
  const f = await jsonBody<{ tags?: unknown; as?: unknown; social_index?: unknown }>(c)
  // 发帖人：默认是群里说这句话的人（as: 'author'），也可以记在转帖的自己名下（as: 'me'）
  const author = f.as === 'me' || m.user_id === me2.id ? null
    : await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(m.user_id).first<User>()
  const u = author ?? me2
  if(!src.length){
    const links=socialLinks(m.body||'')
    if(f.social_index!==undefined&&(typeof f.social_index!=='number'||!Number.isInteger(f.social_index)||f.social_index<0||f.social_index>=links.length))fail(400,'分享内容编号无效')
    const link=f.social_index===undefined?links.find(x=>canSocialPost(x.provider)):links[f.social_index as number]
    if(!link||!canSocialPost(link.provider))fail(400,'这条消息没有可转发的内容')
    const data=await cachedSocialPreview(c,me2,link!)
    if(!data.available)fail(503,'暂未取得公开正文和媒体，请稍后重试；尚未发布')
    const gallery=socialPostGallery(data)
    const content=socialCaption(data.description).slice(0,10000)
    // 批次内按消息原值比较并发布，重复点击只取得已有帖子；仅保存正文和外链，不写R2。
    const out=await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO memes(title,content,image_url,width,height,gallery,source_url,author_id,author_name,kind,spoiler,created_at,ai_off)
        SELECT '',?,?,?,?,?,?,?,?,?,?,?,1 WHERE EXISTS(SELECT 1 FROM chat_messages WHERE id=? AND deleted=0 AND meme_id IS ?)`)
        .bind(content,gallery[0]?.u||null,gallery[0]?.w||null,gallery[0]?.h||null,gallery.length?JSON.stringify(gallery):null,link!.url,u.id,u.username,gallery.length?'image':'text',data.sensitive?1:0,now(),m.id,m.meme_id??null),
      c.env.DB.prepare('UPDATE chat_messages SET meme_id=last_insert_rowid(),updated_at=? WHERE id=? AND changes()=1').bind(now(),m.id),
      c.env.DB.prepare("UPDATE memes SET image_url=replace(image_url,'__MEME_ID__',id),gallery=replace(gallery,'__MEME_ID__',id) WHERE id=last_insert_rowid() AND changes()=1"),
      c.env.DB.prepare('SELECT meme_id FROM chat_messages WHERE id=?').bind(m.id),
    ])
    const id=Number((out[3].results[0] as {meme_id:number}|undefined)?.meme_id)
    if(!id)fail(409,'消息状态已变化，请刷新后重试')
    if(out[0].meta.changes){const tags=parseTags(f.tags);if(tags.length)await c.env.DB.batch(tags.map(tag=>c.env.DB.prepare('INSERT OR IGNORE INTO meme_tags VALUES (?,?)').bind(id,tag)))}
    return c.json({id,existed:!out[0].meta.changes,external:true})
  }
  try{
    const copied=new Map<string,string>(),at=now(),window=Math.floor(at/(12*3600))
    const copy = async (key?: string) => {
      if (!key) return undefined
      if(copied.has(key))return copied.get(key)!
      const obj = await c.env.BUCKET.get(key)
      if (!obj) fail(404, '图片已经不在了')
      // 12小时时间窗短于回执有效期；同成员重试复用副本，换窗后失败旧副本按原任务清理。
      const nonce='chat-post-'+await sha256(JSON.stringify([m.id,m.meme_id??null,key,window]))
      const stored=await storeUpload(c.env.DB,c.env.BUCKET,{uid:me2.id,nonce,bytes:new Uint8Array(await obj!.arrayBuffer()),
        mime:obj!.httpMetadata?.contentType||'application/octet-stream',ext:key.split('.').pop()||'bin',purpose:'meme',asFile:false,limited:rateOn(c)&&me2.is_admin!==1,t:at})
      copied.set(key,stored.key)
      return stored.key
    }
    const items: Media[] = []
    for (const it of src.slice(0, MAX_ITEMS)) {
      items.push({ ...it, k: (await copy(it.k))!, p: await copy(it.p), o: await copy(it.o) })
    }
    const content = chatPreview(m.body, 2000)
    const id = await insertMeme(c, u, { title: '', content, items, kind: 'image', spoiler: false, tags: parseTags(f.tags) },mediaKeys(items),{message:m,uploaderId:me2.id})
    return c.json({ id })
  }catch(error){
    // 另一请求可能已完成；包括复制回执已消费或事务响应丢失，均先找真实已关联结果。
    const fresh=await c.env.DB.prepare(`SELECT x.deleted,x.meme_id,x.body,x.image_key,x.media,p.id AS live_id
      FROM chat_messages x LEFT JOIN memes p ON p.id=x.meme_id AND p.hidden=0 WHERE x.id=?`).bind(m.id)
      .first<{deleted:number;meme_id:number|null;body:string;image_key:string|null;media:string|null;live_id:number|null}>().catch(()=>null)
    if(fresh?.live_id)return c.json({id:fresh.live_id,existed:true})
    if(fresh&&(fresh.deleted||fresh.meme_id!==(m.meme_id??null)||fresh.body!==m.body||fresh.image_key!==m.image_key||fresh.media!==m.media))fail(409,'消息状态已变化，请刷新后重试')
    if((error as {cause?:{code?:string}}).cause?.code==='upload_busy')fail(409,'转帖正在处理中，请稍后查看','chat_post_busy')
    throw error
  }
})

// 红包发出后不可撤回，领取和对账记录持续保留。
app.delete('/api/chat/messages/:id', async (c) => {
  const { u, m } = await chatMessage(c)
  if (m.deleted) return c.json({ ok: true })
  if (u.id !== m.user_id && !isChatAdmin(u)) fail(403, '没有权限')
  if (m.redpack_id || sharedPacket(m.body) || await c.env.DB.prepare('SELECT 1 FROM chat_redpacks WHERE message_id=?').bind(m.id).first()) fail(409, '红包发出后不能撤回，领取和发放记录将保留')
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE chat_messages SET deleted = 1, body = '', updated_at = ? WHERE id = ?").bind(now(), m.id),
    c.env.DB.prepare('DELETE FROM chat_reactions WHERE message_id = ?').bind(m.id),
    c.env.DB.prepare('DELETE FROM chat_boosts WHERE message_id = ?').bind(m.id),
    c.env.DB.prepare('UPDATE road_items SET source_hidden = 1, updated_at = ? WHERE source_msg_id = ?').bind(now(), m.id),
    c.env.DB.prepare("UPDATE chat_title_raffles SET status='cancelled' WHERE packet_id=? AND status='open'").bind(m.redpack_id),
  ])
  const keys = [...new Set([...(m.image_key ? [m.image_key] : []), ...mediaKeys(msgMedia(m) ?? [])])]
  if (keys.length) await c.env.BUCKET.delete(keys)
  return c.json({ ok: true })
})

// 编辑：只能改自己的文字，图不动
app.patch('/api/chat/messages/:id', async (c) => {
  const { u, m } = await chatMessage(c)
  if (m.deleted) fail(400, '消息已撤回')
  if (m.redpack_id || sharedPacket(m.body) || await c.env.DB.prepare('SELECT 1 FROM chat_redpacks WHERE message_id=?').bind(m.id).first()) fail(409, '红包发出后不能编辑或撤回')
  if (u.id !== m.user_id) fail(403, '只能改自己的消息')
  const body = String((await jsonBody<{ body?: string }>(c)).body ?? '').replace(/\r/g, '').trim().slice(0, CHAT_BODY_MAX)
  if (!body && !m.image_key) fail(400, '说点什么吧')
  const t = now()
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE chat_messages SET body = ?, edited_at = ?, updated_at = ? WHERE id = ? AND deleted = 0').bind(body, t, t, m.id),
    c.env.DB.prepare("DELETE FROM chat_boosts WHERE message_id=? AND ai_status<>''").bind(m.id),
    ...chatRoadStatements(c.env.DB, m.id, body, chatRoadAttachments(m), t),
    ...sharedPacketStatements(c.env.DB, m.id, body, sharedPacket(body)),
  ])
  const [message] = await decorateMsgs(c, [{ ...m, body, edited_at: t, updated_at: t }])
  return c.json({ message: { ...message, floor: m.seq } })
})

// 反向引用：回复了这条的消息（按时间，最多 100 条），前端列出回复人 + 摘要，点了跳过去
app.get('/api/chat/messages/:id/replies', async (c) => {
  const { m,g } = await chatMessage(c)
  const { results } = await c.env.DB.prepare(
    `SELECT x.id, x.body, x.image_key, x.media, x.created_at AS at, u.username, u.name, u.avatar FROM chat_messages x
     LEFT JOIN users u ON u.id = x.user_id
     WHERE x.reply_to = ? AND x.group_id = ? AND x.created_at>=? AND x.deleted = 0 ORDER BY x.id LIMIT 100`,
  ).bind(m.id, m.group_id,g.joined_at).all<{ id: number; body: string; image_key: string | null; media: string | null; at: number; username: string | null; name: string | null; avatar: string | null }>()
  return c.json({
    items: results.map((r) => ({
      id: r.id, at: r.at, username: r.username ?? '佚名', name: r.name, avatar: r.avatar,
      text: chatPreview(r.body ?? '', 60), image: !!(r.image_key || r.media),
    })),
  })
})

// 谁点的表情：不带 emoji 就是全部，按表情分组、每组按时间
app.get('/api/chat/messages/:id/reactions', async (c) => {
  const { m } = await chatMessage(c)
  const { results } = await c.env.DB.prepare(
    `SELECT r.emoji, r.created_at AS at, u.username, u.name, u.avatar FROM chat_reactions r LEFT JOIN users u ON u.id = r.user_id
     WHERE r.message_id = ? ORDER BY r.created_at LIMIT 500`,
  ).bind(m.id).all()
  return c.json({ items: results })
})

app.post('/api/chat/messages/:id/reactions', async (c) => {
  const { u, m } = await chatMessage(c)
  if (m.deleted) fail(400, '消息已撤回')
  await needNotLimited(c, u, 'react')
  const emoji = String((await jsonBody<{ emoji?: string }>(c)).emoji ?? '')
  if (!isReaction(emoji)) fail(400, '不支持这个表情')
  const db = c.env.DB
  const had = await db.prepare('SELECT 1 FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').bind(m.id, u.id, emoji).first()
  if (had) {
    await db.prepare('DELETE FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').bind(m.id, u.id, emoji).run()
  } else {
    const n = await db.prepare('SELECT COUNT(*) AS n FROM chat_reactions WHERE message_id = ? AND user_id = ?').bind(m.id, u.id).first<{ n: number }>()
    if ((n?.n ?? 0) >= 5) fail(400, '每条消息最多点 5 个表情')
    await db.prepare('INSERT INTO chat_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').bind(m.id, u.id, emoji, now()).run()
  }
  await db.prepare('UPDATE chat_messages SET updated_at = ? WHERE id = ?').bind(now(), m.id).run()
  const [message] = await decorateMsgs(c, [{ ...m, updated_at: now() }])
  return c.json({ message })
})

// 短句回应：带 text 是设成这句（改也是这个），text 为空就是撤掉自己那句
app.post('/api/chat/messages/:id/boosts', async (c) => {
  const { u, m } = await chatMessage(c)
  if (m.deleted) fail(400, '消息已撤回')
  await needNotLimited(c, u, 'react')
  const text = String((await jsonBody<{ text?: string }>(c)).text ?? '').replace(/\s+/g, ' ').trim()
  const db = c.env.DB
  const t = now()
  if (!text) await db.prepare('DELETE FROM chat_boosts WHERE message_id = ? AND user_id = ?').bind(m.id, u.id).run()
  else {
    if ([...text].length > BOOST_MAX) fail(400, `最多 ${BOOST_MAX} 个字`)
    await db.prepare(
      `INSERT INTO chat_boosts (message_id, user_id, text, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (message_id, user_id) DO UPDATE SET text = excluded.text, created_at = excluded.created_at`,
    ).bind(m.id, u.id, text, t).run()
  }
  await db.prepare('UPDATE chat_messages SET updated_at = ? WHERE id = ?').bind(t, m.id).run()
  const [message] = await decorateMsgs(c, [{ ...m, updated_at: t }])
  return c.json({ message: { ...message, floor: m.seq } })
})

// @ 已读刷新：前端隔一会儿问一下自己发的、还有人没读的那几条
app.get('/api/chat/groups/:id/reads', async (c) => {
  const { g } = await needMember(c, groupId(c))
  const ids = String(c.req.query('ids') ?? '').split(',').map((x) => intIn(x, 1, Number.MAX_SAFE_INTEGER, 0)).filter(Boolean).slice(0, 100)
  if (!ids.length) return c.json({ reads: {} })
  const { results } = await c.env.DB.prepare('SELECT id, group_id, body, deleted FROM chat_messages WHERE group_id = ? AND id IN (SELECT value FROM json_each(?)) AND created_at>=?')
    .bind(g.id, JSON.stringify(ids),g.joined_at).all<{ id: number; group_id: number; body: string; deleted: number }>()
  return c.json({ reads: Object.fromEntries(await atReads(c, results)) })
})

// 免打扰：这个群的新消息不计未读、不亮红点；@ 我的照常提醒
app.put('/api/chat/groups/:id/mute', async (c) => {
  const { u, g } = await needMember(c, groupId(c))
  const muted = !!(await jsonBody<{ muted?: boolean }>(c)).muted
  await c.env.DB.prepare('UPDATE chat_members SET muted = ? WHERE group_id = ? AND user_id = ?').bind(muted ? 1 : 0, g.id, u.id).run()
  return c.json({ ok: true, muted })
})

app.post('/api/chat/groups/:id/read', async (c) => {
  const { u, g } = await needMember(c, groupId(c))
  const id = intIn((await jsonBody<{ id?: number }>(c)).id, 0, Number.MAX_SAFE_INTEGER, 0)
  await c.env.DB.prepare('UPDATE chat_members SET away_from = CASE WHEN last_read_at <= ?1 - 600 THEN last_read ELSE away_from END, last_read_at = MAX(last_read_at, ?1), last_read = MAX(last_read, ?2) WHERE group_id = ?3 AND user_id = ?4').bind(now(), id, g.id, u.id).run()
  return c.json({ ok: true })
})

// ---------- 解密 ----------

// 连环解密的一层。没有层的老谜题，用 puzzles 上的答案当唯一一层口令
type Layer = { idx: number; kind: string; prompt: string; data: string; answers: string; note: string }
const LAYER_KINDS = ['pass', 'cipher', 'quiz', 'image', 'stego'] as const
const MAX_LAYERS = 5
async function loadLayers(c: C, pz: Puzzle): Promise<Layer[]> {
  const { results } = await c.env.DB.prepare('SELECT * FROM puzzle_layers WHERE puzzle_id = ? ORDER BY idx').bind(pz.id).all<Layer>()
  return results.length ? results : [{ idx: 0, kind: 'pass', prompt: pz.hint, data: '{}', answers: JSON.stringify([pz.answer_hash]), note: '' }]
}
const layerPublic = (l: Layer) => {
  let data: Record<string, unknown> = {}
  try { data = JSON.parse(l.data) } catch {}
  return { idx: l.idx, kind: l.kind, prompt: l.prompt, data }
}
// 出题时每层的公开内容，按字段截断；图片只认本站 /img/ 地址
const IMG_RE = /^\/img\/[mc]\/[\w/.-]{1,80}$/
function cleanLayerData(raw: unknown) {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const s = (v: unknown, n: number) => String(v ?? '').slice(0, n)
  const out: Record<string, unknown> = {}
  if (d.text) out.text = s(d.text, 4000)
  if (d.algo) out.algo = s(d.algo, 20)
  if (d.key_hint) out.key_hint = s(d.key_hint, 100)
  if (d.subject) out.subject = s(d.subject, 10)
  if (d.img && IMG_RE.test(String(d.img))) out.img = String(d.img)
  if (d.pw) out.pw = true
  if (Array.isArray(d.options)) out.options = d.options.slice(0, 6).map((o) => s(o, 60)).filter(Boolean)
  return out
}

async function puzzleView(c: C, pz: Puzzle) {
  const u = c.get('user')
  const [mine, winners, codesLeft, layers] = await Promise.all([
    u ? c.env.DB.prepare('SELECT attempts, solved_at, code_id, layer FROM puzzle_attempts WHERE puzzle_id = ? AND user_id = ?')
      .bind(pz.id, u.id).first<{ attempts: number; solved_at: number | null; code_id: number | null; layer: number }>() : null,
    c.env.DB.prepare(
      `SELECT u.username, u.avatar, a.solved_at FROM puzzle_attempts a JOIN users u ON u.id = a.user_id
       WHERE a.puzzle_id = ? AND a.solved_at IS NOT NULL ORDER BY a.solved_at ASC LIMIT 30`,
    ).bind(pz.id).all<{ username: string; avatar: string | null; solved_at: number }>(),
    pz.reward_type === 'codes'
      ? c.env.DB.prepare('SELECT COUNT(*) AS n FROM puzzle_codes WHERE puzzle_id = ? AND claimed_by IS NULL')
        .bind(pz.id).first<{ n: number }>()
      : null,
    loadLayers(c, pz),
  ])
  const isOwner = canManage(u, pz.creator_id)
  const solved = !!mine?.solved_at
  const cur = Math.min(mine?.layer ?? 0, layers.length - 1)
  let reward: string | null = null
  if (solved) {
    reward = pz.reward_type === 'codes' && mine?.code_id
      ? (await c.env.DB.prepare('SELECT code FROM puzzle_codes WHERE id = ?').bind(mine.code_id).first<{ code: string }>())?.code ?? null
      : pz.reward_text
  } else if (isOwner && pz.reward_type !== 'codes') {
    reward = pz.reward_text
  }
  const full = pz.max_winners > 0 && pz.winners_count >= pz.max_winners
  const ended = !!pz.ends_at && pz.ends_at < now()
  return {
    id: pz.id, hint: pz.hint, reward_kind: pz.reward_kind, reward_type: pz.reward_type,
    min_trust_level: pz.min_trust_level, max_attempts: pz.max_attempts, max_winners: pz.max_winners,
    winners_count: pz.winners_count, ends_at: pz.ends_at, codes_left: codesLeft?.n ?? null,
    status: ended ? 'ended' : full ? 'full' : 'open',
    attempts_used: mine?.attempts ?? 0, solved, reward, is_owner: isOwner,
    winners: winners.results,
    // 连环：一共几层、解到第几层；只下发已过的层和当前这层，后面的看不到
    layer_count: layers.length,
    layer: solved ? layers.length : cur,
    passed: layers.slice(0, solved ? layers.length : cur).map((l) => ({ ...layerPublic(l), note: l.note })),
    current: solved ? null : layerPublic(layers[cur]),
    // 出题人能看到每层的题面（答案只存了哈希，谁都看不到）
    all_layers: isOwner ? layers.map((l) => ({ ...layerPublic(l), note: l.note })) : undefined,
  }
}

app.post('/api/memes/:id/puzzle', async (c) => {
  if (c.req.method === 'POST') return c.json({ error: '解密功能已下线' }, 410)
  const u = needUser(c)
  const memeId = intIn(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER, 0)
  const m = await c.env.DB.prepare('SELECT author_id FROM memes WHERE id = ? AND hidden = 0').bind(memeId)
    .first<{ author_id: number | null }>()
  if (!m) fail(404, '梗图不存在')
  if (!canManage(u, m!.author_id)) fail(403, '只有发图者可以出题')

  const b = await c.req.json<Record<string, unknown>>()
  // 老格式 {answer, hint} 等于只有一层口令
  const rawLayers = (Array.isArray(b.layers) && b.layers.length ? b.layers : [{ kind: 'pass', prompt: b.hint, answer: b.answer }]) as Record<string, unknown>[]
  if (rawLayers.length > MAX_LAYERS) fail(400, `最多 ${MAX_LAYERS} 层`)
  const salt = randHex(16)
  const layers = await Promise.all(rawLayers.map(async (l, idx) => {
    const kind = LAYER_KINDS.find((k) => k === l.kind) ?? fail(400, `第 ${idx + 1} 层类型不对`)
    // 多个答案用 | 隔开，任一都算对
    const answers = [...new Set(String(l.answer ?? '').split('|').map(normAnswer).filter(Boolean))].slice(0, 10)
    if (!answers.length || answers.some((a) => a.length > 100)) fail(400, `第 ${idx + 1} 层的答案长度需在 1-100 字之间`)
    const data = cleanLayerData(l.data)
    if (kind === 'quiz' && ((data.options as string[] | undefined)?.length ?? 0) < 2) fail(400, `第 ${idx + 1} 层至少要两个选项`)
    if ((kind === 'image' || kind === 'stego') && !data.img) fail(400, `第 ${idx + 1} 层缺图片`)
    if (kind === 'cipher' && !data.text) fail(400, `第 ${idx + 1} 层缺密文`)
    return {
      idx, kind, prompt: String(l.prompt ?? '').trim().slice(0, 300), data: JSON.stringify(data),
      answers: JSON.stringify(await Promise.all(answers.map((a) => sha256(salt + a)))),
      note: String(l.note ?? '').trim().slice(0, 200),
    }
  }))
  // 层里的图只认自己传的、还在的
  const imgKeys = layers.map((l) => (JSON.parse(l.data) as { img?: string }).img).filter((x): x is string => !!x).map((x) => x.slice('/img/'.length))
  if (imgKeys.length) {
    const { results } = await c.env.DB.prepare('SELECT key FROM uploads WHERE user_id = ? AND key IN (SELECT value FROM json_each(?))')
      .bind(u.id, JSON.stringify(imgKeys)).all<{ key: string }>()
    if (results.length < new Set(imgKeys).size) fail(400, '层里的图已失效，请重新选图')
  }
  const hint = String(b.hint ?? '').trim().slice(0, 300) || layers[0].prompt
  const kind = (['secret', 'credit', 'cdk'] as const).find((k) => k === b.reward_kind) ?? fail(400, '奖励类型不对')
  const type = (['text', 'link', 'codes'] as const).find((k) => k === b.reward_type) ?? fail(400, '发放方式不对')
  const rewardText = String(b.reward_text ?? '').trim().slice(0, 2000)
  const codes = type === 'codes'
    ? [...new Set(String(b.codes ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean))].slice(0, 1000)
    : []
  if (type === 'codes' && !codes.length) fail(400, '码池至少需要一个兑换码')
  if (type === 'link' && !/^https:\/\/\S+$/.test(rewardText)) fail(400, '请填写 https 开头的链接')
  if (type === 'text' && !rewardText) fail(400, '请填写解开后展示的内容')
  const endsAt = b.ends_at ? intIn(b.ends_at, now(), now() + 365 * 86400, 0) || null : null
  let maxWinners = intIn(b.max_winners, 0, 10000, 0)
  if (type === 'codes') maxWinners = codes.length

  // 先原子保护图片，避免检查通过后被过期清理删除。保留谜题复用本人已使用图片的原行为。
  if(!await claimUploadKeys(c.env.DB,u.id,imgKeys,true))fail(400,'层里的图已失效，请重新选图')

  const row = await c.env.DB.prepare(
    `INSERT INTO puzzles (meme_id, creator_id, hint, answer_hash, salt, reward_kind, reward_type, reward_text,
       min_trust_level, max_attempts, max_winners, ends_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(meme_id) DO NOTHING RETURNING id`,
  ).bind(memeId, u.id, hint, JSON.parse(layers[0].answers)[0], salt, kind, type, rewardText,
    0, 0, maxWinners, endsAt, now()) // 等级、次数都不限：列保留，统一写 0
    .first<{ id: number }>()
  if (!row) fail(409, '这张图已经有谜题了')
  const ls = c.env.DB.prepare('INSERT INTO puzzle_layers (puzzle_id, idx, kind, prompt, data, answers, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
  await c.env.DB.batch(layers.map((l) => ls.bind(row!.id, l.idx, l.kind, l.prompt, l.data, l.answers, l.note)))
  if (codes.length) {
    const stmt = c.env.DB.prepare('INSERT INTO puzzle_codes (puzzle_id, code) VALUES (?, ?)')
    for (let i = 0; i < codes.length; i += 100) {
      await c.env.DB.batch(codes.slice(i, i + 100).map((code) => stmt.bind(row!.id, code)))
    }
  }
  return c.json({ id: row!.id })
})

app.delete('/api/puzzles/:id', async (c) => {
  const u = needUser(c)
  const id = intIn(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER, 0)
  const pz = await c.env.DB.prepare('SELECT creator_id FROM puzzles WHERE id = ?').bind(id).first<{ creator_id: number }>()
  if (!pz) fail(404, '不存在')
  if (!canManage(u, pz!.creator_id)) fail(403, '没有权限')
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM puzzles WHERE id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM puzzle_codes WHERE puzzle_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM puzzle_attempts WHERE puzzle_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM puzzle_layers WHERE puzzle_id = ?').bind(id),
  ])
  return c.json({ ok: true })
})

app.post('/api/puzzles/:id/solve', async (c) => {
  const u = needUser(c)
  const id = intIn(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER, 0)
  const pz = await c.env.DB.prepare('SELECT * FROM puzzles WHERE id = ?').bind(id).first<Puzzle>()
  if (!pz) fail(404, '谜题不存在')
  const p = pz as Puzzle
  const view = async () => c.json({ correct: true, puzzle: await puzzleView(c, p) })

  if (u.silenced) fail(403, '你在 linux.do 处于禁言状态')
  if (u.id === p.creator_id) fail(400, '不能解自己出的题')
  const [prev, layers] = await Promise.all([
    c.env.DB.prepare('SELECT solved_at, layer FROM puzzle_attempts WHERE puzzle_id = ? AND user_id = ?')
      .bind(id, u.id).first<{ solved_at: number | null; layer: number }>(),
    loadLayers(c, p),
  ])
  if (prev?.solved_at) return view()
  if (p.ends_at && p.ends_at < now()) fail(400, '谜题已结束')
  if (p.max_winners > 0 && p.winners_count >= p.max_winners) fail(400, '名额已被抢完')

  // 不限等级、不限次数；这里只记一下试了几次
  const used = await c.env.DB.prepare(
    `INSERT INTO puzzle_attempts (puzzle_id, user_id, attempts) VALUES (?, ?, 1)
     ON CONFLICT(puzzle_id, user_id) DO UPDATE SET attempts = attempts + 1
       WHERE solved_at IS NULL
     RETURNING attempts`,
  ).bind(id, u.id).first<{ attempts: number }>()
  if (!used) return view()

  const cur = Math.min(prev?.layer ?? 0, layers.length - 1)
  const L = layers[cur]
  const answer = normAnswer(String((await jsonBody<{ answer?: string }>(c)).answer ?? ''))
  if (!(JSON.parse(L.answers) as string[]).includes(await sha256(p.salt + answer))) {
    return c.json({ correct: false })
  }
  // 答对不算消耗机会：退回刚才扣的一次，同时进到下一层（layer 条件防并发重复进层）
  const adv = await c.env.DB.prepare(
    `UPDATE puzzle_attempts SET attempts = attempts - 1, layer = layer + 1
     WHERE puzzle_id = ? AND user_id = ? AND layer = ? AND solved_at IS NULL RETURNING layer`,
  ).bind(id, u.id, cur).first<{ layer: number }>()
  if (!adv) return view()
  if (adv.layer < layers.length) {
    return c.json({ correct: true, next: true, note: L.note, puzzle: await puzzleView(c, p) })
  }

  // 最后一层也过了，发奖；奖发不出去就退回到最后一层，免得卡死
  const rollback = () => c.env.DB.prepare('UPDATE puzzle_attempts SET layer = ? WHERE puzzle_id = ? AND user_id = ?').bind(cur, id, u.id).run()
  let codeId: number | null = null
  if (p.reward_type === 'codes') {
    const code = await c.env.DB.prepare(
      `UPDATE puzzle_codes SET claimed_by = ?, claimed_at = ?
       WHERE id = (SELECT id FROM puzzle_codes WHERE puzzle_id = ? AND claimed_by IS NULL ORDER BY id LIMIT 1)
         AND claimed_by IS NULL
       RETURNING id`,
    ).bind(u.id, now(), id).first<{ id: number }>()
    if (!code) { await rollback(); fail(400, '答对了，可惜兑换码已经被领完') }
    codeId = code!.id
    await c.env.DB.prepare('UPDATE puzzles SET winners_count = winners_count + 1 WHERE id = ?').bind(id).run()
  } else {
    const slot = await c.env.DB.prepare(
      `UPDATE puzzles SET winners_count = winners_count + 1
       WHERE id = ? AND (max_winners = 0 OR winners_count < max_winners) RETURNING winners_count`,
    ).bind(id).first()
    if (!slot) { await rollback(); fail(400, '答对了，可惜名额刚好被抢完') }
  }
  await c.env.DB.prepare('UPDATE puzzle_attempts SET solved_at = ?, code_id = ? WHERE puzzle_id = ? AND user_id = ?')
    .bind(now(), codeId, id, u.id).run()
  p.winners_count += 1
  return view()
})

app.get('/api/puzzles', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT z.id AS pid, z.hint, z.reward_kind, z.min_trust_level, z.max_winners, z.winners_count, z.ends_at,
       (SELECT COUNT(*) FROM puzzle_layers l WHERE l.puzzle_id = z.id) AS layers, m.*, 1 AS puzzle_id
     FROM ${c.get('user') ? 'puzzles z JOIN memes m ON m.id = z.meme_id' : `${galleryCoreFrom(c)} JOIN puzzles z ON z.meme_id = m.id`}
     WHERE m.hidden = 0
     ORDER BY (z.ends_at IS NOT NULL AND z.ends_at < unixepoch()) ASC,
       (z.max_winners > 0 AND z.winners_count >= z.max_winners) ASC, z.id DESC
     LIMIT 100`,
  ).all<MemeRow & { pid: number; hint: string; reward_kind: string; min_trust_level: number; max_winners: number
    winners_count: number; ends_at: number | null; layers: number }>()
  const t = now()
  // 和图廊一样带上回应 / 表情 / 评论，两边显示的是同一份数据
  const items = await decorate(c, results)
  return c.json({
    puzzles: results.map((r, i) => ({
      ...items[i], puzzle: {
        id: r.pid, hint: r.hint, reward_kind: r.reward_kind, min_trust_level: r.min_trust_level,
        max_winners: r.max_winners, winners_count: r.winners_count, ends_at: r.ends_at, layer_count: r.layers || 1,
        status: r.ends_at && r.ends_at < t ? 'ended' : r.max_winners > 0 && r.winners_count >= r.max_winners ? 'full' : 'open',
      },
    })),
  })
})

// ---------- 图片 ----------

app.get('/img/*', async (c) => {
  const key = decodeURIComponent(c.req.path.slice('/img/'.length))
  if(key.startsWith('d/'))return c.notFound()
  // 视频拖进度条要 Range（Safari 不支持 Range 的话直接不播）
  const range = c.req.header('range')
  const obj = await c.env.BUCKET.get(key, range ? { range: c.req.raw.headers } : undefined)
  if (!obj) return c.notFound()
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  headers.set('accept-ranges', 'bytes')
  headers.set('x-content-type-options', 'nosniff')
  // 群聊文件：只许下载，不在本站域名下打开（防止上传的 HTML 之类被当网页执行）
  const ct = obj.httpMetadata?.contentType ?? ''
  if (!/^(image\/(png|jpeg|gif|webp)|video\/)/.test(ct)) {
    const n = fileName(c.req.query('n') || key.split('/').pop())
    headers.set('content-type', 'application/octet-stream')
    headers.set('content-disposition', `attachment; filename="${n.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(n)}`)
    headers.set('content-security-policy', "sandbox; default-src 'none'")
  }
  const r = obj.range as { offset?: number; length?: number } | undefined
  if (range && r && obj.body) {
    const offset = r.offset ?? 0
    const length = r.length ?? obj.size - offset
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`)
    headers.set('content-length', String(length))
    return new Response(obj.body, { status: 206, headers })
  }
  return new Response(obj.body, { headers })
})

// 历史外链图兜底代理：只在 Cloudflare 边缘缓存，不写入任何存储
app.get('/ext', async (c) => {
  let url: URL
  try { url = new URL(c.req.query('u') ?? '') } catch { return c.text('bad url', 400) }
  const hosts = (c.env.EXT_HOSTS ?? 'linux.do').split(',').map((s) => s.trim()).filter(Boolean)
  if (url.protocol !== 'https:' || !hosts.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) {
    return c.text('host not allowed', 403)
  }
  const cache = caches.default
  const cacheKey = new Request(url.toString())
  const hit = await cache.match(cacheKey)
  if (hit) return hit
  const up = await fetch(url.toString(), {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; MemeHall/1.0)' },
    cf: { cacheTtl: 30 * 86400, cacheEverything: true },
  })
  const type = up.headers.get('content-type') ?? ''
  if (!up.ok || !type.startsWith('image/')) return c.text(`upstream ${up.status}`, 502)
  const res = new Response(up.body, {
    headers: { 'content-type': type, 'cache-control': 'public, max-age=2592000' },
  })
  c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()))
  return res
})

// ---------- 分享预览 ----------
// 单张图和图集的链接在 linux.do / 聊天软件里显示对应的图和标题，而不是统一的站点封面
const SITE_DESC = '把有趣的图，留给有趣的人。看图、回应、收藏、解密领红包。'
const attr = (s: string) => s.replace(/[&"<>]/g, (ch) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[ch]!)
async function withMeta(c: C, meta: { title: string; desc: string; image?: string | null }) {
  const page = await c.env.ASSETS.fetch(new URL('/index.html', c.req.url))
  const origin = new URL(c.req.url).origin
  // 没有合适的图（敏感图、空图集）时用品牌分享卡
  const img = new URL(meta.image || '/og-card-1200x630.png', origin).toString()
  const tags = [
    ['og:type', 'website'], ['og:site_name', '尽欢'], ['og:title', meta.title], ['og:description', meta.desc], ['og:url', c.req.url],
    ...(img ? [['og:image', img], ['twitter:card', 'summary_large_image']] : []),
  ].map(([k, v]) => `<meta ${k.startsWith('twitter') ? 'name' : 'property'}="${k}" content="${attr(v)}">`).join('')
  return new HTMLRewriter()
    .on('title', { element: (el) => { el.setInnerContent('尽欢') } })
    .on('meta[name="description"]', { element: (el) => { el.setAttribute('content', meta.desc) } })
    .on('head', { element: (el) => { el.append(tags, { html: true }) } })
    .transform(new Response(page.body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } }))
}
// 敏感图不拿来当预览图
app.get('/m/:id{[0-9]+}', async (c) => {
  const m = await c.env.DB.prepare(`SELECT ${MEME_COLS} FROM ${MEME_FROM} WHERE m.id = ? AND m.hidden = 0${guestGalleryWhere(c)}`).bind(Number(c.req.param('id'))).first<MemeRow>()
  if (!m) return withMeta(c, { title: '这张梗图不存在', desc: SITE_DESC })
  const item = card(m)
  const risky = !!(m as MemeRow & { nsfw?: number }).nsfw || !!m.spoiler
  return withMeta(c, {
    title: m.title || snippet(m.content ?? '', 40) || `第 ${m.id} 张梗图`,
    desc: snippet(m.content ?? '', 120) || `${m.author_name ?? '佚名'} 分享的梗图`,
    image: risky ? null : item.thumb ?? item.image,
  })
})
app.get('/s/:name', async (c) => {
  if (!c.get('user')) return withMeta(c, { title: '图集需要登录', desc: '登录后查看图集' })
  const name = c.req.param('name')
  const r = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n, MAX(created_at) AS last_at,
       (SELECT COALESCE(thumb_url, CASE WHEN image_key IS NOT NULL THEN '/img/' || image_key ELSE image_url END)
        FROM memes WHERE series = ?1 AND hidden = 0 AND nsfw = 0 ORDER BY ld_likes + like_count DESC, id LIMIT 1) AS cover
     FROM memes WHERE series = ?1 AND hidden = 0`,
  ).bind(name).first<{ n: number; last_at: number | null; cover: string | null }>()
  return withMeta(c, { title: name + ' · 图集', desc: r?.n ? `${r.n} 张梗图` : SITE_DESC, image: r?.cover })
})

// ---------- 鞭打模块（原成长路线）：需求 / Bug / 改进意见 + 投票，可带图片 / 文件 ----------
const roadMedia = (raw: unknown) => { try { const a = JSON.parse(String(raw ?? '')); return Array.isArray(a) ? a : [] } catch { return [] } }
const ROAD_KINDS = ['feature', 'bug', 'idea'] as const
const ROAD_STATUS = ['open', 'planned', 'doing', 'done', 'declined'] as const
// 直接复用已认领的消息媒体；不重复 claimMedia，不额外复制 R2 文件。
function chatRoadAttachments(m: { media: string | null; image_key: string | null; width: number | null; height: number | null }) {
  return msgMedia(m)?.filter((x) => x.kind !== 'f').map(toGallery)
    ?? (m.image_key ? [{ u: `/img/${m.image_key}`, w: m.width, h: m.height }] : [])
}
function chatRoadStatements(db: D1Database, id: number | null, body: string, media: unknown[], t: number) {
  const content = chatRoadContent(body)
  const msg = id === null ? 'last_insert_rowid()' : '?'
  if (!content) return id === null ? [] : [db.prepare(
    `UPDATE road_items SET source_hidden = 1, updated_at = ? WHERE source_msg_id = ?
     AND EXISTS (SELECT 1 FROM chat_messages x WHERE x.id = ? AND x.body = ?)`,
  ).bind(t, id, id, body)]
  const insert = db.prepare(
    `INSERT INTO road_items (user_id, kind, title, body, media, source_msg_id, source_group_id, source_hidden, score, created_at, updated_at)
     SELECT x.user_id, ?, ?, x.body, ?, x.id, x.group_id, 0, 1, x.created_at, ? FROM chat_messages x
     WHERE x.id = ${msg} AND x.body = ? AND x.deleted = 0
     ON CONFLICT(source_msg_id) DO UPDATE SET kind = excluded.kind, title = excluded.title, body = excluded.body,
       media = excluded.media, source_hidden = 0, updated_at = excluded.updated_at`,
  ).bind(content.kind, content.title, media.length ? JSON.stringify(media) : null, t, ...(id === null ? [] : [id]), body)
  const vote = id === null
    ? db.prepare('INSERT OR IGNORE INTO road_votes (item_id, user_id, v) SELECT id, user_id, 1 FROM road_items WHERE id = last_insert_rowid() AND source_msg_id IS NOT NULL')
    : db.prepare(`INSERT OR IGNORE INTO road_votes (item_id, user_id, v) SELECT id, user_id, 1 FROM road_items
        WHERE source_msg_id = ? AND score = 1 AND NOT EXISTS (SELECT 1 FROM road_votes WHERE item_id = road_items.id)`).bind(id)
  return [insert, vote]
}
app.post('/api/road/backfill-chat', async (c) => {
  needSiteAdmin(c)
  const b = await jsonBody<{ after?: number; upto?: number }>(c)
  const after = intIn(b.after, 0, Number.MAX_SAFE_INTEGER, 0)
  const max = await c.env.DB.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM chat_messages').first<{ n: number }>()
  const upto = Math.min(max!.n, intIn(b.upto, 0, Number.MAX_SAFE_INTEGER, max!.n))
  const rows = (await c.env.DB.prepare('SELECT id, body, media, image_key, width, height FROM chat_messages WHERE id > ? AND id <= ? AND deleted = 0 ORDER BY id LIMIT 51')
    .bind(after, upto).all<{ id: number; body: string; media: string | null; image_key: string | null; width: number | null; height: number | null }>()).results
  const page = rows.slice(0, 50)
  const tagged = page.filter((m) => chatRoadContent(m.body))
  if (tagged.length) {
    const statements = tagged.flatMap((m) => chatRoadStatements(c.env.DB, m.id, m.body, chatRoadAttachments(m), now()))
    statements.push(c.env.DB.prepare('UPDATE chat_messages SET updated_at = ? WHERE id IN (SELECT value FROM json_each(?)) AND deleted = 0')
      .bind(now(), JSON.stringify(tagged.map((m) => m.id))))
    await c.env.DB.batch(statements)
  }
  return c.json({ scanned: page.length, matched: tagged.length, after: page.at(-1)?.id ?? after, upto, more: rows.length > 50 })
})
app.get('/api/road', async (c) => {
  const u = needUser(c)
  const kind = c.req.query('kind') || ''
  const status = c.req.query('status') || ''
  const sort = c.req.query('sort') === 'new' ? 'r.id DESC' : 'r.score DESC, r.id DESC'
  const where = ['r.hidden = 0', 'r.source_hidden = 0']
  const args: unknown[] = [u?.id ?? 0]
  if ((ROAD_KINDS as readonly string[]).includes(kind)) { where.push('r.kind = ?'); args.push(kind) }
  if ((ROAD_STATUS as readonly string[]).includes(status)) { where.push('r.status = ?'); args.push(status) }
  const item = intIn(c.req.query('item'), 1, Number.MAX_SAFE_INTEGER, 0)
  if (item) { where.push('r.id = ?'); args.push(item) }
  const rows = (await c.env.DB.prepare(
    `SELECT r.*, u.username, u.name, u.avatar, u.is_admin, u.trust_level, u.fancy, u.deco,
       (SELECT v FROM road_votes WHERE item_id = r.id AND user_id = ?) AS my
     FROM road_items r JOIN users u ON u.id = r.user_id WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT 200`,
  ).bind(...args).all<Record<string, unknown>>()).results
  return c.json({
    items: rows.map((r) => ({
      id: r.id, kind: r.kind, title: r.title, body: r.body, status: r.status, reply: r.reply, score: r.score, comments: r.comments,
      created_at: r.created_at, updated_at: r.updated_at, my: r.my ?? 0, mine: r.user_id === u?.id, media: roadMedia(r.media),
      source_msg_id: r.source_msg_id ?? null, source_group_id: r.source_group_id ?? null,
      user: { username: r.username, name: r.name, avatar: r.avatar, is_admin: !!r.is_admin, fancy: isFancy(r as { is_admin: number; trust_level: number; fancy: number | null }), deco: decoOf(r.deco) },
    })),
  })
})
app.post('/api/road', async (c) => {
  const u = needUser(c)
  if (u.silenced) fail(403, '你在 linux.do 处于禁言状态')
  await needNotLimited(c, u, 'post')
  const b = await jsonBody<{ kind?: string; title?: string; body?: string; media?: unknown }>(c)
  const kind = (ROAD_KINDS as readonly string[]).includes(String(b.kind)) ? String(b.kind) : 'idea'
  const title = String(b.title ?? '').trim().slice(0, 60)
  const body = String(b.body ?? '').trim().slice(0, 2000)
  if (title.length < 2) fail(400, '标题至少 2 个字')
  const last = await c.env.DB.prepare('SELECT MAX(created_at) AS t FROM road_items WHERE user_id = ?').bind(u.id).first<{ t: number | null }>()
  if (rateOn(c) && last?.t && now() - last.t < 30) fail(429, '慢一点，30 秒后再提')
  const prepared = await prepareMedia(c, u.id, b.media, true), media = prepared.map(toGallery)
  const t = now()
  const [r] = await commitUploadContent(c.env.DB,u.id,mediaKeys(prepared),[
    c.env.DB.prepare('INSERT INTO road_items (user_id, kind, title, body, media, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?) RETURNING id')
      .bind(u.id, kind, title, body, media.length ? JSON.stringify(media) : null, t, t),
    // 自己提的默认自己投一票，与条目同批提交。
    c.env.DB.prepare('INSERT INTO road_votes (item_id, user_id, v) VALUES (last_insert_rowid(), ?, 1)').bind(u.id),
  ])
  const id=(r.results[0] as {id:number}).id
  c.executionCtx.waitUntil(settleContentRewards(c.env.DB,t,{source:'road',id}).catch(()=>console.error('content_road_reward_retry')))
  return c.json({ id })
})
const roadItem = async (c: C) => {
  const id = intIn(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER, 0)
  const r = await c.env.DB.prepare('SELECT * FROM road_items WHERE id = ? AND hidden = 0 AND source_hidden = 0').bind(id).first<{ id: number; user_id: number }>()
  if (!r) fail(404, '这条不存在')
  return r!
}
app.post('/api/road/:id/vote', async (c) => {
  const u = needUser(c)
  const r = await roadItem(c)
  const raw = Number((await jsonBody<{ v?: unknown }>(c)).v)
  const v = raw > 0 ? 1 : raw < 0 ? -1 : 0
  await c.env.DB.batch([
    v ? c.env.DB.prepare('INSERT INTO road_votes (item_id, user_id, v) VALUES (?, ?, ?) ON CONFLICT (item_id, user_id) DO UPDATE SET v = excluded.v').bind(r.id, u.id, v)
      : c.env.DB.prepare('DELETE FROM road_votes WHERE item_id = ? AND user_id = ?').bind(r.id, u.id),
    c.env.DB.prepare('UPDATE road_items SET score = (SELECT COALESCE(SUM(v), 0) FROM road_votes WHERE item_id = ?1) WHERE id = ?1').bind(r.id),
  ])
  const s = await c.env.DB.prepare('SELECT score FROM road_items WHERE id = ?').bind(r.id).first<{ score: number }>()
  return c.json({ score: s?.score ?? 0, my: v })
})
// 管理员：改状态、写回复；作者和管理员能删
app.patch('/api/road/:id', async (c) => {
  needSiteAdmin(c)
  const r = await roadItem(c)
  const b = await jsonBody<{ status?: string; reply?: string | null }>(c)
  const status = (ROAD_STATUS as readonly string[]).includes(String(b.status)) ? String(b.status) : null
  const reply = b.reply === undefined ? undefined : String(b.reply ?? '').trim().slice(0, 1000) || null
  await c.env.DB.prepare('UPDATE road_items SET status = COALESCE(?, status), reply = CASE WHEN ? THEN ? ELSE reply END, updated_at = ? WHERE id = ?')
    .bind(status, reply !== undefined ? 1 : 0, reply ?? null, now(), r.id).run()
  return c.json({ ok: true })
})
app.delete('/api/road/:id', async (c) => {
  const u = needUser(c)
  const r = await roadItem(c)
  if (r.user_id !== u.id && !u.is_admin) fail(403, '只能删自己提的')
  await c.env.DB.prepare('UPDATE road_items SET hidden = 1 WHERE id = ?').bind(r.id).run()
  return c.json({ ok: true })
})
app.get('/api/road/:id/comments', async (c) => {
  needUser(c)
  const r = await roadItem(c)
  const rows = (await c.env.DB.prepare(
    `SELECT rc.id, rc.body, rc.media, rc.created_at, u.username, u.name, u.avatar, u.is_admin, u.trust_level, u.fancy, u.deco
     FROM road_comments rc JOIN users u ON u.id = rc.user_id WHERE rc.item_id = ? ORDER BY rc.id LIMIT 300`,
  ).bind(r.id).all<Record<string, unknown>>()).results
  return c.json({ comments: rows.map((x) => ({ id: x.id, body: x.body, media: roadMedia(x.media), created_at: x.created_at,
    user: { username: x.username, name: x.name, avatar: x.avatar, is_admin: !!x.is_admin, fancy: isFancy(x as { is_admin: number; trust_level: number; fancy: number | null }), deco: decoOf(x.deco) } })) })
})
app.post('/api/road/:id/comments', async (c) => {
  const u = needUser(c)
  if (u.silenced) fail(403, '你在 linux.do 处于禁言状态')
  await needNotLimited(c, u, 'comment')
  const r = await roadItem(c)
  const b = await jsonBody<{ body?: string; media?: unknown }>(c)
  const body = String(b.body ?? '').trim().slice(0, 1000)
  if (!body && !(Array.isArray(b.media) && b.media.length)) fail(400, '说点什么吧')
  const last = await c.env.DB.prepare('SELECT MAX(created_at) AS t FROM road_comments WHERE user_id = ?').bind(u.id).first<{ t: number | null }>()
  if (rateOn(c) && last?.t && now() - last.t < 5) fail(429, '慢一点，5 秒后再说')
  const prepared = await prepareMedia(c, u.id, b.media, true), media = prepared.map(toGallery)
  await commitUploadContent(c.env.DB,u.id,mediaKeys(prepared),[
    c.env.DB.prepare('INSERT INTO road_comments (item_id, user_id, body, media, created_at) VALUES (?, ?, ?, ?, ?)').bind(r.id, u.id, body, media.length ? JSON.stringify(media) : null, now()),
    c.env.DB.prepare('UPDATE road_items SET comments = comments + 1 WHERE id = ?').bind(r.id),
  ])
  return c.json({ ok: true })
})

// 兜底必须放最后（路由都写在它上面）：Hono 按注册顺序匹配，放前面会把后面注册的 /api 路由全吞掉
app.route('/', platform)
app.route('/', aiAdmin)
app.route('/', aiChat)
app.route('/', nativeLdc)
app.route('/', fishFunding)
app.route('/', dm)
app.route('/', chatStickers)
app.route('/', chatFavorites)
app.route('/', socialPreview)
app.route('/', titleRaffle)
app.route('/', instantCards)
app.route('/', huancai)
app.route('/', aiImages)
app.route('/', invites)
app.route('/', accountsAdmin)
app.route('/', authEmail)
app.route('/', accountBinding)
app.route('/', accountMerge)
app.route('/', account)
app.route('/', avatarSettings)
app.route('/', webPush)
app.route('/', farm)
app.all('/api/*', (c) => c.json({ error: '接口不存在' }, 404))

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledController, env: Env) => {
    const t=Math.floor(event.scheduledTime/1000)
    if(event.cron==='* * * * *'){
      await sendSleepReminder(env.DB,t).catch(()=>console.error('sleep_reminder_failed'))
      await runGuessEscalation(env).catch(()=>console.error('guess_escalation_cron_failed'))
      await settlePendingEscalationAwards(env).catch(()=>console.error('guess_escalation_payout_failed'))
      await settleCloseVotes(env).catch(()=>console.error('guess_close_vote_cron_failed'))
      await settleCompensationAwards(env).catch(()=>console.error('guess_compensation_cron_failed'))
      await expireGuessGames(env,t)
      await runLuckybags(env,t)
      await runGuessQueue(env).catch(()=>console.error('guess_queue_cron_failed'))
      await settlePacketDraws(env,t).catch(()=>console.error('packet_draw_settlement_failed'))
      await settlePacketLuck(env.DB,t)
      await settleDailyRanks(env.DB,t).catch(()=>console.error('rank_settlement_failed'))
      await sendPacketReminders(env.DB,t)
      await settleCoinPackets(env.DB,t)
      await settleCoinPools(env.DB,t)
      await drawDueTitleRaffle(env.DB,Math.floor(Date.now()/1000))
      await runWebPush(env,t).catch(()=>console.error('web_push_failed'))
      await runAnswerExplanations(env,t).catch(()=>console.error('guess_explanation_failed'))
      await runGuessReviews(env).catch(()=>console.error('guess_review_cron_failed'))
      await settleContentRewards(env.DB,t).catch(()=>console.error('content_rewards_retry'))
      await settleFarmLeases(env.DB,t).catch(()=>console.error('farm_lease_cron_failed'))
      await settleMarket(env.DB,t).catch(()=>console.error('farm_market_cron_failed'))
      await settleConflicts(env.DB,t).catch(()=>console.error('farm_conflict_cron_failed'))
      await settleHuancai(env.DB,t).catch(()=>console.error('huancai_settlement_failed'))
      if(new Date(event.scheduledTime).getUTCMinutes()===0){
        const cleanup=await cleanupUploads(env.DB,env.BUCKET,t).catch(()=>null)
        if(!cleanup||cleanup.failed)console.error('upload_cleanup_retry_pending')
      }
    }
    if(event.cron===IMAGE_CRON)await runImageCron(env)
    if(event.cron==='0 1 * * *'){
      // Display only 30 days; prune at most 500 older receipts per day. Crop
      // cycle/stolen/watered state remains authoritative after receipt expiry.
      await env.DB.prepare('DELETE FROM farm_visits WHERE id IN (SELECT id FROM farm_visits WHERE created_at<? ORDER BY created_at LIMIT 500)').bind(t-90*86400).run().catch(()=>console.error('farm_visit_cleanup_failed'))
      await env.DB.prepare('DELETE FROM farm_ranch_visits WHERE id IN (SELECT id FROM farm_ranch_visits WHERE created_at<? ORDER BY created_at LIMIT 500)').bind(t-90*86400).run().catch(()=>console.error('farm_ranch_visit_cleanup_failed'))
      await env.DB.prepare('DELETE FROM farm_guest_visits WHERE rowid IN (SELECT rowid FROM farm_guest_visits WHERE visited_at<? ORDER BY visited_at LIMIT 500)').bind(t-90*86400).run().catch(()=>console.error('farm_guest_cleanup_failed'))
      await env.DB.prepare('DELETE FROM guess_reference_preparations WHERE packet_id IN (SELECT packet_id FROM guess_reference_preparations WHERE expires_at<? ORDER BY expires_at LIMIT 500)').bind(t).run().catch(()=>console.error('guess_reference_cleanup_failed'))
      await cleanupAccounts(env.DB,t)
      // 含四条清理最多 44 条 D1 语句，有限接续积压，不影响红包的分钟任务。
      for(let batch=0;batch<5;batch++){
        const result=await settleInviteRewards(env.DB,t)
        if(result.qualified<200&&result.rewarded<40)break
      }
    }
  },
}
