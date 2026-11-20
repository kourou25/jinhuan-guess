import {cleanPacketSnapshot} from './redpacket-status'

export function publicPacketDraw(b: ReturnType<typeof cleanPacketSnapshot>) {
  if (!['lottery','timed_draw'].includes(b.kind) || !b.draw_at) return null
  return {kind:b.kind,draw_at:b.draw_at,draw_deadline:b.draw_deadline,draw_complete:b.draw_complete,
    participant_count:b.participant_count,winner_count:b.winner_count,
    winners:b.winners,roster_more:b.roster_more,roster_error:b.roster_error}
}
export function drawNotice(d: NonNullable<ReturnType<typeof publicPacketDraw>>, provider: string, reporter: string) {
  const platform = provider === 'hb' ? 'HB' : 'Fish'
  const winners = d.winners.slice(0,30).map(p=>p.name+(p.amount ? ` ${p.amount} LDC` : '')+(p.payout==='pending'?'（待发放）':''))
  const result = winners.length ? '中奖：'+winners.join('、')+(d.winner_count!=null&&d.winner_count>winners.length?'等；完整结果见红包详情':'') :
    d.winner_count===0 ? '本轮无人中奖' : '中奖名单未公开，请查看本人结果'
  return `${reporter.replace(/[\p{Cc}\p{Cf}]/gu,'').slice(0,60)} 同步的 ${platform} 开奖结果：${result}\n发包者连接器回报，非本站验签；到账以平台为准。`
}
// 只由用户查询得到的公开字段更新共享摘要；不复制本人领取状态。
export function drawSyncStatements(db: D1Database, p: {id:string;message_id:number;provider:string}, d: NonNullable<ReturnType<typeof publicPacketDraw>>, reporter: string, at: number) {
  const done = d.draw_complete && !d.roster_error && d.draw_at <= at
  return [
    db.prepare(`UPDATE chat_redpacks SET draw_data=?,draw_synced_at=?,notify_at=COALESCE(notify_at,?)
      WHERE id=? AND (draw_announced_at IS NULL OR ?=1)`).bind(JSON.stringify(d),at,d.draw_at,p.id,done?1:0),
    ...(done ? [
      db.prepare(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
        SELECT m.group_id,m.user_id,?, ?,?,'redpack_draw',CAST(m.id AS TEXT)
        FROM chat_messages m JOIN chat_redpacks p ON p.message_id=m.id
        WHERE p.id=? AND m.deleted=0
        ON CONFLICT DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at WHERE chat_messages.system_kind='redpack_draw' AND chat_messages.deleted=0`)
        .bind(drawNotice(d,p.provider,reporter),at,at,p.id),
      db.prepare(`UPDATE chat_redpacks SET draw_announced_at=? WHERE id=? AND EXISTS(
        SELECT 1 FROM chat_messages WHERE system_kind='redpack_draw' AND system_ref=CAST(chat_redpacks.message_id AS TEXT))`).bind(at,p.id),
    ] : []),
  ]
}
