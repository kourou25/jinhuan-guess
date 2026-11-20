import { Hono } from 'hono'
import type { C, Ctx } from '../types'
import { needUser } from '../services/auth'
import { boundedJson, fail } from '../lib/http'
import { now } from '../lib/time'
import {sha256} from '../lib/crypto'
import {prepareMedia,mediaKeys,fileName,type Media} from '../services/content-media'
import {commitUploadContent} from '../services/upload-operations'

export const dm = new Hono<Ctx>()
dm.use('/api/dm/*', async (c, next) => { needUser(c); c.header('cache-control', 'no-store'); await next() })

type DmRow={id:number;thread_id:number;sender_id:number;body:string;created_at:number;media:string|null;reply_id:number|null;deleted:number;updated_at:number;request_hash:string|null;reply_body?:string;reply_deleted?:number;reply_sender?:number}
const messageSelect=`SELECT m.*,r.body AS reply_body,r.deleted AS reply_deleted,r.sender_id AS reply_sender FROM dm_messages m LEFT JOIN dm_messages r ON r.id=m.reply_id AND r.thread_id=m.thread_id`
function messageView(m:DmRow){
 const media:Media[]=m.deleted?[]:JSON.parse(m.media||'[]'),url=(key:string)=>'/api/dm/media/'+key
 return {id:m.id,thread_id:m.thread_id,sender_id:m.sender_id,created_at:m.created_at,updated_at:m.updated_at,deleted:!!m.deleted,
  body:m.deleted?'消息已撤回':media.length&&m.body==='[附件]'?'':m.body,
  media:media.map(x=>({u:url(x.p||x.k),...(x.p?{v:url(x.k)}:{}),...(x.o?{o:url(x.o)}:{}),k:x.kind,w:x.w,h:x.h,n:x.n,s:x.s})),
  reply_to:!m.deleted&&m.reply_id?{id:m.reply_id,sender_id:m.reply_sender,body:m.reply_deleted?'消息已撤回':m.reply_body||'[附件]'}:null}
}

dm.get('/api/dm/media/*',async c=>{
 const uid=needUser(c).id,key=decodeURIComponent(c.req.path.slice('/api/dm/media/'.length))
 if(!/^d\/\d{4}\/\d{2}\/[a-f0-9]+\.[a-z0-9]{1,8}$/.test(key))return c.notFound()
 const access=await c.env.DB.prepare(`SELECT 1 FROM uploads u WHERE u.key=?1 AND (
  (u.user_id=?2 AND u.used=0) OR EXISTS(SELECT 1 FROM dm_media_access a JOIN dm_messages m ON m.id=a.message_id
    JOIN dm_threads t ON t.id=m.thread_id WHERE a.key=u.key AND m.deleted=0 AND ?2 IN(t.user_low,t.user_high)))`).bind(key,uid).first()
 if(!access)return c.notFound()
 const range=c.req.header('range'),obj=await c.env.BUCKET.get(key,range?{range:c.req.raw.headers}:undefined)
 if(!obj)return c.notFound()
 const headers=new Headers();obj.writeHttpMetadata(headers);headers.set('cache-control','private, no-store');headers.set('accept-ranges','bytes');headers.set('x-content-type-options','nosniff');headers.set('cross-origin-resource-policy','same-origin')
 if(!/^(image\/(png|jpeg|gif|webp)|video\/)/.test(obj.httpMetadata?.contentType||'')){
  const name=fileName(c.req.query('n')||key.split('/').pop());headers.set('content-type','application/octet-stream');headers.set('content-disposition',`attachment; filename*=UTF-8''${encodeURIComponent(name)}`);headers.set('content-security-policy',"sandbox; default-src 'none'")
 }
 const r=obj.range as {offset?:number;length?:number}|undefined
 if(range&&r){const offset=r.offset||0,length=r.length??obj.size-offset;headers.set('content-range',`bytes ${offset}-${offset+length-1}/${obj.size}`);headers.set('content-length',String(length));return new Response(obj.body,{status:206,headers})}
 headers.set('content-length',String(obj.size));return new Response(obj.body,{headers})
})

