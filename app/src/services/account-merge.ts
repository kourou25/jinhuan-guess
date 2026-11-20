import {readMergeConfirmation} from './account-merge-token'
import {MERGE_RELATION_POLICY,mergeAnySql} from './account-merge-eligibility'

type MergeInput={targetId:number;tokenHash:string;now:number;ownerIds:number[];newSessionHash:string;ua:string;
 enabledProviders:string[];proof:{sessionHash:string;passwordHash:string|null;method:string|null}}

// 全部关系处理、凭据转移、退休记录和会话轮换在一个D1事务内。
export async function completeAccountMerge(db:D1Database,input:MergeInput){
 const {targetId:a,tokenHash,now:t,proof}=input
 const pending=await readMergeConfirmation(db,{targetId:a,tokenHash,now:t,ownerIds:input.ownerIds,sessionHash:proof.sessionHash})
 if(!pending||!input.enabledProviders.includes(pending.payload.provider))return false
 const b=pending.payload.sourceId,claim=crypto.randomUUID()
 const gate='EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=? AND claim_id=?)'
 const statements:D1PreparedStatement[]=[]
 const add=(sql:string,args:unknown[]=[])=>statements.push(db.prepare(sql).bind(...args,tokenHash,claim))
 statements.push(db.prepare(`UPDATE auth_tokens SET used_at=?,claim_id=? WHERE token_hash=?
   AND (${pending.query.sql})=1 AND COALESCE((SELECT hash FROM passwords WHERE user_id=?),'')=?
   AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>?
     AND (? IS NULL OR (method=? AND created_at>=? AND created_at<=?
       AND EXISTS(SELECT 1 FROM identities WHERE user_id=? AND provider=?))))`)
  .bind(t,claim,tokenHash,...pending.query.args,a,proof.passwordHash??'',proof.sessionHash,a,t,
   proof.method,proof.method,t-300,t,a,proof.method))
 add(`UPDATE users SET disabled=2 WHERE id=? AND ${gate}`,[b])
 add(`UPDATE identities SET user_id=? WHERE user_id=? AND ${gate}`,[a,b])
 add(`UPDATE passwords SET user_id=? WHERE user_id=? AND ${gate}`,[a,b])
 add(`INSERT INTO quota_usage(day,scope,key,n) SELECT day,scope,?,n FROM quota_usage
   WHERE key=? AND key<>0 AND scope NOT GLOB 'tok:*' AND ${gate}
   ON CONFLICT(day,scope,key) DO UPDATE SET n=MIN(9007199254740991,MAX(0,quota_usage.n)+MAX(0,excluded.n))`,[a,b])
 add(`DELETE FROM quota_usage WHERE key=? AND key<>0 AND scope NOT GLOB 'tok:*' AND ${gate}`,[b])
 add(`DELETE FROM quota_usage WHERE scope GLOB 'tok:*' AND key IN(SELECT id FROM api_tokens WHERE user_id=?) AND ${gate}`,[b])
 add(`DELETE FROM api_tokens WHERE user_id=? AND ${gate}`,[b])
 add(`UPDATE invites SET invitee_id=? WHERE invitee_id=? AND NOT EXISTS(SELECT 1 FROM invites WHERE invitee_id=?) AND ${gate}`,[a,b,a])
 add(`DELETE FROM invites WHERE invitee_id=? AND ${gate}`,[b])
 add(`UPDATE users SET invited_by=(SELECT inviter_id FROM invites WHERE invitee_id=?) WHERE id=? AND ${gate}`,[a,a])
 add(`UPDATE invite_codes SET used_by=? WHERE used_by=? AND ${gate}`,[a,b])
 add(`DELETE FROM invite_codes WHERE owner_id=? AND used_by IS NULL AND ${gate}`,[b])
 add(`UPDATE chat_messages SET user_id=?,updated_at=? WHERE user_id=? AND ${gate}`,[a,t,b])
 // 合并门槛只允许未经营的初始农场及其40币初始化记录；经营、转账、补偿均阻止合并。
 // 清除空账号初始化记录，沿用目标账号资产，不叠加两份新手赠币。
 for(const table of ['coin52_ledger','farm_migrations','coin52_wallets','farm_saves'])
  add(`DELETE FROM ${table} WHERE user_id=? AND ${gate}`,[b])
 for(const table of ['chat_members','chat_join_reqs','anchors','fav_folders','views','view_days','daily_post_views','badge_log','user_badges','login_fails'])
  add(`DELETE FROM ${table} WHERE user_id=? AND ${gate}`,[b])
 add(`DELETE FROM notif_reads WHERE (user_id=? OR actor_id=?) AND ${gate}`,[b,b])
 add(`DELETE FROM farm_guest_visits WHERE (owner_id=? OR actor_id=?) AND ${gate}`,[b,b])
 add(`DELETE FROM guess_reference_preparations WHERE user_id=? AND ${gate}`,[b])
 add(`DELETE FROM sessions WHERE user_id IN (?,?) AND ${gate}`,[a,b])
 add(`UPDATE auth_tokens SET used_at=? WHERE used_at IS NULL AND
   ((user_id=? AND kind IN ('email','reset','oauth_google','oauth_linuxdo','merge'))
     OR (kind='merge' AND CASE WHEN json_valid(payload) THEN json_extract(payload,'$.sourceId') END IN (?,?))) AND ${gate}`,[t,a,a,b])
 add(`DELETE FROM auth_tokens WHERE user_id=? AND ${gate}`,[b])
 // 清单驱动的最终断言。0025的target_id<>source_id CHECK与trg_retirement_claim
 // 均拒绝自指向退休；残留引用故意选择source_id，触发SQL错误回滚整个batch。
 const residualQueries=Object.entries(MERGE_RELATION_POLICY).flatMap(([table,columns])=>Object.keys(columns)
  .filter(column=>!(table==='users'&&column==='id'))
  .map(column=>`EXISTS(SELECT 1 FROM ${table} WHERE ${column}=?1${table==='quota_usage'?" AND key<>0 AND scope NOT GLOB 'tok:*'":''})`))
 const residual=mergeAnySql(residualQueries)
 statements.push(db.prepare(`INSERT INTO account_retirements(source_id,target_id,retired_at)
   SELECT ?1,CASE WHEN ${residual} THEN ?1 ELSE ?2 END,?3 WHERE
   EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=?4 AND claim_id=?5)`).bind(b,a,t,tokenHash,claim))
 add(`DELETE FROM users WHERE id=? AND disabled=2 AND ${gate}`,[b])
 add(`INSERT INTO sessions(id,user_id,expires_at,created_at,seen_at,method,ua)
   SELECT ?,?,?,?,?,?,? WHERE ${gate}`,[input.newSessionHash,a,t+2592000,t,t,proof.method??'email',input.ua.slice(0,120)])
 const result=await db.batch(statements)
 return result[0].meta.changes===1&&result.at(-2)!.meta.changes===1&&result.at(-1)!.meta.changes===1
}
