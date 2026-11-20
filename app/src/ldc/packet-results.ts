import {money} from './core'
export async function publishPacketResults(db:D1Database,t:number){
 const jobs=await db.prepare('SELECT packet_id,revision FROM packet_notice_jobs WHERE due_at<=? ORDER BY due_at LIMIT 10').bind(t).all<{packet_id:string;revision:number}>()
 for(const {packet_id:id,revision} of jobs.results){
  const p=await db.prepare(`SELECT p.*,m.id message_id,m.deleted,d.draw_at,d.settled_at FROM ldc_packets p JOIN chat_redpacks r ON r.id=p.packet_id JOIN chat_messages m ON m.id=r.message_id LEFT JOIN packet_draws d ON d.packet_id=p.packet_id WHERE p.packet_id=?`).bind(id).first<any>()
  if(!p)continue
  const rows=(await db.prepare(`SELECT a.recipient_id,a.amount_cents,a.state,COALESCE(u.nick,u.name,u.username) name FROM ldc_awards a LEFT JOIN users u ON u.id=a.recipient_id WHERE a.packet_id=? ORDER BY slot`).bind(id).all<any>()).results
  if(p.draw_at&&!p.settled_at||!p.draw_at&&p.state==='open'&&p.ends_at>t&&rows.some(r=>r.recipient_id===null)){await db.prepare('UPDATE packet_notice_jobs SET due_at=? WHERE packet_id=? AND revision=?').bind(p.draw_at||p.ends_at,id,revision).run();continue}
  const claimed=rows.filter(r=>r.recipient_id!==null),coin=p.payment_provider==='coin52',unit=coin?'D币':'LDC',amount=(n:number)=>coin?String(n/100):money(n)
  const result=claimed.length?claimed.slice(0,12).map(r=>`${r.name} ${amount(r.amount_cents)} ${unit}${r.state==='accepted'?'':r.state==='rejected'?'（待发包者处理）':'（待核对发放）'}`).join('、')+(claimed.length>12?'等；完整记录见红包':''):'无人领取'
  const complete=claimed.length>=2&&claimed.every(r=>r.state==='accepted'),hi=Math.max(...claimed.map(r=>r.amount_cents)),lo=Math.min(...claimed.map(r=>r.amount_cents))
  const luck=p.mode==='random'&&complete&&hi>lo?'\n手气王：'+claimed.filter(r=>r.amount_cents===hi).map(r=>r.name).join('、')+'；手气亡：'+claimed.filter(r=>r.amount_cents===lo).map(r=>r.name).join('、'):''
  const cancelled=!!p.draw_at&&p.settled_at!==null&&p.settled_at<p.draw_at
  const body=cancelled?'红包抽奖已取消，本轮未开奖。':(p.draw_at?'红包开奖结果：':'红包已结束：')+result+luck
  const event=(uid:number,text:string)=>db.prepare(`INSERT INTO packet_events(packet_id,user_id,kind,body,created_at) SELECT ?,?,'result',?,? WHERE EXISTS(SELECT 1 FROM packet_notice_jobs WHERE packet_id=? AND revision=?) ON CONFLICT(packet_id,user_id,kind) DO UPDATE SET body=excluded.body WHERE body<>excluded.body`).bind(id,uid,text,t,id,revision)
  const statements=[db.prepare(`INSERT INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref) SELECT ?,?,?,?,?,'redpack_result',? WHERE ?=0 AND EXISTS(SELECT 1 FROM packet_notice_jobs WHERE packet_id=? AND revision=?) ON CONFLICT DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at WHERE chat_messages.system_kind='redpack_result' AND chat_messages.deleted=0 AND chat_messages.body<>excluded.body`).bind(p.group_id,p.owner_id,body,t,t,String(p.message_id),p.deleted,id,revision),event(p.owner_id,body),
   db.prepare(`INSERT INTO packet_events(packet_id,user_id,kind,body,created_at)
    SELECT ?1,e.user_id,'result',CASE WHEN a.recipient_id IS NULL THEN ?2 ELSE '你获得 '||CASE WHEN ?3=1 THEN CAST(a.amount_cents/100 AS TEXT) ELSE printf('%.2f',a.amount_cents/100.0) END||' '||?4||'，'||CASE WHEN a.state='accepted' THEN ?5 WHEN a.state='rejected' THEN '发放待发包者处理，中奖名额保留。' ELSE '发放结果待核对，中奖名额保留。' END END,?6
    FROM (SELECT user_id FROM packet_draw_entries WHERE packet_id=?1 UNION SELECT recipient_id FROM ldc_awards WHERE packet_id=?1 AND recipient_id IS NOT NULL) e
    LEFT JOIN ldc_awards a ON a.packet_id=?1 AND a.recipient_id=e.user_id WHERE e.user_id<>?7 AND EXISTS(SELECT 1 FROM packet_notice_jobs WHERE packet_id=?1 AND revision=?8)
    ON CONFLICT(packet_id,user_id,kind) DO UPDATE SET body=excluded.body WHERE body<>excluded.body`).bind(id,cancelled?'红包已取消，本轮未开奖。':'本次未抽中；可打开红包查看完整结果。',coin?1:0,unit,coin?'已到账本站钱包。':p.payment_provider==='fish'?'已到账 Fish 🐟额。':'Credit 已受理。',t,p.owner_id,revision),
   db.prepare(`UPDATE chat_redpacks SET draw_data=json_set(draw_data,'$.draw_complete',json('true')) WHERE id=? AND draw_data IS NOT NULL AND EXISTS(SELECT 1 FROM packet_notice_jobs WHERE packet_id=? AND revision=?)`).bind(id,id,revision)]
  // Idempotent events allow bounded batches after a worker restart.
  for(let i=0;i<statements.length;i+=40)await db.batch(statements.slice(i,i+40))
  await db.prepare('DELETE FROM packet_notice_jobs WHERE packet_id=? AND revision=?').bind(id,revision).run()
 }
}
