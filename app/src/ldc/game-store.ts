import type {C} from '../types'
import type {NativePacket} from './packets'
import {now} from '../lib/time'

export const gameOpen=`p.state='open' AND p.ends_at>? AND (SELECT count(*) FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.recipient_id IS NOT NULL)<p.count`
export const freeOpen=`p.state='open' AND p.ends_at>? AND p.winner_id IS NULL`
export const gameStores=[{rounds:'ldc_packets',history:'idx_ldc_guess_history',open:gameOpen,reward:'ldc',total:'p.total_cents'},{rounds:'guess_free_rounds',history:'idx_free_guess_history',open:freeOpen,reward:'none',total:'0'}] as const
// Identifiers are selected only from this server-owned map; request input is never an identifier.
export const gameTables=(p:NativePacket)=>p.reward_type==='none'
 ?{rounds:'guess_free_rounds',questions:'guess_free_questions',cache:'guess_free_cache',open:freeOpen}
 :{rounds:'ldc_packets',questions:'ldc_questions',cache:'ldc_question_cache',open:gameOpen}
export async function activeGame(c:C,gid:number){
 const at=now(),paid=await c.env.DB.prepare(`SELECT * FROM ldc_packets p WHERE p.group_id=? AND p.mode IN ('guess','clues') AND ${gameOpen} ORDER BY p.created_at DESC LIMIT 1`).bind(gid,at).first<NativePacket>()
 // The database enforces one active round across both stores.
 return paid||await c.env.DB.prepare(`SELECT *,'none' AS reward_type FROM guess_free_rounds p WHERE p.group_id=? AND ${freeOpen} LIMIT 1`).bind(gid,at).first<NativePacket>()
}
export async function loadGame(c:C,gid:number,mid=0){
 // Each branch uses its group history index, or the unique message / packet key.
 const find=(store:typeof gameStores[number])=>c.env.DB.prepare(`SELECT p.*,'${store.reward}' AS reward_type,m.id AS message_id,COALESCE(u.nick,u.name,u.username) AS owner_name
  FROM ${store.rounds} p ${mid?'':`INDEXED BY ${store.history}`} JOIN chat_redpacks r ON r.id=p.packet_id JOIN chat_messages m ON m.id=r.message_id LEFT JOIN users u ON u.id=p.owner_id
  WHERE p.group_id=? AND p.mode IN ('guess','clues') AND m.deleted=0 ${mid?'AND m.id=?':''}
  ORDER BY p.created_at DESC,m.id DESC LIMIT 1`).bind(gid,...mid?[mid]:[]).first<NativePacket&{message_id:number;owner_name:string}>()
 if(mid){for(const store of gameStores){const row=await find(store);if(row)return row}return null}
 const rows=await Promise.all(gameStores.map(find))
 return rows.filter((r):r is NonNullable<typeof r>=>!!r).sort((a,b)=>b.created_at-a.created_at||b.message_id-a.message_id)[0]||null
}
