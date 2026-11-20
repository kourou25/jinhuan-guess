import type { C } from '../types'
import { fail } from '../lib/http'
const MAX_ITEMS=12
const intIn = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number.parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt
}
export type MediaIn = { key?: unknown; poster?: unknown; w?: unknown; h?: unknown; kind?: unknown; orig?: unknown; name?: unknown; blur?: unknown; car?: unknown }
// kind 'f'：群聊文件附件，n 文件名、s 大小；b：群聊里发的图整张先糊上（点一下看）
export type Media = { k: string; p?: string; w: number | null; h: number | null; kind?: 'v' | 'l' | 'g' | 'f'; o?: string; n?: string; s?: number; b?: 1; c?: 1 }
export const fileName = (s: unknown) => String(s ?? '').replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').trim().slice(0, 100) || '文件'
export async function prepareMedia(c: C, uid: number, raw: unknown, allowFile = false, privateOnly = false): Promise<Media[]> {
  const list = (Array.isArray(raw) ? raw : []).slice(0, MAX_ITEMS) as MediaIn[]
  const items: Media[] = []
  const keys: string[] = []
  for (const r of list) {
    const k = String(r?.key ?? '')
    const p = r?.poster ? String(r.poster) : ''
    const o = r?.orig ? String(r.orig) : ''
    if (!k) continue
    if ([k,p,o].filter(Boolean).some(key=>privateOnly?!key.startsWith('d/'):key.startsWith('d/'))) fail(400,'附件用途不匹配，请重新上传')
    keys.push(k)
    if (p) keys.push(p)
    if (o) keys.push(o)
    const kind = (['v', 'l', 'g'] as const).find((x) => x === r?.kind)
    items.push({ k, p: p || undefined, w: intIn(r?.w, 1, 20000, 0) || null, h: intIn(r?.h, 1, 20000, 0) || null, kind, o: o || undefined,
      n: r?.name ? fileName(r.name) : undefined, b: allowFile && r?.blur ? 1 : undefined, c: allowFile && r?.car ? 1 : undefined })
  }
  if (!items.length) return items
  const { results } = await c.env.DB.prepare(
    `SELECT key, mime, size FROM uploads WHERE user_id = ? AND used = 0 AND key IN (SELECT value FROM json_each(?))`,
  ).bind(uid, JSON.stringify(keys)).all<{ key: string; mime: string; size: number }>()
  const mime = new Map(results.map((r) => [r.key, r.mime]))
  const size = new Map(results.map((r) => [r.key, r.size]))
  for (const it of items) {
    const m = mime.get(it.k) ?? fail(400, '文件已失效，请重新上传')
    const isVideo = m.startsWith('video/')
    if (!isVideo && !m.startsWith('image/')) {
      if (!allowFile) fail(400, '这里只能发图片和视频')
      Object.assign(it, { kind: 'f', p: undefined, o: undefined, w: null, h: null, b: undefined, n: it.n || '文件', s: size.get(it.k) ?? 0 })
      continue
    }
    it.n = undefined
    if (isVideo) {
      it.o = undefined
      // 视频 / 实况必须带一张封面图，列表和缩略图都用它
      if (!it.p || !mime.get(it.p)?.startsWith('image/')) fail(400, '视频缺少封面')
      if (it.kind !== 'l') it.kind = 'v'
    } else {
      it.p = undefined
      it.kind = m === 'image/gif' ? 'g' : undefined
      // 打码前的原图：只认同一个人传的普通图
      if (it.o && (it.kind || !mime.get(it.o)?.startsWith('image/'))) it.o = undefined
    }
  }
  // 此处只校验；实际保存内容时一并认领规范化后仍被引用的文件。
  return items
}

export const mediaKeys = (items: { k: string; p?: string; o?: string }[]) => items.flatMap((m) => [m.k, ...(m.p ? [m.p] : []), ...(m.o ? [m.o] : [])])
