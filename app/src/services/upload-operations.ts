import {fail} from '../lib/http'
import {hex,randHex,sha256} from '../lib/crypto'

const RECOVER_SECONDS=23*3600
const CLEANUP_SECONDS=24*3600
const LEASE_SECONDS=300
type UploadOperation={user_id:number;nonce:string;key:string;fingerprint:string;mime:string;size:number;state:'pending'|'ready'|'deleting';lease_token:string;lease_until:number;created_at:number}
type UploadInput={uid:number;nonce:unknown;mime:string;ext:string;purpose:'chat'|'meme'|'dm'|'avatar';asFile:boolean;limited:boolean;t:number}&({bytes:Uint8Array;source?:never}|{source:R2ObjectBody;bytes?:never})

export function uploadNonce(raw:unknown):string{
  if(raw===null||raw===undefined||raw==='')return randHex(24) // 兼容旧客户端，仍登记清理依据。
  if(typeof raw!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(raw))fail(400,'上传标识无效，请重新选择文件')
  return raw as string
}

// 回执只代表这个文件尚可供同一账号消费，不允许已使用资源再次冒充新上传。
async function readyResult(db:D1Database,op:UploadOperation){
  const file=await db.prepare('SELECT used FROM uploads WHERE key=? AND user_id=?').bind(op.key,op.user_id).first<{used:number}>()
  if(!file||file.used!==0)fail(409,'该上传已使用或失效，请重新选择文件','upload_expired')
  return {key:op.key,url:`${op.key.startsWith('d/')?'/api/dm/media/':'/img/'}${op.key}`,mime:op.mime,video:op.mime.startsWith('video/')}
}

