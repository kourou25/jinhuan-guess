import type {Env} from '../env'
import {aiProviders} from './config'
import {AI_JOB_LEASE_SECONDS,validAiJobIdentity,type AiJobIdentity} from './jobs'
import {filterAiText} from './filter'
import {IMAGE_PROMPT_VERSION} from '../shared/ai-prompts'

export const AI_BOT_ID=999999999
const AI_BOT_USERNAME='jinhuan_ai'
const enabled=`EXISTS(SELECT 1 FROM site_settings WHERE k='ai.enabled' AND v='on')
 AND NOT EXISTS(SELECT 1 FROM site_settings WHERE k='ai.img.enabled' AND v='off')`
// 不信创建时的 NSFW 快照；标签触发器维护 m.nsfw。异常偏好 JSON 保守关闭。
const eligible=`m.kind='image' AND m.hidden=0 AND m.nsfw=0 AND m.ai_off=0
 AND u.kind='user' AND u.disabled=0 AND u.silenced=0
 AND (u.ai_prefs IS NULL OR CASE WHEN json_valid(u.ai_prefs) THEN
  (json_type(u.ai_prefs,'$.img_reply') IS NULL OR json_type(u.ai_prefs,'$.img_reply') IN ('true','null')) ELSE 0 END)
 AND ${enabled}`
const tags=`(SELECT json_group_array(tag) FROM (SELECT tag FROM meme_tags WHERE meme_id=m.id ORDER BY tag LIMIT 50))`
const revision=`json_array(m.title,m.content,m.image_key,m.image_url,m.thumb_url,m.gallery,${tags})`
const live=`j.id=? AND j.lease_token=? AND j.state='running' AND j.kind='img_reply' AND j.locked_at>? AND j.locked_at<=?`
const validTime=(t:number)=>Number.isSafeInteger(t)&&t>=0&&t<=253402271999
const check=(job:AiJobIdentity,t:number)=>{if(!validAiJobIdentity(job)||!validTime(t))throw new Error('invalid_ai_image_job')}

export type ImageJobSource={id:number;author_id:number;title:string;content:string;image_key:string|null;image_url:string|null;thumb_url:string|null;gallery:string|null;tags:string;revision:string}

// 只插入空位，永不将碰撞的真人提升/覆盖成机器人，也不覆盖后台自定义昵称与头像。
export async function ensureAiBot(db:D1Database,t:number){
 if(!validTime(t))throw new Error('invalid_ai_image_time')
 const result=await db.batch([
  db.prepare(`INSERT INTO users(id,username,name,avatar,kind,created_at,updated_at)
   SELECT ?,?,'欢欢','/ai-avatar.svg','bot',?,?
   WHERE NOT EXISTS(SELECT 1 FROM users WHERE id=? OR username=? COLLATE NOCASE)`).bind(AI_BOT_ID,AI_BOT_USERNAME,t,t,AI_BOT_ID,AI_BOT_USERNAME),
  db.prepare("SELECT id FROM users WHERE id=? AND username=? AND kind='bot' AND disabled=0 AND NOT EXISTS(SELECT 1 FROM users WHERE username=? COLLATE NOCASE AND id!=?)").bind(AI_BOT_ID,AI_BOT_USERNAME,AI_BOT_USERNAME,AI_BOT_ID),
 ])
 return result[1].results.length===1
}

export async function enqueueImageReply(env:Env,id:number,t:number){
 if(!Number.isSafeInteger(id)||id<=0||!validTime(t))throw new Error('invalid_ai_image_target')
 if(!aiProviders(env,true).length)return false
 const result=await env.DB.prepare(`INSERT OR IGNORE INTO ai_jobs(kind,target_id,user_id,run_after,created_at,updated_at)
  SELECT 'img_reply',m.id,u.id,MAX(?,m.created_at+90),?,? FROM memes m JOIN users u ON u.id=m.author_id
  WHERE m.id=? AND ${eligible} AND (m.image_key IS NOT NULL OR m.image_url IS NOT NULL OR m.gallery IS NOT NULL)`).bind(t,t,t,id).run()
 return result.meta.changes===1
}

