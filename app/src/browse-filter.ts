const split = (s: string, stripAt = false) => {
  const seen = new Set<string>()
  return s.split(/[,，]+/).map(x => stripAt ? x.trim().replace(/^@/, '') : x.trim()).filter(x => {
    const key = x.toLowerCase()
    if (!x || seen.has(key)) return false
    seen.add(key); return true
  }).slice(0, 20)
}
export function authorFilter(s: string) {
  const names = split(s.replace(/\s+/g, ','), true)
  return { names, sql: names.length ? '(m.author_name COLLATE NOCASE IN (SELECT value FROM json_each(?)) OR m.author_id IN (SELECT id FROM users WHERE username COLLATE NOCASE IN (SELECT value FROM json_each(?))))' : '', args: names.length ? [JSON.stringify(names), JSON.stringify(names)] : [] }
}
export function tagFilter(s: string) {
  const names = split(s)
  return { names, sql: names.length ? 'EXISTS (SELECT 1 FROM meme_tags t WHERE t.meme_id = m.id AND t.tag IN (SELECT value FROM json_each(?)))' : '', args: names.length ? [JSON.stringify(names)] : [] }
}
export const cleanSeen = (v: unknown): number[] => Array.isArray(v) ? [...new Set(v.filter((x): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0))].slice(0, 20000) : []
