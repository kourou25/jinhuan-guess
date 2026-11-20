const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const validByteMax = Math.floor(256 / ALPHABET.length) * ALPHABET.length
export function inviteCode() {
  let value = ''
  while (value.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(12))) {
      if (byte < validByteMax) value += ALPHABET[byte % ALPHABET.length]
      if (value.length === 8) break
    }
  }
  return value
}
export async function createInvite(db: D1Database, uid: number, unlimited: boolean, now: number): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const code = inviteCode()
    try {
      const result = await db.prepare(`INSERT INTO invite_codes(code,owner_id,created_at,expires_at)
        SELECT ?1,?2,?3,?3+2592000 WHERE EXISTS (SELECT 1 FROM users WHERE id=?2 AND disabled=0 AND kind='user')
        AND (?4=1 OR (3+(SELECT COUNT(*) FROM invites WHERE inviter_id=?2 AND qualified_at IS NOT NULL AND revoked=0))
          -(SELECT COUNT(*) FROM invite_codes WHERE owner_id=?2 AND used_by IS NOT NULL)
          >(SELECT COUNT(*) FROM invite_codes WHERE owner_id=?2 AND used_by IS NULL AND revoked=0 AND expires_at>?3))`)
        .bind(code,uid,now,unlimited?1:0).run()
      return result.meta.changes === 1 ? code : null
    } catch (error) {
      if (attempt === 0 && String(error).includes('UNIQUE constraint failed: invite_codes.code')) continue
      throw error
    }
  }
  return null
}
