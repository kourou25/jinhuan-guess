import {NEXT_ACCOUNT_ID_SQL,isRetiredAccountError} from './account-ids'
export type LinuxdoProfile = {
  id: number; username: string; name: string | null; avatar: string | null
  trustLevel: number; silenced: number
}
export type LinuxdoIntent = { intent: 'login'; next: string; invite?:string } | {
  intent: 'bind'; next: string; userId: number; sessionHash: string; mergeTargetSnapshot?:string
}
type Input = {
  tokenHash: string; intent: LinuxdoIntent; profile: LinuxdoProfile; now: number
  sessionHash: string; userAgent: string; ownerIds: number[]
}
type Result = {status: 'ok'; userId: number} | {
  status: 'disabled' | 'identity-in-use' | 'already-bound' | 'invalid-state'
}

// subject 只用于查身份。绑定后的站内 uid 可以与 Linux.DO id 不同。
// 状态消费、身份、资料及新会话必须一起提交；所有后续写入都由本次随机 claim 保护。
export async function completeLinuxdo(db: D1Database, input: Input): Promise<Result> {
  const {profile: p, intent, tokenHash, now: t} = input
  const subject = String(p.id)
  for (let attempt = 0; attempt < 3; attempt++) {
    const identity = await db.prepare("SELECT user_id FROM identities WHERE provider='linuxdo' AND subject=?")
      .bind(subject).first<{user_id: number}>()
    // 必须先分支绑定意图，不能以已存在的身份登录另一个用户。
    if (intent.intent === 'bind' && identity && identity.user_id !== intent.userId) return {status: 'identity-in-use'}
    let uid = intent.intent === 'bind' ? intent.userId : identity?.user_id
    const create = uid === undefined
    if (create) {
      const occupied = await db.prepare('SELECT 1 FROM users WHERE id=?1 UNION ALL SELECT 1 FROM account_retirements WHERE source_id=?1').bind(p.id).first()
      if (!occupied && p.id < 999000000) uid = p.id
      else uid = (await db.prepare(NEXT_ACCOUNT_ID_SQL)
        .first<{id:number}>())!.id
    }
    const id = uid!
    if (!Number.isSafeInteger(id)) throw new Error('account_id_out_of_range')
    if (!create) {
      const user = await db.prepare('SELECT disabled,kind FROM users WHERE id=?').bind(id).first<{disabled:number;kind:string}>()
      if (!user || user.disabled || user.kind !== 'user') return {status:'disabled'}
      if (intent.intent === 'bind' && await db.prepare("SELECT 1 FROM identities WHERE user_id=? AND provider='linuxdo' AND subject<>?").bind(id,subject).first()) {
        return {status:'already-bound'}
      }
    }
    let handle = p.username
    if (create && await db.prepare('SELECT 1 FROM users WHERE username=? COLLATE NOCASE').bind(handle).first()) {
      const suffix = '_ld' + (attempt ? attempt+1 : '')
      handle = p.username.slice(0,20-suffix.length) + suffix
    }
    const claim = crypto.randomUUID()
    const claimed = 'EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=? AND claim_id=?)'
    const active = "EXISTS(SELECT 1 FROM users WHERE id=? AND disabled=0 AND kind='user')"
    let eligible: string, eligibility: (string | number)[]
    if (intent.intent === 'bind') {
      eligible = `${active} AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>?)
        AND NOT EXISTS(SELECT 1 FROM identities WHERE provider='linuxdo' AND subject=? AND user_id<>?)
        AND NOT EXISTS(SELECT 1 FROM identities WHERE provider='linuxdo' AND user_id=? AND subject<>?)`
      eligibility = [id,intent.sessionHash,id,t,subject,id,id,subject]
    } else if (create) {
      eligible = "NOT EXISTS(SELECT 1 FROM identities WHERE provider='linuxdo' AND subject=?) AND NOT EXISTS(SELECT 1 FROM users WHERE id=?)"
      eligibility = [subject,id]
    } else {
      eligible = `${active} AND EXISTS(SELECT 1 FROM identities WHERE provider='linuxdo' AND subject=? AND user_id=?)`
      eligibility = [id,subject,id]
    }
    const statements = [db.prepare(`UPDATE auth_tokens SET used_at=?,claim_id=? WHERE token_hash=? AND kind='oauth_linuxdo'
      AND used_at IS NULL AND expires_at>? AND ${eligible}`).bind(t,claim,tokenHash,t,...eligibility)]
    if (create) statements.push(db.prepare(`INSERT INTO users(id,username,name,avatar,trust_level,silenced,is_admin,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE ${claimed}`)
      .bind(id,handle,p.name,p.avatar,p.trustLevel,p.silenced,input.ownerIds.includes(id)?1:0,t,t,tokenHash,claim))
    if(create && intent.intent==='login' && intent.invite){
      const invite=intent.invite
      statements.push(
        db.prepare(`UPDATE invite_codes SET used_by=?,used_at=? WHERE code=? AND used_by IS NULL AND revoked=0 AND expires_at>?
          AND owner_id<>? AND EXISTS(SELECT 1 FROM users WHERE id=owner_id AND disabled=0 AND kind='user') AND ${claimed}`)
          .bind(id,t,invite,t,id,tokenHash,claim),
        db.prepare(`INSERT INTO invites(invitee_id,inviter_id,code,method,created_at)
          SELECT ?,owner_id,code,'linuxdo',? FROM invite_codes WHERE code=? AND used_by=? AND ${claimed}`)
          .bind(id,t,invite,id,tokenHash,claim),
        db.prepare(`UPDATE users SET invited_by=(SELECT inviter_id FROM invites WHERE invitee_id=?) WHERE id=? AND ${claimed}`)
          .bind(id,id,tokenHash,claim),
        db.prepare(`INSERT INTO user_badges(user_id,badge,n,first_at,last_day)
          SELECT ?,'newbie',1,?,date(?,'unixepoch','+8 hours') WHERE EXISTS(SELECT 1 FROM invites WHERE invitee_id=?) AND ${claimed}`)
          .bind(id,t,t,id,tokenHash,claim),
        db.prepare(`INSERT INTO badge_log(user_id,badge,day,at)
          SELECT ?,'newbie',date(?,'unixepoch','+8 hours'),? WHERE EXISTS(SELECT 1 FROM invites WHERE invitee_id=?) AND ${claimed}`)
          .bind(id,t,t,id,tokenHash,claim),
      )
    }
    statements.push(
      db.prepare(`INSERT INTO identities(provider,subject,user_id,username,verified_at,created_at,last_login_at)
        SELECT 'linuxdo',?,?,?,?,?,? WHERE ${claimed}
        ON CONFLICT(provider,subject) DO UPDATE SET username=excluded.username,verified_at=excluded.verified_at,last_login_at=excluded.last_login_at
        WHERE identities.user_id=excluded.user_id`).bind(subject,id,p.username,t,t,t,tokenHash,claim),
      db.prepare(`UPDATE users SET
        username=CASE WHEN NOT EXISTS(SELECT 1 FROM users other WHERE other.username=? COLLATE NOCASE AND other.id<>?) THEN ? ELSE username END,
        name=COALESCE(nick,?),avatar=CASE WHEN avatar_custom=1 THEN avatar ELSE ? END,
        trust_level=?,silenced=?,is_admin=CASE WHEN role='admin' THEN 1 ELSE ? END,updated_at=?
        WHERE id=? AND ${claimed}`)
        .bind(p.username,id,p.username,p.name,p.avatar,p.trustLevel,p.silenced,input.ownerIds.includes(id)?1:0,t,id,tokenHash,claim),
      db.prepare(`UPDATE memes SET author_id=?,author_name=(SELECT username FROM users WHERE id=?)
        WHERE ((author_id IS NULL AND author_name=? COLLATE NOCASE) OR author_id=?) AND ${claimed}`)
        .bind(id,id,p.username,id,tokenHash,claim),
    )
    if(intent.intent==='bind')statements.push(db.prepare(`UPDATE auth_tokens SET used_at=? WHERE kind='merge' AND used_at IS NULL
      AND (user_id=? OR CASE WHEN json_valid(payload) THEN json_extract(payload,'$.sourceId') END=?) AND ${claimed}`).bind(t,id,id,tokenHash,claim))
    if (intent.intent === 'login') statements.push(
      db.prepare(`INSERT INTO sessions(id,user_id,expires_at,created_at,seen_at,method,ua)
        SELECT ?,?,?,?,?, 'linuxdo',? WHERE ${claimed}`)
        .bind(input.sessionHash,id,t+2592000,t,t,input.userAgent.slice(0,120),tokenHash,claim),
      db.prepare(`INSERT OR IGNORE INTO chat_members(group_id,user_id,joined_at,last_read)
        SELECT g.id,?, ?, (SELECT COALESCE(MAX(m.id),0) FROM chat_messages m WHERE m.group_id=g.id)
        FROM chat_groups g WHERE g.is_default=1 AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.group_id=g.id AND b.user_id=?) AND ${claimed}`)
        .bind(id,t,id,tokenHash,claim),
    )
    try {
      const result = await db.batch(statements)
      if (result[0].meta.changes === 1) return {status:'ok',userId:id}
      // 另一个 callback 可能刚创建了此 subject；仅尚未使用的本请求可重新解析映射。
      const valid = await db.prepare("SELECT 1 FROM auth_tokens WHERE token_hash=? AND kind='oauth_linuxdo' AND used_at IS NULL AND expires_at>?").bind(tokenHash,t).first()
      if (!valid || intent.intent==='bind') return {status:'invalid-state'}
    } catch (error) {
      if (attempt<2 && (/UNIQUE constraint failed: (users\.(id|username)|identities\.provider, identities\.subject)/.test(String(error))||isRetiredAccountError(error))) continue
      throw error
    }
  }
  return {status:'invalid-state'}
}
