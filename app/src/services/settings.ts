export async function getSetting(db: D1Database, key: string, fallback: string): Promise<string> {
  const row = await db.prepare('SELECT v FROM site_settings WHERE k = ?').bind(key).first<{v: string}>()
  return row?.v ?? fallback
}

export const setSetting = (db: D1Database, key: string, value: string) => db.prepare(
  'INSERT INTO site_settings(k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at',
).bind(key, value, Math.floor(Date.now() / 1000)).run()