export async function imageJobSource(db:D1Database,job:AiJobIdentity,t:number):Promise<ImageJobSource|null>{
 check(job,t)
 return db.prepare(`SELECT m.id,m.author_id,m.title,m.content,m.image_key,m.image_url,m.thumb_url,m.gallery,${tags} AS tags,${revision} AS revision
  FROM ai_jobs j JOIN memes m ON m.id=j.target_id AND m.author_id=j.user_id JOIN users u ON u.id=m.author_id
  WHERE ${live} AND m.created_at<=? AND ${eligible}`).bind(job.id,job.lease,t-AI_JOB_LEASE_SECONDS,t,t-90).first<ImageJobSource>()
}

// 人工重试只恢复失败任务；保留跨重试的逻辑额度，不重建被用户取消或已发布的任务。
export async function retryImageReply(env:Env,id:number,t:number){
 if(!Number.isSafeInteger(id)||id<=0||!validTime(t))throw new Error('invalid_ai_image_job')
 if(!aiProviders(env,true).length)return false
 const result=await env.DB.prepare(`UPDATE ai_jobs SET state='pending',attempts=0,run_after=?,updated_at=?,err=NULL,result=NULL
  WHERE id IN (SELECT j.id FROM ai_jobs j JOIN memes m ON m.id=j.target_id AND m.author_id=j.user_id JOIN users u ON u.id=m.author_id
   WHERE j.id=? AND j.kind='img_reply' AND j.state='failed' AND ${eligible} AND m.created_at<=?
   AND (j.logical_day IS NULL OR j.logical_committed=1)
   AND (m.image_key IS NOT NULL OR m.image_url IS NOT NULL OR m.gallery IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM comments WHERE ai_job_id=j.id))`).bind(t,t,id,t-90).run()
 return result.meta.changes===1
}

// 发布入口再次过滤输出，使用本次看图前取得的 revision，拒绝把旧图/旧配文的回答写到编辑后的帖子。
export async function publishImageReply(db:D1Database,job:AiJobIdentity,output:{text:string;model:string;revision:string},t:number){
 check(job,t)
 const body=filterAiText(output.text,40)
 if(!body||typeof output.revision!=='string'||output.revision.length>256000||typeof output.model!=='string'||!output.model.trim()||output.model.length>100||/[\x00-\x1f\x7f]/.test(output.model))return false
 const claim=crypto.randomUUID(),marker=JSON.stringify({claim})
 const result=await db.batch([
  db.prepare(`UPDATE ai_jobs SET result=? WHERE id IN (
   SELECT j.id FROM ai_jobs j JOIN memes m ON m.id=j.target_id AND m.author_id=j.user_id JOIN users u ON u.id=m.author_id
   WHERE ${live} AND j.logical_committed=1 AND m.created_at<=? AND ${eligible} AND ${revision}=?
   AND EXISTS(SELECT 1 FROM users WHERE id=? AND username=? AND kind='bot' AND disabled=0)
   AND NOT EXISTS(SELECT 1 FROM comments WHERE ai_job_id=j.id))`).bind(marker,job.id,job.lease,t-AI_JOB_LEASE_SECONDS,t,t-90,output.revision,AI_BOT_ID,AI_BOT_USERNAME),
  db.prepare(`INSERT INTO comments(meme_id,user_id,body,created_at,ai_job_id)
   SELECT target_id,?,?,?,id FROM ai_jobs WHERE id=? AND state='running' AND result=?`).bind(AI_BOT_ID,body,t,job.id,marker),
  db.prepare(`UPDATE memes SET comment_count=comment_count+1 WHERE id=(SELECT target_id FROM ai_jobs WHERE id=? AND state='running' AND result=?)`).bind(job.id,marker),
  db.prepare(`UPDATE ai_jobs SET state='done',locked_at=NULL,lease_token=NULL,err=NULL,updated_at=?,
   result=json_object('comment_id',(SELECT id FROM comments WHERE ai_job_id=?),'model',?,'prompt_version',?)
   WHERE id=? AND state='running' AND result=?`).bind(t,job.id,output.model,IMAGE_PROMPT_VERSION,job.id,marker),
 ])
 return result[0].meta.changes===1
}
