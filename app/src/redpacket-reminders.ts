// 同一批事务写入提醒与发送标记；唯一键防止重叠调度重复发出，停机后补偿到期记录。
export async function sendPacketReminders(db: D1Database, at: number) {
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
      SELECT m.group_id,m.user_id,'[红包到点提醒]',?,?,'redpack_due',CAST(m.id AS TEXT)
      FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id JOIN chat_groups g ON g.id=m.group_id
      WHERE p.notify_at<=? AND p.reminded_at IS NULL AND p.draw_announced_at IS NULL AND m.deleted=0
      AND NOT EXISTS(SELECT 1 FROM chat_messages n WHERE n.system_kind='redpack_result' AND n.system_ref=CAST(m.id AS TEXT))
      ORDER BY p.notify_at LIMIT 100`).bind(at,at,at),
    db.prepare(`UPDATE chat_redpacks SET reminded_at=? WHERE reminded_at IS NULL AND notify_at<=?
      AND EXISTS(SELECT 1 FROM chat_messages e WHERE e.system_kind='redpack_due' AND e.system_ref=CAST(chat_redpacks.message_id AS TEXT))`).bind(at,at),
  ])
}
