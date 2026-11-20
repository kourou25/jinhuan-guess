export type MergeEligibilityInput={targetId:number;sourceId:number;provider:'google'|'linuxdo';subject:string;now:number;ownerIds:number[]}
export type MergeEligibilityReason='ok'|'ineligible'|'identity_conflict'|'credentials'|'nonempty'|'assets'|'invitation_conflict'

// 每个用户关联列必须明确处理。MG05实施时复用此清单验收迁移/撤销，不能将清单视为已实现事务。
export const MERGE_RELATION_POLICY={
  farm_action_limits:{user_id:'block'},farm_market_accounts:{user_id:'block'},farm_market_lots:{owner_id:'block'},farm_market_receipts:{user_id:'block'},
  farm_conflict_members:{user_id:'block'},farm_conflict_stakes:{user_id:'block'},farm_conflict_budgets:{user_id:'block'},farm_conflicts:{attacker_id:'block',defender_id:'block'},farm_uprising_members:{user_id:'block'},farm_conflict_receipts:{user_id:'block'},farm_conflict_events:{user_id:'block',actor_id:'block'},
  huancai_usage:{user_id:'block'},huancai_orders:{user_id:'block'},huancai_tickets:{user_id:'block'},
  instant_card_progress:{user_id:'block'},instant_card_batches:{user_id:'block',owner_id:'block'},
  farm_loss_totals:{user_id:'block'},farm_lease_offers:{owner_id:'block'},farm_leases:{owner_id:'block',tenant_id:'block'},farm_lease_actions:{actor_id:'block'},
  content_coin_rewards:{user_id:'block'},
  activity_honor_events:{user_id:'block'},
  instant_card_pools:{owner_id:'block'},instant_card_fingers:{user_id:'block'},instant_card_receipts:{user_id:'block',owner_id:'block'},title_awards:{user_id:'block'},
  upload_operations:{user_id:'block'},
  farm_saves:{user_id:'empty-only'},
  farm_visits:{actor_id:'block',owner_id:'block'},
  farm_ranch_visits:{actor_id:'block',owner_id:'block'},
  farm_guest_visits:{actor_id:'clear',owner_id:'clear'},
  guess_reference_preparations:{user_id:'clear'},
  chat_message_favorites:{user_id:'block'},
  coin52_wallets:{user_id:'starter-only'},coin52_ledger:{user_id:'starter-only'},farm_migrations:{user_id:'starter-only'},
  coin52_packets:{owner_id:'block'},coin52_packet_slots:{recipient_id:'block'},
  web_push_subscriptions:{user_id:'revoke'},
  packet_luck_wins:{user_id:'block'},
  packet_sender_stats:{user_id:'block'},
  chat_activity_stats:{user_id:'block'},
  rank_placements:{user_id:'block'},
  guess_free_rounds:{owner_id:'block',winner_id:'block'},guess_free_questions:{user_id:'block'},guess_wins:{user_id:'block'},guess_room_messages:{user_id:'block'},
  packet_draw_entries:{user_id:'block'},packet_events:{user_id:'block'},packet_coin_escrows:{owner_id:'block'},fish_accounts:{user_id:'block'},ldc_accounts:{user_id:'block'},ldc_packets:{owner_id:'block'},ldc_awards:{recipient_id:'block'},ldc_questions:{user_id:'block'},
  ai_jobs:{user_id:'block'},anchors:{user_id:'clear'},api_tokens:{user_id:'revoke'},auth_tokens:{user_id:'revoke'},
  badge_log:{user_id:'clear'},chat_bans:{user_id:'block'},chat_boosts:{user_id:'block'},chat_groups:{created_by:'block'},
  chat_join_reqs:{user_id:'clear'},chat_members:{user_id:'membership'},chat_messages:{user_id:'system-join-only'},
  chat_reactions:{user_id:'block'},chat_sticker_favorites:{user_id:'block'},dm_threads:{user_low:'block',user_high:'block'},dm_messages:{sender_id:'block'},chat_redpack_external_views:{user_id:'block'},chat_redpack_opens:{user_id:'block'},
  chat_redpack_successes:{user_id:'block'},chat_title_raffles:{creator_id:'block',winner_id:'block'},chat_title_raffle_entries:{user_id:'block'},comments:{user_id:'block'},fav_folders:{user_id:'clear'},favorites:{user_id:'block'},
  identities:{user_id:'credentials'},invite_codes:{owner_id:'unused-only',used_by:'invitation'},
  invites:{invitee_id:'invitation',inviter_id:'block'},likes:{user_id:'block'},login_fails:{user_id:'clear'},memes:{author_id:'block'},
  notif_reads:{user_id:'clear',actor_id:'clear'},official_title_log:{user_id:'block',actor_id:'block'},passwords:{user_id:'credentials'},
  puzzle_attempts:{user_id:'block'},puzzle_codes:{claimed_by:'block'},puzzles:{creator_id:'block'},quota_usage:{key:'preserve-user-quota'},
  reactions:{user_id:'block'},road_comments:{user_id:'block'},road_items:{user_id:'block'},road_votes:{user_id:'block'},
  sessions:{user_id:'revoke'},short_replies:{user_id:'block'},uploads:{user_id:'block'},user_badges:{user_id:'clear'},
  user_limits:{user_id:'block',by_id:'block'},user_official_titles:{user_id:'block',granted_by:'block'},user_unlocks:{user_id:'block'},
  users:{id:'retire',invited_by:'invitation'},view_days:{user_id:'clear'},views:{user_id:'clear'},daily_post_views:{user_id:'clear'},
} as const

