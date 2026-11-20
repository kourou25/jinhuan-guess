import type {Env} from '../env'
export const styleText=(s:string)=>s.normalize('NFKC').replace(/\s+/gu,'');
export function styleMatches(text:string,rules:string[]){const value=styleText(text);return rules.filter(rule=>styleText(rule).length>=6&&value.includes(styleText(rule))).slice(0,3)}
export async function styleRules(env:Env){return (await env.DB.prepare('SELECT pattern FROM game_style_rules ORDER BY created_at DESC LIMIT 30').all<{pattern:string}>()).results.map(r=>r.pattern)}
