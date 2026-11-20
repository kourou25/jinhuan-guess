import { raffleTitleEnabled, enabledRaffleSql } from './shared/raffle-policy'
import {drawPaidTitle,titleLevelSql} from './title-growth'
export { raffleTitleEnabled } from './shared/raffle-policy'
import {TITLE_COLLECTION,TITLE_MAX_LEVEL} from './shared/title-collection'
export const RAFFLE_TITLES=TITLE_COLLECTION
export type RaffleTitleId = typeof RAFFLE_TITLES[number]['id']
export const raffleTitleId = (raw: unknown): RaffleTitleId | null =>
  typeof raw === 'string' && RAFFLE_TITLES.some(t => t.id === raw) ? raw as RaffleTitleId : null

// 只在打开装扮/站长授予页时读取；中奖索引和 user_unlocks 主键均以用户开头。
export async function ownedRaffleTitles(db: D1Database, uid: number) {
  const {results} = await db.prepare(`SELECT title,SUM(wins) AS wins,MAX(granted) AS granted FROM (
    SELECT title,COUNT(*) AS wins,0 AS granted FROM chat_title_raffles WHERE winner_id=? AND status='drawn' GROUP BY title
    UNION ALL SELECT substr(item,8) AS title,0 AS wins,1 AS granted FROM user_unlocks WHERE user_id=? AND item LIKE 'raffle:%'
    UNION ALL SELECT title,SUM(levels) AS wins,0 AS granted FROM title_awards WHERE user_id=? GROUP BY title
  ) GROUP BY title`).bind(uid,uid,uid).all<{title:string;wins:number;granted:number}>()
  const trials=(await db.prepare('SELECT title,level,expires_at FROM title_trials WHERE user_id=? AND expires_at>?').bind(uid,Math.floor(Date.now()/1000)).all<{title:string;level:number;expires_at:number}>()).results
  for(const trial of trials)if(!results.some(x=>x.title===trial.title))results.push({title:trial.title,wins:0,granted:0})
  return results.flatMap(row => {
    const title=RAFFLE_TITLES.find(t=>t.id===row.title),trial=trials.find(t=>t.title===row.title),permanent=Math.min(TITLE_MAX_LEVEL,row.wins+row.granted)
    return title ? [{...title,wins:row.wins,granted:!!row.granted,permanent_level:permanent,trial_level:trial?.level??0,expires_at:trial?.expires_at??null,level:Math.max(permanent,trial?.level??0)}] : []
  })
}

type Due = { id: string; title: RaffleTitleId; entry_mode: 'optin' | 'all'; creator_id: number;paid_version:number }

