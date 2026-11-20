import {NEXT_ACCOUNT_ID_SQL,isRetiredAccountError} from './account-ids'
type SignupInput = {
  provider?: 'google'
  handle?: string
  tokenHash: string
  invite?: string
  inviteRequired: boolean
  now: number
  sessionHash: string
  userAgent: string
}
type SignupResult = { status: 'created'; userId: number } | {
  status: 'invalid-token' | 'invalid-invite' | 'handle-taken' | 'email-taken'
}
type SignupToken = { email: string | null; payload: string }
type SignupPayload = { handle: string; nick: string; pw?: string; invite?: string; sub?: string; emailVerified?: boolean; picture?: string | null }

// 消耗令牌、邀请码与建号共用一个 batch。任何唯一约束错误都会回滚全部写入。
// 邮件链接仅验证令牌持有权；HTTP 层在调用前负责 Origin、上线门控和频率限制。
export async function completeSignup(db: D1Database, input: SignupInput): Promise<SignupResult> {
  const { tokenHash, now, sessionHash, inviteRequired } = input
  const provider = input.provider ?? 'email', google = provider === 'google', kind = google ? 'gpending' : 'signup'
  const token = await db.prepare(
    'SELECT email, payload FROM auth_tokens WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?',
  ).bind(tokenHash, kind, now).first<SignupToken>()
  if (!token) return { status: 'invalid-token' }
  let payload: SignupPayload
  try { payload = JSON.parse(token.payload) } catch { return { status: 'invalid-token' } }
  if (!payload || Array.isArray(payload) || typeof payload.handle !== 'string' || !payload.handle.trim()
    || (!google && (typeof payload.pw !== 'string' || !payload.pw || typeof token.email !== 'string' || !token.email.trim()))
    || (google && (typeof payload.sub !== 'string' || !payload.sub || typeof payload.emailVerified !== 'boolean'))
    || (payload.nick !== undefined && typeof payload.nick !== 'string')
    || (payload.invite !== undefined && typeof payload.invite !== 'string')
    || (input.invite !== undefined && typeof input.invite !== 'string')) {
    return { status: 'invalid-token' }
  }
  const invite = (input.invite ?? payload.invite ?? '').trim().toUpperCase()
  const handle = input.handle ?? payload.handle
  const gate = inviteRequired || (!google && !!invite)
  const emailConflict = "EXISTS(SELECT 1 FROM identities WHERE provider='email' AND subject=? AND verified_at IS NOT NULL)"
  if (google && payload.emailVerified && await db.prepare(`SELECT 1 WHERE ${emailConflict}`).bind(token.email).first()) return {status:'email-taken'}
  const claim = crypto.randomUUID()
  const claimed = 'EXISTS (SELECT 1 FROM auth_tokens WHERE token_hash = ? AND claim_id = ?)'
  const eligible = `EXISTS (SELECT 1 FROM invite_codes i JOIN users u ON u.id = i.owner_id
    WHERE i.code = ? AND i.used_by IS NULL AND i.revoked = 0 AND i.expires_at > ? AND u.disabled = 0 AND u.kind = 'user')`
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.prepare(
      NEXT_ACCOUNT_ID_SQL,
    ).bind().first<{ id: number }>()
    const id = row!.id
    if (!Number.isSafeInteger(id) || id < 1000000000) throw new Error('account_id_out_of_range')
    try {
      const result = await db.batch([
        db.prepare(`UPDATE auth_tokens SET used_at = ?, claim_id = ? WHERE token_hash = ?
          AND kind = ? AND used_at IS NULL AND expires_at > ?
          AND (? = 0 OR ${eligible}) AND (? = 0 OR NOT ${emailConflict})`)
          .bind(now, claim, tokenHash, kind, now, gate ? 1 : 0, invite, now, google && payload.emailVerified ? 1 : 0, token.email),
        db.prepare(`UPDATE invite_codes SET used_by = ?, used_at = ?
          WHERE code = ? AND used_by IS NULL AND revoked = 0 AND expires_at > ?
          AND EXISTS(SELECT 1 FROM users WHERE id=owner_id AND disabled=0 AND kind='user') AND ${claimed}`)
          .bind(id, now, invite, now, tokenHash, claim),
        db.prepare(`INSERT INTO users(id, username, name, nick, avatar, trust_level, kind, invited_by, created_at, updated_at, handle_setup_pending)
          SELECT ?, ?, ?, ?, ?, 1, 'user', (SELECT owner_id FROM invite_codes WHERE code = ? AND used_by = ?), ?, ?, ?
          WHERE ${claimed}`)
          .bind(id, handle, payload.nick || handle, payload.nick || null, google ? payload.picture ?? null : null, invite, id, now, now, google?1:0, tokenHash, claim),
        db.prepare(`INSERT INTO identities(provider, subject, user_id, email, verified_at, created_at, last_login_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${claimed}`)
          .bind(provider, google ? payload.sub! : token.email, id, token.email, google && !payload.emailVerified ? null : now, now, now, tokenHash, claim),
        ...(!google ? [db.prepare(`INSERT INTO passwords(user_id, hash, updated_at) SELECT ?, ?, ? WHERE ${claimed}`)
          .bind(id, payload.pw!, now, tokenHash, claim)] : []),
        db.prepare(`INSERT INTO invites(invitee_id, inviter_id, code, method, created_at)
          SELECT ?, owner_id, code, ?, ? FROM invite_codes WHERE code = ? AND used_by = ? AND ${claimed}`)
          .bind(id, provider, now, invite, id, tokenHash, claim),
        db.prepare(`INSERT INTO sessions(id, user_id, expires_at, created_at, seen_at, method, ua)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${claimed}`)
          .bind(sessionHash, id, now + 2592000, now, now, provider, input.userAgent.slice(0, 120), tokenHash, claim),
        db.prepare(`INSERT INTO user_badges(user_id,badge,n,first_at,last_day)
          SELECT ?, 'newbie', 1, ?, date(?,'unixepoch','+8 hours')
          WHERE EXISTS(SELECT 1 FROM invites WHERE invitee_id=?) AND ${claimed}`)
          .bind(id,now,now,id,tokenHash,claim),
        db.prepare(`INSERT INTO badge_log(user_id,badge,day,at)
          SELECT ?, 'newbie', date(?,'unixepoch','+8 hours'), ?
          WHERE EXISTS(SELECT 1 FROM invites WHERE invitee_id=?) AND ${claimed}`)
          .bind(id,now,now,id,tokenHash,claim),
        db.prepare(`INSERT OR IGNORE INTO chat_members(group_id, user_id, joined_at, last_read)
          SELECT g.id, ?, ?, (SELECT COALESCE(MAX(m.id), 0) FROM chat_messages m WHERE m.group_id = g.id)
          FROM chat_groups g WHERE g.is_default = 1 AND ${claimed}`)
          .bind(id, now, tokenHash, claim),
      ])
      if (result[0].meta.changes === 1) return { status: 'created', userId: id }
      const stillValid = await db.prepare(
        'SELECT 1 AS ok FROM auth_tokens WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?',
      ).bind(tokenHash, kind, now).first()
      if (stillValid && google && payload.emailVerified && await db.prepare(`SELECT 1 WHERE ${emailConflict}`).bind(token.email).first()) return {status:'email-taken'}
      return { status: stillValid ? 'invalid-invite' : 'invalid-token' }
    } catch (error) {
      const message = String(error)
      if (message.includes('UNIQUE constraint failed: users.username')) return { status: 'handle-taken' }
      if (message.includes('UNIQUE constraint failed: identities.provider, identities.subject')) return { status: 'email-taken' }
      // 仅重试 ID 竞争，不能吞掉其他数据库故障或把会话冲突当成注册成功。
      if ((message.includes('UNIQUE constraint failed: users.id')||isRetiredAccountError(error)) && attempt < 2) continue
      throw error
    }
  }
  throw new Error('account_id_retry_exhausted')
}
