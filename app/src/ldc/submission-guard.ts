import type {C,User} from '../types'
import type {NativePacket} from './packets'
import {gameTables} from './game-store'
import {now} from '../lib/time'
import {fail} from '../lib/http'

// Embedded in the INSERT, so two different requests cannot both pass a read-then-write check.
// All identifiers and parameter expressions come from server code, never from request input.
export function guessAdmissionSql(questions:string,uid:string,at:string,roomId='0'){
 return `NOT EXISTS(SELECT 1 FROM guess_room_messages busy
  WHERE busy.packet_id=p.packet_id AND busy.user_id=${uid} AND busy.deleted=0
  AND (busy.ai_status IS NULL OR busy.ai_status='pending') AND busy.created_at>${at}-45 AND busy.id<>${roomId})
  AND NOT EXISTS(SELECT 1 FROM ${questions} pending
  WHERE pending.packet_id=p.packet_id AND pending.user_id=${uid} AND pending.verdict='pending' AND pending.created_at>${at}-45)`
}

export async function rejectPendingGuess(c:C,p:NativePacket,u:User,roomId=0){
 const at=now(),tables=gameTables(p)
 const busy=await c.env.DB.prepare(`SELECT 1 FROM ${tables.rounds} p WHERE p.packet_id=?1 AND NOT (${guessAdmissionSql(tables.questions,'?2','?3','?4')})`)
  .bind(p.packet_id,u.id,at,roomId).first()
 if(!busy)return
 // One observation per player/round. Repeated collisions never increment or rewrite it.
 // This is a concurrency diagnostic, not evidence of cheating; quota cleanup bounds retention.
 const day=new Date((p.created_at+28800)*1000).toISOString().slice(0,10)
 await c.env.DB.prepare('INSERT OR IGNORE INTO quota_usage(day,scope,key,n) VALUES(?,?,?,1)')
  .bind(day,'guess:overlap:'+p.packet_id,u.id).run().catch(()=>console.error('guess_overlap_observation_failed'))
 c.header('Retry-After','2')
 fail(429,'上一条猜词或提问仍在处理，请等待结果后再发送。','guess_pending')
}

export async function guessSubmissionSignals(c:C){
 const day=new Date((now()-7*86400+28800)*1000).toISOString().slice(0,10)
 const rows=await c.env.DB.prepare(`SELECT s.scope,s.day,u.id AS user_id,COALESCE(u.nick,u.name,u.username) AS name,u.avatar
  FROM (SELECT key,scope,day FROM quota_usage WHERE scope GLOB 'guess:overlap:*' AND day>=? ORDER BY day DESC,scope,key LIMIT 50) s
  LEFT JOIN users u ON u.id=s.key
  ORDER BY s.day DESC,s.scope,s.key`).bind(day).all<{scope:string;day:string;user_id:number|null;name:string|null;avatar:string|null}>()
 return {items:rows.results.map(({scope,...r})=>({...r,packet_id:scope.slice('guess:overlap:'.length)})),notice:'同账号同局并发提交的首次记录，仅供排查；网络重试、多标签等也可能触发，不代表使用了AI，不自动处罚。',retention_days:60}
}