const contentTables:Record<string,string>={guess_free_rounds:'owner_id',guess_room_messages:'user_id',memes:'author_id',comments:'user_id',chat_boosts:'user_id',road_items:'user_id',
  road_comments:'user_id',short_replies:'user_id',reactions:'user_id',chat_reactions:'user_id',likes:'user_id',
  favorites:'user_id',chat_sticker_favorites:'user_id',road_votes:'user_id',chat_groups:'created_by',invites:'inviter_id',dm_messages:'sender_id'}
const assetsTables:Record<string,string>={rank_placements:'user_id',chat_activity_stats:'user_id',packet_sender_stats:'user_id',packet_luck_wins:'user_id',guess_free_rounds:'winner_id',guess_free_questions:'user_id',guess_wins:'user_id',packet_draw_entries:'user_id',packet_events:'user_id',packet_coin_escrows:'owner_id',fish_accounts:'user_id',ldc_accounts:'user_id',ldc_packets:'owner_id',ldc_awards:'recipient_id',ldc_questions:'user_id',uploads:'user_id',ai_jobs:'user_id',puzzle_attempts:'user_id',puzzle_codes:'claimed_by',
  puzzles:'creator_id',chat_redpack_external_views:'user_id',chat_redpack_opens:'user_id',chat_redpack_successes:'user_id',chat_title_raffle_entries:'user_id',user_unlocks:'user_id'}
// 平衡OR树保留短路点查，避免线性链的深度和UNION分支数限制。
export function mergeAnySql(parts:string[]):string{
 if(parts.length===0)return '0'
 if(parts.length===1)return parts[0]
 const middle=Math.floor(parts.length/2)
 return `(${mergeAnySql(parts.slice(0,middle))} OR ${mergeAnySql(parts.slice(middle))})`
}
const existsAny=(tables:Record<string,string>)=>mergeAnySql(Object.entries(tables).map(([table,column])=>`EXISTS(SELECT 1 FROM ${table} WHERE ${column}=b.id)`))
assetsTables.upload_operations='user_id'
assetsTables.farm_market_accounts='user_id';assetsTables.farm_conflict_members='user_id'
assetsTables.huancai_usage='user_id';assetsTables.huancai_orders='user_id';assetsTables.huancai_tickets='user_id'
assetsTables.instant_card_progress='user_id';assetsTables.instant_card_batches='user_id'
assetsTables.farm_loss_totals='user_id';assetsTables.farm_lease_offers='owner_id';assetsTables.farm_leases='owner_id';assetsTables.farm_lease_actions='actor_id'
assetsTables.activity_honor_events='user_id'
contentTables.chat_message_favorites='user_id'
assetsTables.instant_card_fingers='user_id';assetsTables.instant_card_receipts='user_id';assetsTables.instant_card_pools='owner_id';assetsTables.title_awards='user_id'
assetsTables.coin52_packets='owner_id';assetsTables.coin52_packet_slots='recipient_id'

