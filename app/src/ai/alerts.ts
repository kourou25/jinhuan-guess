const reasons=['cap','breaker','configuration'] as const
export type AiAlert={kind:'ai_alert';meme_id:number;gid:number;user_id:number;val:string;at:number;unread:boolean}
// 沿用铃铛的每人已读状态。日+原因形成稳定整数ID，不暴露设置key或原始JSON。
export async function aiAlerts(db:D1Database,uid:number,since:number,read:number,t:number):Promise<AiAlert[]>{
 const date=(time:number)=>new Date((time+28800)*1000).toISOString().slice(0,10)
 const [records,reads]=await db.batch<Record<string,unknown>>([
  db.prepare('SELECT k,v FROM site_settings WHERE k>=? AND k<? ORDER BY k DESC LIMIT 100').bind(`ai.alert.${date(since)}.`,`ai.alert.${date(t)}~`),
  db.prepare("SELECT meme_id,at FROM notif_reads WHERE user_id=? AND kind='ai_alert' AND actor_id=0 AND at>? ORDER BY at DESC LIMIT 100").bind(uid,since),
 ])
 const seen=new Set(reads.results.map(r=>`${r.meme_id}:${r.at}`)),alerts:AiAlert[]=[]
 for(const row of records.results){
  const match=/^ai\.alert\.(\d{4}-\d{2}-\d{2})\.(cap|breaker|configuration)$/.exec(String(row.k));if(!match)continue
  let value:{reason?:unknown;at?:unknown}|null;try{value=JSON.parse(String(row.v))}catch{continue}
  if(!value||value.reason!==match[2]||typeof value.at!=='number'||!Number.isSafeInteger(value.at)||value.at<=since||value.at>t||date(value.at)!==match[1])continue
  const id=Number(match[1].replaceAll('-',''))*10+reasons.indexOf(match[2] as typeof reasons[number])+1
  alerts.push({kind:'ai_alert',meme_id:id,gid:-2,user_id:0,val:match[2],at:value.at,unread:value.at>read&&!seen.has(`${id}:${value.at}`)})
 }
 return alerts
}
