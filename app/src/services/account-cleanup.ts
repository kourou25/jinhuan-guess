// 仅删除账号临时记录；在 D1 内限制批量，不加载身份、内容或文件到 JS。
// WITHOUT ROWID 表用完整主键选择；一个 batch 失败时全部回滚，下次可安全重试。
export async function cleanupAccounts(db:D1Database,t:number){
  const day=new Date((t-60*86400)*1000).toISOString().slice(0,10)
  const result=await db.batch([
    db.prepare(`DELETE FROM sessions WHERE id IN (
      SELECT id FROM sessions WHERE expires_at<=? ORDER BY expires_at,id LIMIT 5000)`).bind(t),
    db.prepare(`DELETE FROM auth_tokens WHERE token_hash IN (
      SELECT token_hash FROM auth_tokens WHERE expires_at<=? ORDER BY expires_at,token_hash LIMIT 5000)`).bind(t),
    db.prepare(`DELETE FROM login_fails WHERE (user_id,ip_hash) IN (
      SELECT user_id,ip_hash FROM login_fails WHERE updated_at<? AND locked_until<=? ORDER BY updated_at,user_id,ip_hash LIMIT 5000)`).bind(t-86400,t),
    db.prepare(`DELETE FROM quota_usage WHERE (day,scope,key) IN (
      SELECT day,scope,key FROM quota_usage WHERE day<? OR (scope='login-failure' AND day<=?) ORDER BY day,scope,key LIMIT 5000)`).bind(day,new Date((t-3600)*1000).toISOString()),
    db.prepare(`DELETE FROM daily_post_views WHERE (user_id,day,meme_id) IN (
      SELECT user_id,day,meme_id FROM daily_post_views WHERE day<? ORDER BY day,user_id,meme_id LIMIT 5000)`)
      .bind(new Date((t-30*86400+8*3600)*1000).toISOString().slice(0,10)),
  ])
  return {sessions:result[0].meta.changes,tokens:result[1].meta.changes,failures:result[2].meta.changes,quotas:result[3].meta.changes,dailyViews:result[4].meta.changes}
}
