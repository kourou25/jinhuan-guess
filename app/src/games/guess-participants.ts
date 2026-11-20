// Use the same source rows as participant_count; never expose guesses or answers.
export async function publicGuessParticipants(db:D1Database,packetId:string,questionTable:string,ownerId:number,messageId:number,offset:number){
 if(!['ldc_questions','guess_free_questions'].includes(questionTable))throw Error('Invalid question table')
 const people=`WITH people AS (SELECT user_id FROM ${questionTable} WHERE packet_id=?1
 UNION SELECT user_id FROM guess_room_messages WHERE packet_id=?1 AND deleted=0)
 `;
 const [count,rows]=await db.batch([
  db.prepare(people+'SELECT COUNT(*) AS n FROM people WHERE user_id<>?2').bind(packetId,ownerId),
  db.prepare(people+`SELECT p.user_id AS id,COALESCE(u.nick,u.name,u.username,'玩家') AS name,u.avatar
   FROM people p LEFT JOIN users u ON u.id=p.user_id WHERE p.user_id<>?2 ORDER BY p.user_id LIMIT 101 OFFSET ?3`).bind(packetId,ownerId,offset),
 ]);
 return {message_id:messageId,total:Number(count.results[0]?.n)||0,items:rows.results.slice(0,100),next:rows.results.length>100?offset+100:null};
}
