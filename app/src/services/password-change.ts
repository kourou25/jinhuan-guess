// 旧密码、邮箱、用户名、会话均使用快照守卫；成功后轮换当前会话。
export async function changePassword(db:D1Database,input:{id:number;email:string;username:string;oldHash:string;newHash:string;oldSession:string;newSession:string;ua:string;t:number}){
 const {id,email,username,oldHash,newHash,oldSession,newSession,ua,t}=input
 const tokenHash=crypto.randomUUID(),claim=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=? AND claim_id=?)'
 const result=await db.batch([
  db.prepare(`INSERT INTO auth_tokens(token_hash,kind,user_id,expires_at,used_at,claim_id,created_at)
   SELECT ?,'password-change',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND disabled=0 AND kind='user' AND username=?)
   AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>?)
   AND EXISTS(SELECT 1 FROM passwords WHERE user_id=? AND hash=?)
   AND EXISTS(SELECT 1 FROM identities WHERE user_id=? AND provider='email' AND subject=? AND verified_at IS NOT NULL)`)
   .bind(tokenHash,id,t+600,t,claim,t,id,username,oldSession,id,t,id,oldHash,id,email),
  db.prepare(`UPDATE passwords SET hash=?,updated_at=? WHERE user_id=? AND ${gate}`).bind(newHash,t,id,tokenHash,claim),
  db.prepare(`DELETE FROM sessions WHERE user_id=? AND ${gate}`).bind(id,tokenHash,claim),
  db.prepare(`DELETE FROM login_fails WHERE user_id=? AND ${gate}`).bind(id,tokenHash,claim),
  // merge由目标账号持有；源账号改密也必须撤销其授权，不能仅按user_id查找。
  db.prepare(`UPDATE auth_tokens SET used_at=? WHERE used_at IS NULL AND
   ((user_id=? AND kind IN ('reset','email','oauth_google','oauth_linuxdo','merge'))
    OR (kind='merge' AND CASE WHEN json_valid(payload) THEN json_extract(payload,'$.sourceId') END=?)) AND ${gate}`).bind(t,id,id,tokenHash,claim),
  db.prepare(`INSERT INTO sessions(id,user_id,expires_at,created_at,seen_at,method,ua) SELECT ?,?,?,?,?,'email',? WHERE ${gate}`).bind(newSession,id,t+2592000,t,t,ua.slice(0,120),tokenHash,claim),
 ])
 return result[0].meta.changes===1
}
