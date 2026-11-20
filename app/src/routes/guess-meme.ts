import {Hono} from 'hono'
import type {Ctx} from '../types'
import {boundedJson,sameOrigin,fail} from '../lib/http'
import {now} from '../lib/time'
export const guessMemeRoutes=new Hono<Ctx>();
const media=(field:string)=>`json_each(CASE WHEN json_valid(m.gallery) THEN m.gallery ELSE '[]' END) j WHERE COALESCE(json_extract(j.value,'$.${field}'),0)<>0`;
const car=`NOT EXISTS (SELECT 1 FROM ${media('c')}) AND NOT EXISTS (SELECT 1 FROM ${media('car')})`;
const clear=`m.nsfw=0 AND m.spoiler=0 AND NOT EXISTS (SELECT 1 FROM ${media('b')}) AND NOT EXISTS (SELECT 1 FROM ${media('blur')}) AND NOT EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(m.gallery) THEN m.gallery ELSE '[]' END) j WHERE json_extract(j.value,'$.o') IS NOT NULL)`;
const allowed=(nsfw:boolean)=>`m.hidden=0 AND ${car} AND ${nsfw?`(m.nsfw=1 OR (${clear}))`:`(${clear})`} AND m.title NOT LIKE '%地狱%' AND m.title NOT LIKE '%地獄%' AND NOT EXISTS(SELECT 1 FROM meme_tags t WHERE t.meme_id=m.id AND (t.tag LIKE '%车牌%' OR t.tag LIKE '%車牌%' OR t.tag LIKE '%番号%' OR t.tag LIKE '%地狱%' OR t.tag LIKE '%地獄%' OR lower(t.tag) IN ('hell','hell meme','hellmeme')))`;
guessMemeRoutes.post('/api/guess-meme/random',async c=>{
 sameOrigin(c);c.header('cache-control','no-store');const b=await boundedJson(c,65536);if(typeof b.nsfw!=='boolean'||!Array.isArray(b.seen)||b.seen.length>5000||b.seen.some((n:unknown)=>!Number.isSafeInteger(n)||Number(n)<1))fail(400,'抽取设置无效');const allowNsfw=b.nsfw===true,user=c.get('user'),uid=user?.id??0,at=now();
 if(uid){const recent=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM guess_meme_draws WHERE user_id=? AND created_at>? LIMIT 60)').bind(uid,at-60).first<{n:number}>();if((recent?.n??0)>=60)fail(429,'抽取过于频繁，请稍后继续')}
 const max=(await c.env.DB.prepare('SELECT max(id) AS n FROM memes').first<{n:number}>())?.n??0;if(!max)return c.json({id:null,message:'暂无可抽取的帖子'});let cursor=Math.floor(crypto.getRandomValues(new Uint32Array(1))[0]/4294967296*max),wrapped=false;
 for(let pass=0;pass<4;pass++){
  const row=await c.env.DB.prepare(`WITH page AS MATERIALIZED (SELECT id,title,hidden,nsfw,spoiler,gallery FROM memes WHERE id>=? ORDER BY id LIMIT 512), eligible AS (SELECT m.id FROM page m WHERE ${allowed(allowNsfw)} AND ${uid?'NOT EXISTS(SELECT 1 FROM guess_meme_draws d WHERE d.user_id=? AND d.meme_id=m.id)':'m.id NOT IN (SELECT value FROM json_each(?))'} ${uid?'':"AND m.id IN (SELECT id FROM memes WHERE hidden=0 ORDER BY created_at DESC,id DESC LIMIT 52)"} LIMIT 16) SELECT (SELECT max(id) FROM page) AS cursor,(SELECT json_group_array(id) FROM eligible) AS ids`).bind(cursor,uid||JSON.stringify(b.seen)).first<{cursor:number|null;ids:string}>();
  for(const id of JSON.parse(row?.ids||'[]') as number[]){if(!uid)return c.json({id});const result=await c.env.DB.prepare(`INSERT OR IGNORE INTO guess_meme_draws(user_id,meme_id,created_at) SELECT ?,m.id,? FROM memes m WHERE m.id=? AND ${allowed(allowNsfw)}`).bind(uid,at,id).run();if(result.meta.changes)return c.json({id})}
  if(row?.cursor===null||row?.cursor===undefined||row.cursor>=max){if(wrapped)break;wrapped=true;cursor=0}else cursor=row.cursor+1;
 }
 return c.json({id:null,message:'本次未抽到符合条件的新帖，可继续抽取或调整NSFW开关'});
});
