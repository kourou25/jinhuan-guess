import { officialTitleId } from '../official-titles'
import { raffleTitleEnabled } from './raffle-policy'
import { personalTitleId } from './personal-directory'
import { guessReward } from './guess-rewards'
import { luckReward } from './luck-rewards'
import { RANK_REWARDS,rankReward } from './rank-rewards'
import { FARM_BADGES } from './farm-badges'
import { ACTIVITY_REWARDS,activityReward } from './activity-rewards'
import {collectionTitle,TITLE_MAX_LEVEL} from './title-collection'

export const DECO_FONTS = ['', 'kai', 'song', 'hei', 'round', 'xing', 'mono'] as const
export const DECO_SHAPES = ['pill', 'oval', 'rect', 'tag', 'blob', 'ribbon', 'seal', 'none'] as const
export const DECO_FILLS = ['solid', 'soft', 'grad', 'outline', 'glass', 'none'] as const
export const DECO_FX = ['flow', 'shine', 'pulse', 'none'] as const
// 气泡：前 10 个是老款（老数据照常显示），后面是新款
export const DECO_BUBBLES = ['', 'laowu', 'cloud', 'candy', 'neon', 'paper', 'ink', 'pixel', 'sakura', 'gold', 'night',
  'jelly', 'puff', 'paw', 'galaxy', 'bit', 'petal', 'boba', 'cyber', 'prism', 'mint', 'bunny', 'lemon', 'yinlu'] as const
