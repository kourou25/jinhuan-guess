// 连接器回报的展示白名单，不作为平台授权或资金到账凭证。
export function cleanPacketSnapshot(b: Record<string, unknown>) {
  const num = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 100000000 ? v : null
  const time = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v < 10000000000 ? v : null
  const text = (v: unknown, n = 80) => String(v ?? '').normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, n)
  const money = (v: unknown) => /^(?:0|[1-9]\d{0,12})(?:\.\d{1,8})?$/.test(String(v)) ? String(v) : null
  const people = (v: unknown) => Array.isArray(v) ? v.slice(0, 100).filter(p => p && typeof p === 'object').map(p => ({
    name: text(p.name || p.username || '匿名用户'), username: text(p.username), amount: money(p.amount),
    payout: ['paid','pending'].includes(p.payout) ? p.payout : undefined,
    luck: ['king','last'].includes(p.luck) ? p.luck : undefined,
    result: ['registered','drawing','won','not_won'].includes(p.result) ? p.result : undefined,
  })) : []
  const kind = text(b.kind || 'unknown', 30), timed = ['lottery','timed_draw'].includes(kind)
  return {state: String(b.state), kind, claimed: b.claimed === true, requires_password: b.requires_password === true,
    blocked: ['login','own','exclusive'].includes(String(b.blocked)) ? b.blocked : null,
    amount: b.claimed === true ? money(b.amount) : null, remaining: num(b.remaining), total: num(b.total),
    claimed_count: num(b.claimed_count), participant_count: timed ? num(b.participant_count) : null,
    winner_count: timed && b.draw_complete === true ? num(b.winner_count) : null,
    expires_at: time(b.expires_at), draw_at: timed ? time(b.draw_at) : null, draw_deadline:kind==='timed_draw',
    draw_complete: timed && b.draw_complete === true, server_now: time(b.server_now),
    recipients: people(b.recipients), winners: timed && b.draw_complete === true ? people(b.winners) : [],
    participants: timed ? people(b.participants) : [], roster_more: b.roster_more === true, roster_error: b.roster_error === true,
    creator: text(b.creator,100), wish: text(b.wish,120)}
}
