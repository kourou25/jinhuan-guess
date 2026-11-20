export {decodeSharedCode, sharedPacket, cleanExternalPacket, packetReferenceUrl} from '../public/redpacket-reference.js'
import {packetText} from '../public/redpacket-reference.js'
export {packetText}
export type ExternalPacket = { provider: string; external_ref: string; external_kind: string; external_code?: string | null }
export function sharedPacketStatements(db: D1Database, id: number, body: string, p: ExternalPacket | null) {
  const ref = p ? `shared:${id}:${p.provider}:${p.external_ref}` : ''
  return [
    db.prepare(`DELETE FROM chat_redpacks WHERE message_id=? AND id LIKE 'shared:%' AND id<>?
      AND EXISTS(SELECT 1 FROM chat_messages WHERE id=? AND body=? AND deleted=0 AND redpack_id IS NULL)`)
      .bind(id, ref, id, body),
    ...(p ? [db.prepare(`INSERT OR IGNORE INTO chat_redpacks(id,message_id,secret,mode,game,prompt,phrase,provider,external_ref,external_kind,external_code)
      SELECT ?,id,'外站红包已解锁','open','','','',?,?,?,? FROM chat_messages
      WHERE id=? AND body=? AND deleted=0 AND redpack_id IS NULL AND system_kind IS NULL`)
      .bind(ref, p.provider, p.external_ref, p.external_kind, p.external_code||null, id, body)] : []),
  ]
}
export type PacketConfig = { secret: string; mode: string; game: string; prompt: string; phrase: string; post_id: number | null; image_index: number; mask: number; mask_bits: number | null; clue_key: string | null }
export function cleanPacket(b: Record<string, unknown>): PacketConfig {
  const external = ['hb', 'credit', 'fish'].includes(String(b.provider))
  const moneyReward=b.ldc_reward===true
  const secret = external ? '外站红包已解锁' : moneyReward&&['open','phrase'].includes(String(b.mode)) ? '本站红包奖励' : packetText(b.secret)
  const n = [...secret].length
  if (n < (moneyReward&&b.mode==='image'?1:6) || n > (moneyReward&&b.mode==='image'?40:18) || /[\p{Cc}\p{Cf}]/u.test(secret)) throw new Error(moneyReward&&b.mode==='image'?'图片答案需为1–40字，不能包含换行或控制字符':'谜底需要 6–18 个字符，不能包含换行或控制字符')
  const mode = external ? 'open' : String(b.mode || '')
  if (!['open', 'phrase', 'cipher', 'image'].includes(mode)) throw new Error('请选择开包方式')
  const game = mode === 'cipher' ? String(b.game || 'reverse') : ''
  if (mode === 'cipher' && !['reverse', 'pairs', 'tiles', 'rails', 'stairs', 'radio'].includes(game)) throw new Error('请选择解密玩法')
  const phrase = mode === 'phrase' ? packetText(b.phrase) : ''
  if (mode === 'phrase' && (!phrase || [...phrase].length > 1000 || /[\p{Cc}\p{Cf}]/u.test(phrase))) throw new Error('群聊口令需要 1–1000 个字符，不能换行')
  const prompt = packetText(b.prompt)
  if ([...prompt].length > 120) throw new Error('线索最多 120 个字符')
  const post_id = mode === 'image' ? Number(b.post_id) : null
  const image_index = mode === 'image' ? Number(b.image_index ?? 0) : 0
  const mask = mode === 'image' ? Number(b.mask ?? 4) : 4
  const mask_bits = mode === 'image' ? Number(b.mask_bits) : null
  const clue_key = mode === 'image' ? String(b.clue_key || '') : null
  if (mode === 'image' && (!Number.isSafeInteger(post_id) || post_id! <= 0 || !Number.isInteger(image_index) || image_index < 0 || image_index > 99 || !Number.isInteger(mask) || mask < 0 || mask > 8)) throw new Error('请选择有效的帖子图片和清晰窗口')
  if (mode === 'image' && (!Number.isInteger(mask_bits) || mask_bits! < 1 || mask_bits! > 511 || !/^c\/[a-z0-9/._-]{8,160}\.(?:png|jpg|webp)$/.test(clue_key!))) throw new Error('请刷新页面，重新生成图片线索')
  if ((mode === 'image' || game === 'tiles') && !prompt) throw new Error('这个玩法需要一句线索，让大家有迹可循')
  return { secret, mode, game, prompt, phrase, post_id, image_index, mask, mask_bits, clue_key }
}
export function packetClue(p: Pick<PacketConfig, 'secret' | 'game'>): { text?: string; tiles?: string[]; rows?: (string | null)[][] } {
  const chars = [...p.secret]
  if (p.game === 'reverse') return { text: chars.reverse().join('') }
  if (p.game === 'pairs') return { text: chars.map((_, i) => chars[i % 2 ? i - 1 : i + 1] ?? chars[i]).join('') }
  if (p.game === 'rails') return { rows: [chars.filter((_, i) => i % 2 === 0), chars.filter((_, i) => i % 2 === 1).reverse()] }
  if (p.game === 'stairs') {
    const rows: (string | null)[][] = []
    for (let i = 0; i < chars.length; i += 3) {
      const row = Array.from({ length: 3 }, (_, j) => chars[i + j] ?? null)
      rows.push((i / 3) % 2 ? row.reverse() : row)
    }
    return { rows: rows.reverse() }
  }
  if (p.game === 'radio') {
    const swapped = chars.map((_, i) => chars[i % 2 ? i - 1 : i + 1] ?? chars[i])
    return { text: [...swapped.slice(2), ...swapped.slice(0, 2)].join('') }
  }
  if (p.game === 'tiles') {
    // 每次查看都是相同的字块排列，重复字符保留独立位置。
    const tiles = [...chars].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!)
    if (tiles.join('') === p.secret) tiles.reverse()
    return { tiles }
  }
  return {}
}
