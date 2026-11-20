// 消耗重设令牌、更新密码、撤销旧会话与创建新会话共用原子事务。
export async function completePasswordReset(db:D1Database,input:{tokenHash:string;hash:string;sessionHash:string;userAgent:string;now:number}){
 const {tokenHash,hash,sessionHash,userAgent,now}=input,claim=crypto.randomUUID()
 const gate="EXISTS(SELECT 1 FROM auth_tokens t WHERE t.token_hash=? AND t.claim_id=?)"
 const token=await db.prepare("SELECT user_id FROM auth_tokens WHERE token_hash=? AND kind='reset' AND used_at IS NULL AND expires_at>?").bind(tokenHash,now).first<{user_id:number}>()
 if(!token)return false
 const id=token.user_id
 const result=await db.batch([
  db.prepare(`UPDATE auth_tokens SET used_at=?,claim_id=? WHERE token_hash=? AND kind='reset' AND used_at IS NULL AND expires_at>?
   AND EXISTS(SELECT 1 FROM users u JOIN identities i ON i.user_id=u.id WHERE u.id=auth_tokens.user_id AND u.disabled=0 AND u.kind='user' AND i.provider='email' AND i.subject=auth_tokens.email)`)
   .bind(now,claim,tokenHash,now),
  db.prepare(`INSERT INTO passwords(user_id,hash,updated_at) SELECT ?,?,? WHERE ${gate}
   ON CONFLICT(user_id) DO UPDATE SET hash=excluded.hash,updated_at=excluded.updated_at`).bind(id,hash,now,tokenHash,claim),
  db.prepare(`DELETE FROM sessions WHERE user_id=? AND ${gate}`).bind(id,tokenHash,claim),
  db.prepare(`DELETE FROM login_fails WHERE user_id=? AND ${gate}`).bind(id,tokenHash,claim),
  db.prepare(`UPDATE auth_tokens SET used_at=? WHERE used_at IS NULL AND
   ((user_id=? AND kind IN ('reset','email','oauth_google','oauth_linuxdo','merge'))
    OR (kind='merge' AND CASE WHEN json_valid(payload) THEN json_extract(payload,'$.sourceId') END=?)) AND ${gate}`).bind(now,id,id,tokenHash,claim),
  db.prepare(`INSERT INTO sessions(id,user_id,expires_at,created_at,seen_at,method,ua) SELECT ?,?,?,?,?, 'email',? WHERE ${gate}`)
   .bind(sessionHash,id,now+2592000,now,now,userAgent.slice(0,120),tokenHash,claim),
 ])
 return result[0].meta.changes===1
}