export async function storeUpload(db:D1Database,bucket:R2Bucket,input:UploadInput){
  const {uid,mime,ext,purpose,asFile,limited,t}=input,nonce=uploadNonce(input.nonce)
  const size=input.source?input.source.size:input.bytes.byteLength
  // 服务端已有对象直接流式传递；etag/size绑定同一对象版本，不整文件读入Worker内存。
  const digest=input.source?`r2:${input.source.etag}:${size}`:hex(await crypto.subtle.digest('SHA-256',input.bytes as Uint8Array<ArrayBuffer>))
  const fingerprint=await sha256(JSON.stringify([digest,mime,ext,purpose,asFile]))
  const get=()=>db.prepare('SELECT * FROM upload_operations WHERE user_id=? AND nonce=?').bind(uid,nonce).first<UploadOperation>()
  let op=await get()
  if(!op){
    const d=new Date(t*1000),key=`${purpose==='avatar'?'a':purpose==='dm'?'d':purpose==='chat'?'c':'m'}/${d.getUTCFullYear()}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${randHex(12)}.${ext}`
    // 原有300次/小时门槛包含未完成操作；重试已有回执不占一个新名额。
    await db.prepare(`INSERT INTO upload_operations(user_id,nonce,key,fingerprint,mime,size,state,created_at,cleanup_after)
      SELECT ?,?,?,?,?,?,'pending',?,? WHERE ?=0 OR
      (SELECT COUNT(*) FROM upload_operations WHERE user_id=? AND created_at>?) +
      (SELECT COUNT(*) FROM uploads u WHERE u.user_id=? AND u.created_at>? AND NOT EXISTS(SELECT 1 FROM upload_operations o WHERE o.key=u.key)) < 300
      ON CONFLICT(user_id,nonce) DO NOTHING`)
      .bind(uid,nonce,key,fingerprint,mime,size,t,t+CLEANUP_SECONDS,limited?1:0,uid,t-3600,uid,t-3600).run()
    op=await get()
    if(!op)fail(429,'传得太多了，过一会儿再来')
  }
  if(op!.fingerprint!==fingerprint)fail(409,'同一次上传的文件或用途已改变，请重新选择文件','upload_conflict')
  if(op!.state==='deleting'||op!.created_at<=t-RECOVER_SECONDS)fail(409,'上传已过期，请重新选择文件','upload_expired')
  if(op!.state==='ready')return readyResult(db,op!)
  const token=randHex(16)
  const lock=await db.prepare("UPDATE upload_operations SET lease_token=?,lease_until=? WHERE user_id=? AND nonce=? AND state='pending' AND lease_until<=? RETURNING key")
    .bind(token,t+LEASE_SECONDS,uid,nonce,t).first<{key:string}>()
  if(!lock){
    op=await get()
    if(op?.state==='ready')return readyResult(db,op)
    fail(409,'这个文件仍在上传，请稍后点击重试','upload_busy')
  }
  try{
    // R2成功、D1未完成时用原对象恢复，不能重新分配key或再写一份。
    const existing=await bucket.head(op!.key)
    if(existing){
      if(existing.customMetadata?.uploadFingerprint!==fingerprint||existing.size!==size)fail(409,'上传对象校验失败，请重新选择文件')
    }else{
      await bucket.put(op!.key,input.source?input.source.body:input.bytes,{httpMetadata:{contentType:mime},customMetadata:{uploadFingerprint:fingerprint}})
    }
    await db.batch([
      db.prepare(`INSERT INTO uploads(key,user_id,mime,size,created_at)
        SELECT key,user_id,mime,size,created_at FROM upload_operations WHERE user_id=? AND nonce=? AND state='pending' AND lease_token=?
        ON CONFLICT(key) DO NOTHING`).bind(uid,nonce,token),
      db.prepare(`UPDATE upload_operations SET state='ready',lease_token='',lease_until=0 WHERE user_id=? AND nonce=? AND state='pending' AND lease_token=?
        AND EXISTS(SELECT 1 FROM uploads u WHERE u.key=upload_operations.key AND u.user_id=upload_operations.user_id AND u.mime=upload_operations.mime AND u.size=upload_operations.size)`)
        .bind(uid,nonce,token),
    ])
    op=await get()
    if(op?.state!=='ready')fail(409,'上传状态已变化，请点击重试','upload_busy')
    return await readyResult(db,op!)
  }catch(error){
    // 若D1也暂不可用，租约自行过期。回执及R2对象保留给恢复/清理，不在这里盲删。
    await db.prepare("UPDATE upload_operations SET lease_token='',lease_until=0 WHERE user_id=? AND nonce=? AND state='pending' AND lease_token=?")
      .bind(uid,nonce,token).run().catch(()=>{})
    throw error
  }
}

// MATERIALIZED 固定整个候选集合；任何一项失效都不消费其余项，和清理互斥。
export async function claimUploadKeys(db:D1Database,uid:number,keys:string[],allowUsed=false):Promise<boolean>{
  const unique=[...new Set(keys)]
  if(!unique.length)return true
  const {results}=await db.prepare(`WITH candidates AS MATERIALIZED (
      SELECT key FROM uploads WHERE user_id=? AND (used=0 OR (?=1 AND used=1)) AND key IN (SELECT value FROM json_each(?))
    ) UPDATE uploads SET used=1 WHERE key IN (SELECT key FROM candidates) AND (SELECT COUNT(*) FROM candidates)=? RETURNING key`)
    .bind(uid,allowUsed?1:0,JSON.stringify(unique),unique.length).all<{key:string}>()
  return results.length===unique.length
}