export const DECO_SCOPES = ['all', 'chat', 'post'] as const
// 徽章：elder 手动发，其余每天（北京时间）结算昨天的数据。名字、图标、颜色在前端
export const BADGE_IDS = ['elder', 'newbie', 'guide', 'guess', 'luck_king', 'luck_last', 'moyu_pro', 'moyu_god', 'post_god', 'post_pro', 'sese', 'chunse', 'water', 'react', 'night', ...new Set(RANK_REWARDS.map(r=>r.series)), ...new Set(ACTIVITY_REWARDS.map(r=>r.series)), ...FARM_BADGES.map(b=>b.id)] as const
// cssb / csst：自己写的气泡 / 称号样式（只收「属性: 值」声明）；bn：佩戴徽章拿过几次（服务端写，前端按它分等级）
export type Deco = { gr?:string; pt?: string; ot?: string; rt?: string; ft?: string; fn?: number; fp?:number; fxp?:number; badge_mode?:string; t?: string; c?: string; c2?: string; bc?: string; f?: string; sh?: string; fill?: string; fc?: string[]; fx?: string; bb?: string; sc?: string; bd?: string; bs?: string; bn?: number; bl?:number; cssb?: string; csst?: string }
const decoHex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined)
const pick = <T extends readonly string[]>(list: T, v: unknown) => ((list as readonly string[]).includes(String(v)) ? String(v) : undefined)
// 自定义样式清洗（public/app.js 的 cleanCss 是同一套规则）：拆成一条条声明，属性白名单 + 值里只许安全字符和少数函数，
// 不认识的整条丢掉。不许选择器 / 花括号 / url / 定位 / 层级 / !important，尺寸封顶，防止盖住别人或整页
const CSS_PROP_RE = /^(color|background|background-color|background-image|box-shadow|text-shadow|font-weight|font-style|letter-spacing|padding|opacity|filter|border(-(top|right|bottom|left))?(-(color|width|style))?|border(-(top|bottom)-(left|right))?-radius)$/
const CSS_BAD_RE = /url|expression|script|import|behavior|binding|attr|var|env|image-set|element|calc|fixed|absolute|sticky|z-index|content|\d(vw|vh|vmin|vmax|cm|mm|in|pt|pc|q|ch|ex)\b/
const CSS_FN_COLOR = ['rgb', 'rgba', 'hsl', 'hsla']
const CSS_FN_GRAD = ['linear-gradient', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient', 'repeating-radial-gradient', 'repeating-conic-gradient']
const CSS_FN_FILTER = ['hue-rotate', 'saturate', 'brightness']
export function cleanCss(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.slice(0, 600).replace(/\/\*[\s\S]*?(\*\/|$)/g, '').replace(/[{}<>\\@]/g, '')
  const out: string[] = []
  for (const part of s.split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const p = part.slice(0, i).trim().toLowerCase()
    const val = part.slice(i + 1).trim().replace(/\s+/g, ' ').toLowerCase()
    if (!CSS_PROP_RE.test(p) || !val || val.length > 240) continue
    if (!/^[a-z0-9#%., ()/+-]+$/.test(val) || CSS_BAD_RE.test(val)) continue
    const fns = [...val.matchAll(/([a-z-]+)\(/g)].map((m) => m[1])
    const okFn = p === 'filter' ? CSS_FN_FILTER : p === 'background' || p === 'background-image' ? [...CSS_FN_COLOR, ...CSS_FN_GRAD] : CSS_FN_COLOR
    if (!fns.every((f) => okFn.includes(f))) continue
    if (p === 'filter' && !/^((hue-rotate|saturate|brightness)\([0-9.]+(deg|%)?\) ?)+$/.test(val)) continue
    if (p === 'background-image' && !fns.some((f) => CSS_FN_GRAD.includes(f))) continue
    if (p === 'opacity' && !(/^[0-9.]+$/.test(val) && +val >= 0.6 && +val <= 1)) continue
    if ((p === 'padding' || p === 'letter-spacing' || /width$/.test(p)) && val.includes('%')) continue
    // 尺寸封顶：px ≤ 24，em / rem ≤ 2
    const nums = [...val.matchAll(/(\d*\.?\d+)(px|r?em)/g)]
    if (nums.some((m) => +m[1] > (m[2] === 'px' ? 24 : 2))) continue
    out.push(`${p}: ${val}`)
    if (out.length >= 16) break
  }
  const r = out.join('; ')
  return r && r.length <= 600 ? r : undefined
}
export function cleanDeco(x: unknown): Deco | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const t = String(o.t ?? '').replace(/[\s\u200b-\u200f\u202a-\u202e]+/g, ' ').trim()
  const d: Deco = {
    gr:(guessReward(o.gr)||luckReward(o.gr)||rankReward(o.gr)||activityReward(o.gr))?.id,
    ot: officialTitleId(o.ot),
    rt: o.rt==='guangjie'?'guangjie':undefined,
    t: [...t].slice(0, 8).join('') || undefined, c: decoHex(o.c), c2: decoHex(o.c2), bc: decoHex(o.bc),
    f: pick(DECO_FONTS, o.f) || undefined, sh: pick(DECO_SHAPES, o.sh), fill: pick(DECO_FILLS, o.fill),
    fc: Array.isArray(o.fc) ? o.fc.map(decoHex).filter((v): v is string => !!v).slice(0, 4) : undefined,
    fx: pick(DECO_FX, o.fx), sc: pick(DECO_SCOPES, o.sc),badge_mode:pick(['set','custom','none'] as const,o.badge_mode),
    // 佩戴的徽章和它的生效范围；有没有这枚徽章在保存时查
    bd: pick(BADGE_IDS, o.bd), bs: pick(DECO_SCOPES, o.bs),
  }
  // bn 只在服务端写（保存装扮、每日结算时同步），这里只做范围校验
  const bn = Number(o.bn)
  if (d.bd && Number.isInteger(bn) && bn > 0) d.bn = Math.min(bn, 99999)
  if (!d.fc?.length) delete d.fc
  for (const k of Object.keys(d) as (keyof Deco)[]) if (d[k] === undefined) delete d[k]
  return Object.keys(d).length ? d : null
}
export const decoOf = (raw: unknown) => {
  if (!raw || typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const d = cleanDeco(parsed) ?? {}
    // 仅读取服务端保存的外观授权等级，cleanDeco不接收客户端bl。
    if(d.bd&&Number.isInteger(parsed.bl)&&Number(parsed.bl)>=1&&Number(parsed.bl)<=5)d.bl=Number(parsed.bl)
    const personal=personalTitleId(parsed.pt)
    if(personal) d.pt=personal
    if (collectionTitle(parsed.ft) && raffleTitleEnabled(String(parsed.ft))) {
      d.ft = String(parsed.ft)
      const count = Number(parsed.fn)
      d.fn = Number.isInteger(count) && count > 0 ? Math.min(count, TITLE_MAX_LEVEL) : 1
      if(Number(parsed.fxp)>0){d.fxp=Number(parsed.fxp);d.fp=Math.max(0,Math.min(TITLE_MAX_LEVEL,Number(parsed.fp)||0));if(d.fxp<=Math.floor(Date.now()/1000)){if(d.fp)d.fn=d.fp;else delete d.ft;delete d.fxp;delete d.fp}}
    }
    return Object.keys(d).length ? d : null
  } catch { return null }
}
