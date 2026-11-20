// HTTP 层负责输入校验、Origin 和门控。随机 claim 将用户名及作者快照绑定为一个事务。
export async function changeHandle(db:D1Database,id:number,sessionHash:string,handle:string,t:number){
 const claim=crypto.randomUUID(),token='handle:'+claim
 const claimed='EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=? AND claim_id=?)'
 const result=await db.batch([
  db.prepare(`INSERT INTO auth_tokens(token_hash,kind,user_id,claim_id,used_at,created_at,expires_at)
   SELECT ?,'handle',id,?,?,?,? FROM users WHERE id=? AND disabled=0 AND kind='user'
   AND username<>? COLLATE BINARY
   AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=users.id AND expires_at>?)
   AND NOT EXISTS(SELECT 1 FROM identities WHERE user_id=users.id AND provider='linuxdo')
   AND (handle_setup_pending=1 OR handle_at IS NULL OR handle_at<=?)
   AND NOT EXISTS(SELECT 1 FROM users other WHERE other.id<>users.id AND other.username=? COLLATE NOCASE)
   AND NOT EXISTS(SELECT 1 FROM memes WHERE author_id IS NULL AND author_name=? COLLATE NOCASE)`)
   .bind(token,claim,t,t,t+600,id,handle,sessionHash,t,t-2592000,handle,handle),
  db.prepare(`UPDATE users SET username=?,handle_at=CASE WHEN handle_setup_pending=1 THEN handle_at ELSE ? END,
   handle_setup_pending=0,updated_at=? WHERE id=? AND ${claimed}`).bind(handle,t,t,id,token,claim),
  db.prepare(`UPDATE memes SET author_name=? WHERE author_id=? AND ${claimed}`).bind(handle,id,token,claim),
 ])
 if(result[0].meta.changes===1)return {status:'ok' as const}
 const user=await db.prepare(`SELECT username,handle_at,handle_setup_pending,
  EXISTS(SELECT 1 FROM identities WHERE user_id=users.id AND provider='linuxdo') AS linuxdo
  FROM users WHERE id=? AND disabled=0 AND kind='user'
  AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=users.id AND expires_at>?)`).bind(id,sessionHash,t)
  .first<{username:string;handle_at:number|null;handle_setup_pending:number;linuxdo:number}>()
 if(!user)return {status:'session' as const}
 if(user.linuxdo)return {status:'linuxdo' as const}
 if(user.username===handle)return {status:'ok' as const}
 if(!user.handle_setup_pending&&user.handle_at!==null&&user.handle_at>t-2592000)return {status:'cooldown' as const}
 return {status:'taken' as const}
}
