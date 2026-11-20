export const guideLevel=(n:number)=>n>=30?4:n>=10?3:n>=3?2:n>=1?1:0
const level=(n:string)=>`CASE WHEN ${n}>=30 THEN 4 WHEN ${n}>=10 THEN 3 WHEN ${n}>=3 THEN 2 WHEN ${n}>=1 THEN 1 ELSE 0 END`

// 每条语句重新读同一事务内的关系数，不以服务层快照累加。最多 40 个邀请人、7 条写入。
export function rewardStatements(db:D1Database,ids:number[],t:number){
 if(!ids.length)return []
 const scope=[...new Set(ids)].slice(0,40),day=new Date((t+28800)*1000).toISOString().slice(0,10)
 const counts=`WITH counts AS (SELECT id AS uid,(SELECT COUNT(*) FROM invites WHERE inviter_id=users.id AND qualified_at IS NOT NULL AND revoked=0) AS n
  FROM users WHERE id IN (${scope.map(()=>'?').join(',')}) AND kind='user')`
 const statement=(sql:string,...tail:unknown[])=>db.prepare(counts+' '+sql).bind(...scope,...tail)
 return [
  statement(`INSERT INTO badge_log(user_id,badge,day,at) SELECT uid,'guide',?,? FROM counts c
   LEFT JOIN user_badges b ON b.user_id=c.uid AND b.badge='guide'
   WHERE ${level('c.n')}<>${level('COALESCE(b.n,0)')}
   ON CONFLICT(user_id,badge,day) DO UPDATE SET at=excluded.at`,day,t),
  statement(`INSERT INTO user_badges(user_id,badge,n,first_at,last_day) SELECT uid,'guide',n,?,? FROM counts WHERE n>0
   ON CONFLICT(user_id,badge) DO UPDATE SET n=excluded.n,last_day=CASE WHEN user_badges.n<>excluded.n THEN excluded.last_day ELSE user_badges.last_day END`,t,day),
  statement(`DELETE FROM user_badges WHERE badge='guide' AND user_id IN(SELECT uid FROM counts WHERE n=0)`),
  statement(`INSERT OR IGNORE INTO user_unlocks(user_id,item,at) SELECT uid,'title:guangjie',? FROM counts WHERE n>=3`,t),
  statement(`INSERT OR IGNORE INTO user_unlocks(user_id,item,at) SELECT uid,'bubble:yinlu',? FROM counts WHERE n>=10`,t),
  statement(`UPDATE users SET deco=CASE WHEN (SELECT n FROM counts WHERE uid=users.id)>0
   THEN json_set(deco,'$.bn',(SELECT n FROM counts WHERE uid=users.id)) ELSE json_remove(deco,'$.bd','$.bn') END
   WHERE id IN(SELECT uid FROM counts) AND json_valid(deco) AND json_extract(deco,'$.bd')='guide'`),
 ]
}

export async function settleInviteRewards(db:D1Database,t:number){
 // A4：内容可在注册后的任一天产生，七日条件只约束活跃时间；已删/隐藏内容不计。
 const qualified=await db.prepare(`UPDATE invites SET qualified_at=?1 WHERE invitee_id IN(
  SELECT i.invitee_id FROM invites i JOIN users u ON u.id=i.invitee_id
  WHERE i.qualified_at IS NULL AND i.revoked=0 AND i.created_at BETWEEN ?1-2592000 AND ?1-604800
   AND u.disabled=0 AND u.kind='user' AND u.last_seen>=u.created_at+604800 AND u.last_seen<=?1
   AND (EXISTS(SELECT 1 FROM memes m WHERE m.author_id=u.id AND m.hidden=0 AND m.created_at BETWEEN u.created_at AND ?1)
    OR EXISTS(SELECT 1 FROM comments c JOIN memes m ON m.id=c.meme_id WHERE c.user_id=u.id AND c.deleted=0 AND m.hidden=0 AND c.created_at BETWEEN u.created_at AND ?1)
    OR EXISTS(SELECT 1 FROM chat_messages m WHERE m.user_id=u.id AND m.deleted=0 AND m.system_kind IS NULL AND m.created_at BETWEEN u.created_at AND ?1)
    OR EXISTS(SELECT 1 FROM short_replies r JOIN memes m ON m.id=r.meme_id WHERE r.user_id=u.id AND m.hidden=0 AND r.created_at BETWEEN u.created_at AND ?1))
  ORDER BY i.created_at,i.invitee_id LIMIT 200)`).bind(t).run()
 // 中断后按实际关系与徽章差异接续，资格写入成功不等于奖励已写入。
 const pending=await db.prepare(`SELECT uid FROM (
  SELECT i.inviter_id AS uid,COUNT(*) AS n FROM invites i WHERE i.qualified_at IS NOT NULL AND i.revoked=0 GROUP BY i.inviter_id
  UNION ALL SELECT b.user_id AS uid,0 AS n FROM user_badges b WHERE b.badge='guide'
 ) x GROUP BY uid HAVING MAX(n)<>COALESCE((SELECT n FROM user_badges WHERE user_id=x.uid AND badge='guide'),0)
 ORDER BY uid LIMIT 40`).all<{uid:number}>()
 const statements=rewardStatements(db,pending.results.map(x=>x.uid),t)
 if(statements.length)await db.batch(statements)
 return {qualified:qualified.meta.changes,rewarded:pending.results.length}
}