// D1 batch 是事务。认领、数量断言、内容必须同批提交，不能失败后用 used=0 补偿（会覆盖并发成功）。
export async function commitUploadContent(db:D1Database,uid:number,keys:string[],content:D1PreparedStatement[],allowUsed=false):Promise<D1Result[]>{
  const unique=[...new Set(keys)]
  if(!unique.length)return content.length?db.batch(content):[]
  const encoded=JSON.stringify(unique)
  try{
    const results=await db.batch([
      db.prepare(`WITH candidates AS MATERIALIZED (
        SELECT key FROM uploads WHERE user_id=? AND (used=0 OR (?=1 AND used=1)) AND key IN (SELECT value FROM json_each(?))
      ) UPDATE uploads SET used=1 WHERE key IN (SELECT key FROM candidates) AND (SELECT COUNT(*) FROM candidates)=?`)
        .bind(uid,allowUsed?1:0,encoded,unique.length),
      // SQLite 的 RAISE 仅可用于触发器；无效 JSON 在数量不符时使整个 batch 回滚。
      // changes() 读取上一条 UPDATE 的直接变更数，不包含触发器产生的变更。
      db.prepare("SELECT json(CASE WHEN changes()=? THEN 'true' ELSE 'upload_claim_conflict' END)").bind(unique.length),
      ...content,
    ])
    return results.slice(2)
  }catch(error){
    // 只在失败路径补查：失效/并发消费给出可操作提示，其余保留原数据库错误。
    const valid=await db.prepare('SELECT COUNT(*) AS n FROM uploads WHERE user_id=? AND (used=0 OR (?=1 AND used=1)) AND key IN (SELECT value FROM json_each(?))')
      .bind(uid,allowUsed?1:0,encoded).first<{n:number}>().catch(()=>null)
    if(valid&&valid.n!==unique.length)fail(400,'文件已失效或已使用，请重新上传')
    throw error
  }
}

// 每小时有界处理，不扫描R2。失败记录保留一小时后重试；成功删除后才移除清理依据。
export async function cleanupUploads(db:D1Database,bucket:R2Bucket,t:number,limit=100){
  const cap=Math.max(1,Math.min(100,Math.trunc(limit))),cutoff=t-CLEANUP_SECONDS
  await db.prepare(`INSERT INTO upload_operations(user_id,nonce,key,fingerprint,mime,size,state,created_at,cleanup_after)
    SELECT u.user_id,'legacy-'||u.key,u.key,'',u.mime,u.size,'deleting',u.created_at,?
    FROM uploads u WHERE u.used=0 AND u.created_at<=? AND NOT EXISTS(SELECT 1 FROM upload_operations o WHERE o.key=u.key)
    ORDER BY u.created_at LIMIT ? ON CONFLICT DO NOTHING`).bind(t,cutoff,cap).run()
  const {results}=await db.prepare('SELECT key FROM upload_operations WHERE cleanup_after<=? ORDER BY cleanup_after,key LIMIT ?')
    .bind(t,cap).all<{key:string}>()
  if(!results.length)return {examined:0,deleted:0,failed:false}
  const keys=JSON.stringify(results.map(r=>r.key))
  await db.batch([
    db.prepare(`UPDATE upload_operations SET state='deleting',lease_token='' WHERE key IN (SELECT value FROM json_each(?)) AND lease_until<=?
      AND NOT EXISTS(SELECT 1 FROM uploads u WHERE u.key=upload_operations.key AND u.used=1)`).bind(keys,t),
    db.prepare(`DELETE FROM uploads WHERE used=0 AND key IN (SELECT value FROM json_each(?))
      AND EXISTS(SELECT 1 FROM upload_operations o WHERE o.key=uploads.key AND o.state='deleting')`).bind(keys),
    db.prepare(`DELETE FROM upload_operations WHERE key IN (SELECT value FROM json_each(?))
      AND EXISTS(SELECT 1 FROM uploads u WHERE u.key=upload_operations.key AND u.used=1)`).bind(keys),
    db.prepare('UPDATE upload_operations SET cleanup_after=? WHERE key IN (SELECT value FROM json_each(?))').bind(t+3600,keys),
  ])
  const deleting=(await db.prepare("SELECT key FROM upload_operations WHERE state='deleting' AND key IN (SELECT value FROM json_each(?))")
    .bind(keys).all<{key:string}>()).results.map(r=>r.key)
  if(!deleting.length)return {examined:results.length,deleted:0,failed:false}
  try{await bucket.delete(deleting)}catch{return {examined:results.length,deleted:0,failed:true}}
  await db.prepare("DELETE FROM upload_operations WHERE state='deleting' AND key IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(deleting)).run()
  return {examined:results.length,deleted:deleting.length,failed:false}
}
