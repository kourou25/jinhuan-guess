import type {C} from '../types'
import {fail} from '../lib/http'
import {normalizeAnswer,unseal} from './core'

export async function wordFingerprint(key:string,gid:number,answer:string){
 const bytes=Uint8Array.from(atob(key),c=>c.charCodeAt(0)),enc=new TextEncoder()
 const hmac=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign'])
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',hmac,enc.encode('ldc-word:'+gid+':'+normalizeAnswer(answer))))].map(b=>b.toString(16).padStart(2,'0')).join('')
}
export const wordSeen=(c:C,gid:number,hash:string)=>c.env.DB.prepare('SELECT 1 FROM ldc_word_history WHERE group_id=? AND answer_hash=?').bind(gid,hash).first()
export const rememberWords=(c:C,gid:number,id:string,t:number,hashes:string[],exclusive=false,table:'ldc_packets'|'guess_free_rounds'='ldc_packets')=>c.env.DB.prepare(`INSERT ${exclusive?'':'OR IGNORE'} INTO ldc_word_history(group_id,answer_hash,packet_id,created_at)
 SELECT ?1,j.value,?2,?3 FROM json_each(?4) j WHERE EXISTS(SELECT 1 FROM ${table} WHERE packet_id=?2)
 AND NOT EXISTS(SELECT 1 FROM ldc_word_history h WHERE h.group_id=?1 AND h.answer_hash=j.value AND h.packet_id=?2)`).bind(gid,id,t,JSON.stringify(hashes))

// One-time, checkpointed history conversion. New packets register in their creation transaction.
// No answer leaves this worker and normal generation reads one progress row, then a primary-key lookup.
export async function ensureWordHistory(c:C,gid:number,key:string){
 const db=c.env.DB
 for(let page=0;page<4;page++){
  const state=await db.prepare('SELECT last_at,last_id,complete FROM ldc_word_history_progress WHERE group_id=?').bind(gid).first<{last_at:number;last_id:string;complete:number}>()
  if(state?.complete)return
  const rows=(await db.prepare(`SELECT packet_id,created_at,answer_box FROM ldc_packets
   WHERE group_id=? AND (created_at,packet_id)>(?,?) ORDER BY created_at,packet_id LIMIT 129`)
   .bind(gid,state?.last_at??0,state?.last_id??'').all<{packet_id:string;created_at:number;answer_box:string|null}>()).results
  const batch=rows.slice(0,128),words:{hash:string;id:string;at:number}[]=[]
  for(const p of batch)if(p.answer_box){
   let answers:unknown
   try{answers=JSON.parse(await unseal(key,'ldc-answer:'+p.packet_id,p.answer_box))}catch{fail(503,'历史题库暂时无法核对，请联系站长检查配置；未创建红包')}
   if(!Array.isArray(answers)||answers.some(a=>typeof a!=='string'))fail(503,'历史题库数据需要核对；未创建红包')
   for(const answer of answers as string[])words.push({hash:await wordFingerprint(key,gid,answer),id:p.packet_id,at:p.created_at})
  }
  const last=batch.at(-1),at=last?.created_at??state?.last_at??0,id=last?.packet_id??state?.last_id??''
  await db.batch([
   db.prepare(`INSERT OR IGNORE INTO ldc_word_history(group_id,answer_hash,packet_id,created_at)
    SELECT ?,json_extract(value,'$.hash'),json_extract(value,'$.id'),json_extract(value,'$.at') FROM json_each(?)`).bind(gid,JSON.stringify(words)),
   db.prepare(`INSERT INTO ldc_word_history_progress(group_id,last_at,last_id,complete) VALUES(?,?,?,?)
    ON CONFLICT(group_id) DO UPDATE SET last_at=excluded.last_at,last_id=excluded.last_id,complete=excluded.complete
    WHERE ldc_word_history_progress.complete=0 AND (last_at,last_id)<=(excluded.last_at,excluded.last_id)`).bind(gid,at,id,rows.length<=128?1:0),
  ])
  if(rows.length<=128)return
 }
 fail(503,'历史题库正在初始化，请稍后再试；未创建红包、未扣款')
}
