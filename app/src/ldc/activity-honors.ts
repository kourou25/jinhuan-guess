import type {NativePacket} from './packets'
import {gameTables} from './game-store'

// Called before the close CAS in the same D1 batch. Each event is immutable/idempotent.
export function exhaustedHonorStatements(db:D1Database,p:NativePacket,guard:string,at:number){
 const {rounds}=gameTables(p)
 return [
  db.prepare(`INSERT OR IGNORE INTO activity_honor_events(event_key,user_id,series,created_at)
   SELECT p.packet_id,v.user_id,'guess_pressure',?2 FROM ${rounds} p
   JOIN guess_rate_participants v ON v.packet_id=p.packet_id JOIN users u ON u.id=v.user_id
   WHERE p.packet_id=?1 AND p.state='open' AND (${guard}) AND u.disabled=0 AND u.kind='user'`).bind(p.packet_id,at),
  db.prepare(`INSERT OR IGNORE INTO activity_honor_events(event_key,user_id,series,created_at)
   SELECT p.packet_id,p.owner_id,'guess_tormentor',?2 FROM ${rounds} p JOIN users u ON u.id=p.owner_id
   WHERE p.packet_id=?1 AND p.state='open' AND (${guard}) AND u.disabled=0 AND u.kind='user'`).bind(p.packet_id,at),
 ]
}
