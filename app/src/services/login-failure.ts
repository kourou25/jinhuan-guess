// 秒级桶用于滚动一小时统计；每账号最多保留 51 个桶，足以判断是否超过 50 次。
// 使用现有 quota_usage 主键，不保存邮箱、明文 IP 或密码。锁定仍只作用于账号 + IP。
export async function recordLoginFailure(db:D1Database,userId:number,ipHash:string,t:number){
 const stamp=new Date(t*1000).toISOString(),cutoff=new Date((t-3600)*1000).toISOString()
 await db.batch([
  db.prepare(`INSERT INTO login_fails(user_id,ip_hash,fails,locked_until,updated_at) VALUES(?,?,1,0,?)
   ON CONFLICT(user_id,ip_hash) DO UPDATE SET fails=CASE WHEN updated_at<?3-86400 THEN 1 ELSE fails+1 END,
   locked_until=CASE WHEN updated_at<?3-86400 THEN 0 WHEN fails+1>=10 THEN ?3+3600 WHEN fails+1>=5 THEN ?3+900 ELSE 0 END,updated_at=?3`).bind(userId,ipHash,t),
  db.prepare(`INSERT INTO quota_usage(day,scope,key,n) VALUES(?,'login-failure',?,1)
   ON CONFLICT(day,scope,key) DO UPDATE SET n=MIN(n+1,51)`).bind(stamp,userId),
  db.prepare(`DELETE FROM quota_usage WHERE scope='login-failure' AND key=?1 AND (day<=?2 OR day IN (
   SELECT day FROM quota_usage WHERE scope='login-failure' AND key=?1 ORDER BY day DESC LIMIT -1 OFFSET 51))`).bind(userId,cutoff),
 ])
}
