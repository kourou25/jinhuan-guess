// 密码计算期间邮箱可能被换绑；签发会话时再次检查身份和密码版本。
export async function startEmailSession(db:D1Database,input:{id:number;email:string;passwordHash:string;sessionHash:string;t:number;ua:string;ipHash:string}){
 const {id,email,passwordHash,sessionHash,t,ua,ipHash}=input
 const result=await db.batch([
  db.prepare(`INSERT INTO sessions(id,user_id,expires_at,created_at,seen_at,method,ua) SELECT ?,?,?,?,?, 'email',?
    WHERE EXISTS(SELECT 1 FROM users u JOIN passwords p ON p.user_id=u.id JOIN identities i ON i.user_id=u.id
      WHERE u.id=? AND u.disabled=0 AND u.kind='user' AND p.hash=? AND i.provider='email' AND i.subject=? AND i.verified_at IS NOT NULL)`)
    .bind(sessionHash,id,t+2592000,t,t,ua.slice(0,120),id,passwordHash,email),
  db.prepare('DELETE FROM login_fails WHERE user_id=? AND ip_hash=? AND EXISTS(SELECT 1 FROM sessions WHERE id=?)').bind(id,ipHash,sessionHash),
  db.prepare("UPDATE identities SET last_login_at=? WHERE user_id=? AND provider='email' AND EXISTS(SELECT 1 FROM sessions WHERE id=?)").bind(t,id,sessionHash),
 ])
 return result[0].meta.changes===1
}