// 单条只读查询；最终事务可将同一SQL作为标量子查询嵌入claim门槛，避免仅在HTTP预检。
// 只使用6个绑定参数，防止关联表增长耗尽D1参数预算。
export function mergeEligibilityQuery(input:MergeEligibilityInput):{sql:string;args:(string|number)[]}{
  if(![input.targetId,input.sourceId].every(id=>Number.isSafeInteger(id)&&id!==0)
    ||!Number.isSafeInteger(input.now)||input.now<=0||!['google','linuxdo'].includes(input.provider)
    ||typeof input.subject!=='string'||!input.subject.length||input.subject.length>255
    ||!Array.isArray(input.ownerIds)||!input.ownerIds.every(id=>Number.isSafeInteger(id)&&id!==0))throw new TypeError('invalid_merge_input')
  return {sql:`WITH merge_input AS (SELECT ? AS target,? AS source,? AS t,? AS provider,? AS subject,? AS owners)
    SELECT CASE
    WHEN a.id IS NULL OR b.id IS NULL OR a.id=b.id OR a.disabled<>0 OR b.disabled<>0 OR a.kind<>'user' OR b.kind<>'user'
      OR b.created_at<=x.t-2592000 OR b.created_at>x.t OR b.created_at<=0
      OR b.role IS NOT NULL AND b.role<>'' OR b.is_admin<>0 OR b.silenced<>0
      OR EXISTS(SELECT 1 FROM json_each(x.owners) WHERE value=b.id)
      OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN (a.id,b.id))
      OR EXISTS(SELECT 1 FROM chat_bans WHERE user_id=b.id)
      OR EXISTS(SELECT 1 FROM user_limits WHERE user_id=b.id OR by_id=b.id) THEN 'ineligible'
    WHEN NOT EXISTS(SELECT 1 FROM identities WHERE user_id=b.id AND provider=x.provider AND subject=x.subject)
      OR NOT EXISTS(SELECT 1 FROM identities WHERE user_id=a.id)
      OR EXISTS(SELECT 1 FROM identities WHERE user_id IN (a.id,b.id) AND (provider NOT IN ('google','linuxdo','email') OR subject=''))
      OR EXISTS(SELECT 1 FROM identities WHERE user_id IN (a.id,b.id) GROUP BY user_id,provider HAVING COUNT(*)>1)
      OR EXISTS(SELECT 1 FROM identities ia JOIN identities ib ON ia.provider=ib.provider WHERE ia.user_id=a.id AND ib.user_id=b.id)
      THEN 'identity_conflict'
    WHEN EXISTS(SELECT 1 FROM users u WHERE u.id IN (a.id,b.id) AND (
      EXISTS(SELECT 1 FROM passwords WHERE user_id=u.id) <> EXISTS(SELECT 1 FROM identities WHERE user_id=u.id AND provider='email')
      OR EXISTS(SELECT 1 FROM identities WHERE user_id=u.id AND provider='email' AND (verified_at IS NULL OR verified_at>x.t OR email IS NOT subject))
      OR EXISTS(SELECT 1 FROM passwords WHERE user_id=u.id AND (hash='' OR updated_at>x.t))
    )) THEN 'credentials'
    WHEN ${existsAny(contentTables)}
      OR EXISTS(SELECT 1 FROM dm_threads WHERE user_low=b.id OR user_high=b.id)
      OR EXISTS(SELECT 1 FROM invite_codes WHERE owner_id=b.id AND used_by IS NOT NULL)
      OR EXISTS(SELECT 1 FROM users WHERE invited_by=b.id)
      OR EXISTS(SELECT 1 FROM chat_messages WHERE user_id=b.id AND NOT (
        system_kind IS 'join' AND body='加入了群聊' AND image_key IS NULL AND media IS NULL AND reply_to IS NULL
        AND meme_id IS NULL AND redpack_id IS NULL AND edited_at IS NULL AND system_ref IS NULL)) THEN 'nonempty'
    WHEN ${existsAny(assetsTables)}
      OR EXISTS(SELECT 1 FROM farm_leases WHERE tenant_id=b.id)
      OR EXISTS(SELECT 1 FROM instant_card_batches WHERE owner_id=b.id)
      OR EXISTS(SELECT 1 FROM content_coin_rewards WHERE user_id=b.id)
      OR EXISTS(SELECT 1 FROM farm_saves WHERE user_id=b.id AND revision>0)
      OR EXISTS(SELECT 1 FROM farm_visits WHERE actor_id=b.id OR owner_id=b.id)
      OR EXISTS(SELECT 1 FROM farm_ranch_visits WHERE actor_id=b.id OR owner_id=b.id)
      OR EXISTS(SELECT 1 FROM coin52_ledger WHERE user_id=b.id AND kind<>'farm-import')
      OR EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=b.id AND balance<>40)
      OR EXISTS(SELECT 1 FROM auth_tokens WHERE kind='ai-quota' AND expires_at>x.t AND (
        user_id=b.id OR (user_id IS NULL AND CASE WHEN json_valid(payload) THEN json_extract(payload,'$.uid') END IS NOT 0)))
      OR EXISTS(SELECT 1 FROM user_official_titles WHERE user_id=b.id OR granted_by=b.id)
      OR EXISTS(SELECT 1 FROM chat_title_raffles WHERE creator_id=b.id OR winner_id=b.id)
      OR EXISTS(SELECT 1 FROM official_title_log WHERE user_id=b.id OR actor_id=b.id) THEN 'assets'
    WHEN b.invited_by IS NOT (SELECT inviter_id FROM invites WHERE invitee_id=b.id)
      OR a.invited_by IS NOT (SELECT inviter_id FROM invites WHERE invitee_id=a.id)
      OR EXISTS(SELECT 1 FROM invites i WHERE i.invitee_id=b.id AND (
        i.inviter_id IN (a.id,b.id) OR NOT EXISTS(SELECT 1 FROM users WHERE id=i.inviter_id)
        OR NOT EXISTS(SELECT 1 FROM invite_codes c WHERE c.code=i.code AND c.owner_id=i.inviter_id AND c.used_by=b.id)
        OR ((i.qualified_at IS NOT NULL OR i.revoked<>0) AND EXISTS(SELECT 1 FROM invites WHERE invitee_id=a.id))))
      OR EXISTS(SELECT 1 FROM invite_codes c WHERE c.used_by=b.id AND NOT EXISTS(SELECT 1 FROM invites i WHERE i.invitee_id=b.id AND i.code=c.code AND i.inviter_id=c.owner_id))
      THEN 'invitation_conflict'
    ELSE 'ok' END AS reason FROM merge_input x LEFT JOIN users a ON a.id=x.target LEFT JOIN users b ON b.id=x.source`,
    args:[input.targetId,input.sourceId,input.now,input.provider,input.subject,JSON.stringify(input.ownerIds)]}
}
export async function checkMergeEligibility(db:D1Database,input:MergeEligibilityInput){
  const query=mergeEligibilityQuery(input)
  return (await db.prepare(query.sql).bind(...query.args).first<{reason:MergeEligibilityReason}>())?.reason??'ineligible'
}