const idOf = (raw: string) => {
  if (!/^-?[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) fail(400, '编号无效')
  return Number(raw)
}

async function ownedThread(c: C, id: number, uid: number) {
  const row = await c.env.DB.prepare(`SELECT t.id,t.user_low,t.user_high,t.last_message_id,
    CASE WHEN t.user_low=? THEN t.read_low ELSE t.read_high END AS last_read,
    u.id AS peer_id,u.username AS peer_username,u.name AS peer_name,u.avatar AS peer_avatar
    FROM dm_threads t JOIN users u ON u.id=CASE WHEN t.user_low=? THEN t.user_high ELSE t.user_low END
    WHERE t.id=? AND (t.user_low=? OR t.user_high=?)`)
    .bind(uid, uid, id, uid, uid).first<{id:number;user_low:number;user_high:number;last_message_id:number;last_read:number;
      peer_id:number;peer_username:string;peer_name:string|null;peer_avatar:string|null}>()
  if (!row) fail(404, '会话不存在')
  return row!
}

dm.get('/api/dm/users', async c => {
  const u=needUser(c), q=(c.req.query('q')??'').trim().slice(0,30)
  if (!q) return c.json({users:[]})
  const like=`%${q.replace(/[\\%_]/g,s=>'\\'+s)}%`
  const {results}=await c.env.DB.prepare(`SELECT id,username,name,avatar FROM users
    WHERE id<>? AND kind='user' AND disabled=0
      AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=users.id)
      AND (username LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')
    ORDER BY (username=? COLLATE NOCASE) DESC,updated_at DESC LIMIT 20`).bind(u.id,like,like,q).all()
  return c.json({users:results})
})
dm.get('/api/dm/users/:uid', async c => {
  const u=needUser(c),peer=idOf(c.req.param('uid'))
  const row=await c.env.DB.prepare(`SELECT id,username,name,avatar FROM users WHERE id=? AND id<>? AND kind='user' AND disabled=0
    AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=users.id)`).bind(peer,u.id).first()
  if(!row)fail(404,'成员不可用')
  return c.json({user:row})
})

dm.get('/api/dm/threads', async c => {
  const u=needUser(c)
  const {results}=await c.env.DB.prepare(`SELECT t.id,t.last_message_id,t.last_at,
    CASE WHEN t.user_low=?1 THEN t.read_low ELSE t.read_high END AS last_read,
    p.id AS peer_id,p.username AS peer_username,p.name AS peer_name,p.avatar AS peer_avatar,
    m.body AS last_body,m.sender_id AS last_sender,
    (SELECT COUNT(*) FROM (SELECT 1 FROM dm_messages unread WHERE unread.thread_id=t.id
      AND unread.id>CASE WHEN t.user_low=?1 THEN t.read_low ELSE t.read_high END
      AND unread.sender_id<>?1 LIMIT 100)) AS unread
    FROM dm_threads t JOIN users p ON p.id=CASE WHEN t.user_low=?1 THEN t.user_high ELSE t.user_low END
    LEFT JOIN dm_messages m ON m.id=t.last_message_id
    WHERE t.user_low=?1 OR t.user_high=?1 ORDER BY t.last_message_id DESC,t.id DESC LIMIT 50`).bind(u.id).all()
  return c.json({threads:results})
})

dm.get('/api/dm/threads/:id/messages', async c => {
  const u=needUser(c), thread=await ownedThread(c,idOf(c.req.param('id')),u.id)
  const before=c.req.query('before'), after=c.req.query('after')
  if (before&&after) fail(400,'只能选择一种翻页方向')
  const cursor=after==='0'?0:before||after ? idOf(before||after!) : 0
  const limit=after?100:40
  const sql=`${messageSelect} WHERE m.thread_id=?
    ${before?'AND m.id<?':after?'AND m.id>?':''} ORDER BY m.id ${after?'ASC':'DESC'} LIMIT ?`
  const args=before||after?[thread.id,cursor,limit]:[thread.id,limit]
  const {results}=await c.env.DB.prepare(sql).bind(...args).all<DmRow>()
  const messages=after?results:results.reverse()
  const since=Number(c.req.query('since')||0),at=now()
  const updates=after&&Number.isSafeInteger(since)&&since>0?await c.env.DB.prepare(`${messageSelect} WHERE m.thread_id=? AND m.updated_at>=? AND m.id<=? ORDER BY m.updated_at,m.id LIMIT 100`).bind(thread.id,since,cursor).all<DmRow>():null
  return c.json({thread:{id:thread.id,peer:{id:thread.peer_id,username:thread.peer_username,name:thread.peer_name,avatar:thread.peer_avatar},last_read:thread.last_read},
    messages:messages.map(messageView),updates:updates?.results.map(messageView)||[],server_now:at,has_more:!after&&results.length===limit})
})

type MessageInput={body?:unknown;nonce?:unknown;media?:unknown;reply_to?:unknown}
function messageInput(input: MessageInput) {
  const body=String(input.body??'').replace(/\r/g,'').trim()
  const media=input.media??[],reply=Number(input.reply_to||0)
  if(!Array.isArray(media)||media.length>12||media.some(x=>!x||typeof x!=='object'||typeof x.key!=='string'))fail(400,'附件格式有误或数量超过12个')
  if(!Number.isSafeInteger(reply)||reply<0)fail(400,'引用消息无效')
  if ((!body&&!(media as unknown[]).length)||[...body].length>2000||/[\p{Cc}\p{Cf}]/u.test(body.replace(/\n/g,''))) fail(400,'消息需要文字或附件，文字不能超过2000字或含控制字符')
  const nonce=String(input.nonce??'')
  if (!/^[a-zA-Z0-9_-]{20,80}$/.test(nonce)) fail(400,'消息重试标识无效')
  return {body:body||'[附件]',nonce,media:media as unknown[],reply}
}

async function send(c:C,threadId:number,uid:number,input: ReturnType<typeof messageInput>) {
  const thread=await ownedThread(c,threadId,uid)
  const {body,nonce}=input
  const t=now(),hash=await sha256(JSON.stringify([body,input.media,input.reply]))
  const existing=()=>c.env.DB.prepare(`${messageSelect} WHERE m.sender_id=? AND m.client_nonce=?`).bind(uid,nonce).first<DmRow>()
  const replay=(m:DmRow)=>{if(m.thread_id!==thread.id||(m.request_hash?m.request_hash!==hash:m.body!==body||input.media.length||input.reply))fail(409,'消息重试标识已被使用');return c.json({thread_id:thread.id,message:messageView(m),replayed:true})}
  const old=await existing();if(old)return replay(old)
  if(input.reply&&!await c.env.DB.prepare('SELECT 1 FROM dm_messages WHERE id=? AND thread_id=?').bind(input.reply,thread.id).first())fail(400,'不能引用其他会话的消息')
  let media:Media[]
  try{media=await prepareMedia(c,uid,input.media,true,true)}catch(error){const old=await existing();if(old)return replay(old);throw error}
  const keys=mediaKeys(media!)
  try{await commitUploadContent(c.env.DB,uid,keys,[
    c.env.DB.prepare(`INSERT OR IGNORE INTO dm_messages(thread_id,sender_id,body,client_nonce,created_at,media,reply_id,updated_at,request_hash)
      SELECT t.id,?,?,?,?,?,?,?,? FROM dm_threads t
      JOIN users a ON a.id=t.user_low JOIN users b ON b.id=t.user_high
      WHERE t.id=? AND ? IN(t.user_low,t.user_high) AND a.kind='user' AND b.kind='user'
        AND a.disabled=0 AND b.disabled=0
        AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(t.user_low,t.user_high))
        AND (SELECT COUNT(*) FROM dm_messages WHERE sender_id=? AND created_at>=?)<20`)
      .bind(uid,body,nonce,t,media!.length?JSON.stringify(media!):null,input.reply||null,t,hash,thread.id,uid,uid,t-60),
    c.env.DB.prepare(`SELECT json(CASE WHEN EXISTS(SELECT 1 FROM dm_messages WHERE sender_id=? AND client_nonce=? AND thread_id=? AND request_hash=?) THEN 'true' ELSE 'dm_send_rejected' END)`).bind(uid,nonce,thread.id,hash),
    ...keys.map(key=>c.env.DB.prepare('INSERT OR IGNORE INTO dm_media_access(key,message_id) SELECT ?,id FROM dm_messages WHERE sender_id=? AND client_nonce=? AND thread_id=? AND request_hash=?').bind(key,uid,nonce,thread.id,hash)),
    c.env.DB.prepare(`UPDATE dm_threads SET last_message_id=MAX(last_message_id,
      (SELECT id FROM dm_messages WHERE sender_id=? AND client_nonce=? AND thread_id=?)),
      last_at=MAX(last_at,(SELECT created_at FROM dm_messages WHERE sender_id=? AND client_nonce=? AND thread_id=?))
      WHERE id=? AND EXISTS(SELECT 1 FROM dm_messages WHERE sender_id=? AND client_nonce=? AND thread_id=?)`)
      .bind(uid,nonce,thread.id,uid,nonce,thread.id,thread.id,uid,nonce,thread.id),
  ])}catch(error){const old=await existing();if(old)return replay(old);if(String(error).includes('malformed JSON'))fail(429,'发送太频繁或收件人不可用，请稍后重试');throw error}
  const message=await existing()
  if (!message) fail(429,'发送太频繁，请稍后重试')
  if (message!.thread_id!==thread.id||message!.body!==body) fail(409,'消息重试标识已被使用')
  return c.json({thread_id:thread.id,message:messageView(message!),replayed:false})
}

dm.post('/api/dm/threads/:id/messages', async c => send(c,idOf(c.req.param('id')),needUser(c).id,
  messageInput(await boundedJson(c) as MessageInput)))
dm.post('/api/dm/users/:uid/messages', async c => {
  const u=needUser(c),peer=idOf(c.req.param('uid'))
  if (peer===u.id) fail(400,'不能给自己发私信')
  const input=messageInput(await boundedJson(c) as MessageInput)
  const low=Math.min(u.id,peer),high=Math.max(u.id,peer)
  await c.env.DB.prepare(`INSERT OR IGNORE INTO dm_threads(user_low,user_high,created_at)
    SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND kind='user' AND disabled=0)
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND kind='user' AND disabled=0)
      AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(?,?))`)
    .bind(low,high,now(),u.id,peer,low,high).run()
  const thread=await c.env.DB.prepare('SELECT id FROM dm_threads WHERE user_low=? AND user_high=?').bind(low,high).first<{id:number}>()
  if(!thread)fail(404,'收件人不可用')
  return send(c,thread!.id,u.id,input)
})

dm.put('/api/dm/threads/:id/read', async c => {
  const u=needUser(c),thread=await ownedThread(c,idOf(c.req.param('id')),u.id)
  const input=await boundedJson(c),through=input.through==null?thread.last_message_id:Number(input.through)
  if(!Number.isSafeInteger(through)||through<0)fail(400,'已读位置无效')
  const lastRead=Math.max(thread.last_read,Math.min(through,thread.last_message_id)),column=thread.user_low===u.id?'read_low':'read_high'
  await c.env.DB.prepare(`UPDATE dm_threads SET ${column}=MAX(${column},?)
    WHERE id=? AND (user_low=? OR user_high=?)`).bind(lastRead,thread.id,u.id,u.id).run()
  return c.json({ok:true,last_read:lastRead})
})

dm.delete('/api/dm/messages/:id',async c=>{
 const uid=needUser(c).id,id=idOf(c.req.param('id'))
 const m=await c.env.DB.prepare('SELECT thread_id FROM dm_messages WHERE id=? AND sender_id=?').bind(id,uid).first<{thread_id:number}>()
 if(!m)fail(404,'消息不存在');await ownedThread(c,m!.thread_id,uid)
 await c.env.DB.prepare("UPDATE dm_messages SET deleted=1,body='[已撤回]',updated_at=? WHERE id=? AND sender_id=?").bind(now(),id,uid).run()
 return c.json({ok:true})
})

dm.patch('/api/dm/messages/:id',async c=>{
 const uid=needUser(c).id,id=idOf(c.req.param('id')),input=await boundedJson(c,8192)
 const text=String(input.body??'').replace(/\r/g,'').trim()
 if(!text||[...text].length>2000||/[\p{Cc}\p{Cf}]/u.test(text.replace(/\n/g,'')))fail(400,'文字需要1～2000字，不能含控制字符')
 const m=await c.env.DB.prepare('SELECT thread_id FROM dm_messages WHERE id=? AND sender_id=? AND deleted=0').bind(id,uid).first<{thread_id:number}>()
 if(!m)fail(404,'消息不存在');await ownedThread(c,m!.thread_id,uid)
 await c.env.DB.prepare('UPDATE dm_messages SET body=?,updated_at=? WHERE id=? AND sender_id=? AND deleted=0').bind(text,now(),id,uid).run()
 return c.json({message:messageView((await c.env.DB.prepare(`${messageSelect} WHERE m.id=?`).bind(id).first<DmRow>())!)})
})