// 每分钟至多结算一场。候选预选后，资格、状态和发奖在同一 D1 batch 中重核。
export async function drawDueTitleRaffle(db: D1Database, at: number, onlyId?: string): Promise<'none' | 'drawn' | 'empty' | 'retry'> {
  const due = await db.prepare(`SELECT id,title,entry_mode,creator_id,paid_version FROM chat_title_raffles WHERE (status='open' OR paid_version=1 AND status='closing') AND ${enabledRaffleSql()} AND closes_at<=? AND (? IS NULL OR id=?) ORDER BY closes_at,id LIMIT 1`)
    .bind(at,onlyId || null,onlyId || null).first<Due>()
  if (!due) return 'none'
  if(due.paid_version===1)return drawPaidTitle(db,due.id,at)
  const eligible = `SELECT 1 FROM chat_members cm JOIN users u ON u.id=cm.user_id
    WHERE cm.group_id=1 AND cm.user_id=? AND u.kind='user' AND u.disabled=0
      AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.group_id=1 AND b.user_id=u.id)
      AND NOT EXISTS(SELECT 1 FROM account_retirements ar WHERE ar.source_id=u.id)
      AND ((?='all' AND u.last_seen>=?) OR (?='optin' AND EXISTS(
        SELECT 1 FROM chat_title_raffle_entries e WHERE e.raffle_id=? AND e.user_id=u.id)))`
  const candidate = await db.prepare(`SELECT u.id FROM users u JOIN chat_members cm ON cm.user_id=u.id AND cm.group_id=1
    WHERE u.kind='user' AND u.disabled=0
      AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.group_id=1 AND b.user_id=u.id)
      AND NOT EXISTS(SELECT 1 FROM account_retirements ar WHERE ar.source_id=u.id)
      AND ((${due.entry_mode === 'all' ? 'u.last_seen>=?' : 'EXISTS(SELECT 1 FROM chat_title_raffle_entries e WHERE e.raffle_id=? AND e.user_id=u.id)' }))
    ORDER BY RANDOM() LIMIT 1`).bind(due.entry_mode === 'all' ? at - 86400 : due.id).first<{ id: number }>()
  const token = crypto.randomUUID()
  const title = RAFFLE_TITLES.find(t => t.id === due.title)!.name
  if (!candidate) {
    const [claim] = await db.batch([
      db.prepare(`UPDATE chat_title_raffles SET status='empty',claim_token=?,drawn_at=? WHERE id=? AND status='open' AND closes_at<=?
        AND NOT EXISTS(SELECT 1 FROM chat_members cm JOIN users u ON u.id=cm.user_id WHERE cm.group_id=1
          AND u.kind='user' AND u.disabled=0 AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.group_id=1 AND b.user_id=u.id)
          AND NOT EXISTS(SELECT 1 FROM account_retirements ar WHERE ar.source_id=u.id)
          AND ((entry_mode='all' AND u.last_seen>=?) OR (entry_mode='optin' AND EXISTS(
            SELECT 1 FROM chat_title_raffle_entries e WHERE e.raffle_id=chat_title_raffles.id AND e.user_id=u.id))))`)
        .bind(token, at, due.id, at, at - 86400),
      db.prepare(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
        SELECT 1,creator_id,?, ?,?,'title_raffle',id FROM chat_title_raffles WHERE id=? AND status='empty' AND claim_token=?`)
        .bind(`${title}开奖：这次没人报名，下次再来！`, at, at, due.id, token),
    ])
    return claim.meta.changes ? 'empty' : 'retry'
  }
  const uid = candidate.id
  const [claim] = await db.batch([
    db.prepare(`UPDATE chat_title_raffles SET status='closing',winner_id=?,claim_token=?
      WHERE id=? AND status='open' AND closes_at<=? AND EXISTS(${eligible})`)
      .bind(uid, token, due.id, at, uid, due.entry_mode, at - 86400, due.entry_mode, due.id),
      db.prepare(`UPDATE users SET deco=json_set(COALESCE(deco,'{}'),'$.fn',${titleLevelSql('users.id','?1',true)}),updated_at=?2
      WHERE id=?3 AND json_extract(deco,'$.ft')=?1
        AND EXISTS(SELECT 1 FROM chat_title_raffles r WHERE r.id=?4 AND r.status='closing' AND r.claim_token=?5 AND r.winner_id=users.id)`)
      .bind(due.title, at, uid, due.id, token),
    db.prepare(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
      SELECT 1,r.creator_id,?, ?,?,'title_raffle',r.id FROM chat_title_raffles r
      WHERE r.id=? AND r.status='closing' AND r.claim_token=? AND r.winner_id=?`)
      .bind(`${title}开奖啦！`, at, at, due.id, token, uid),
    db.prepare(`UPDATE chat_title_raffles SET status='drawn',drawn_at=?
      WHERE id=? AND status='closing' AND claim_token=? AND winner_id=?
        AND EXISTS(SELECT 1 FROM chat_messages WHERE system_kind='title_raffle' AND system_ref=?)`)
      .bind(at, due.id, token, uid, due.id),
  ])
  return claim.meta.changes ? 'drawn' : 'retry'
}
