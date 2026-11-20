import {guessMembersSql,guessBansSql} from '../services/guess-access'
import type {NativePacket} from './packets'
import {gameTables} from './game-store'

export type CloseCandidate={id:string;user_id:number;question:string;score:number;created_at:number;subject:string|null;username:string|null;name:string}
// Only an unchanged, visible, completed input from a current member can vote or earn compensation.
export const closeEligible=`q.user_id<>p.owner_id AND q.verdict IN('yes','no','similarity')
 AND EXISTS(SELECT 1 FROM users u JOIN ${guessMembersSql} cm ON cm.user_id=u.id AND cm.group_id=p.group_id WHERE u.id=q.user_id AND u.kind='user' AND u.disabled=0 AND u.silenced=0
 AND NOT EXISTS(SELECT 1 FROM account_retirements r WHERE r.source_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM ${guessBansSql} b WHERE b.group_id=p.group_id AND b.user_id=u.id))
 AND ((q.source_room_id IS NOT NULL AND EXISTS(SELECT 1 FROM guess_room_messages m WHERE m.id=q.source_room_id AND m.deleted=0 AND m.body=q.source_body))
 OR (q.source_room_id IS NULL AND EXISTS(SELECT 1 FROM chat_messages m WHERE m.id=q.source_message_id AND m.deleted=0 AND m.body=q.source_body)))`
export function closeUnclaimed(p:NativePacket){return p.reward_type==='none'?'p.winner_id IS NULL':"NOT EXISTS(SELECT 1 FROM ldc_awards a WHERE a.packet_id=p.packet_id AND (a.recipient_id IS NOT NULL OR a.state<>'ready'))"}
export function closeNoPending(p:NativePacket){return `NOT EXISTS(SELECT 1 FROM ${gameTables(p).cache} c WHERE c.packet_id=p.packet_id AND c.state='pending' AND c.budget_reserved=1 AND c.expires_at>unixepoch())`}
export function highAnswer(p:NativePacket){return `EXISTS(SELECT 1 FROM ${gameTables(p).questions} q WHERE q.packet_id=p.packet_id AND q.kind='guess' AND q.score>50 AND ${closeEligible})`}
export async function closeCandidates(db:D1Database,p:NativePacket){
 const tables=gameTables(p)
 return (await db.prepare(`WITH eligible AS MATERIALIZED (
 SELECT q.*,CASE WHEN instr(q.cache_key,':')>0 THEN substr(q.cache_key,instr(q.cache_key,':')+1) ELSE lower(trim(q.question)) END k
 FROM ${tables.questions} q JOIN ${tables.rounds} p ON p.packet_id=q.packet_id
 WHERE q.packet_id=? AND q.kind='guess' AND q.score IS NOT NULL AND q.score<100 AND ${closeEligible}
 ), ranked AS (SELECT *,row_number() OVER(PARTITION BY k ORDER BY created_at,id) first_rank,
 first_value(score) OVER(PARTITION BY k ORDER BY created_at DESC,id DESC) current_score FROM eligible)
 SELECT q.id,q.user_id,q.question,q.current_score score,q.created_at,i.subject,i.username,COALESCE(u.nick,u.name,u.username) name
 FROM ranked q JOIN users u ON u.id=q.user_id LEFT JOIN identities i ON i.user_id=q.user_id AND i.provider='linuxdo' AND i.verified_at IS NOT NULL
 WHERE first_rank=1 ORDER BY current_score DESC,q.created_at,q.id LIMIT 3`).bind(p.packet_id).all<CloseCandidate>()).results
}
export function compensationShares(total:number,unit:number,n:number){
 const pool=Math.floor(total/unit/2),weights=n===1?[100]:n===2?[60,40]:[50,30,20]
 const amounts=weights.slice(0,n).map(w=>Math.floor(pool*w/100));if(amounts.length)amounts[0]+=pool-amounts.reduce((a,b)=>a+b,0)
 return amounts.map(a=>a*unit)
}
