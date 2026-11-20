import {AI_BOT_ID,ensureAiBot} from '../ai/images'

// Beijing 23:30; allow a ten-minute recovery window, never replay yesterday's reminder.
export function sleepReminderDay(at:number){
 if(!Number.isSafeInteger(at)||at<0)return null
 const local=new Date((at+28800)*1000)
 return local.getUTCHours()===23&&local.getUTCMinutes()>=30&&local.getUTCMinutes()<40?local.toISOString().slice(0,10):null
}
export async function sendSleepReminder(db:D1Database,at:number){
 const day=sleepReminderDay(at)
 if(!day)return
 const groups=await db.prepare(`SELECT g.id FROM chat_groups g WHERE g.is_default=1
 AND EXISTS(SELECT 1 FROM chat_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=g.id AND u.kind='user' AND u.disabled=0)
 AND NOT EXISTS(SELECT 1 FROM chat_messages WHERE system_kind='sleep_reminder' AND system_ref='sleep:'||g.id||':'||?)`).bind(day).all<{id:number}>()
 if(!groups.results.length||!await ensureAiBot(db,at))return
 await db.batch(groups.results.map(g=>db.prepare(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
 VALUES(?,?,?,?,?,'sleep_reminder',?)`).bind(g.id,AI_BOT_ID,'23:30啦，今天就到这里吧。记得放下手机，早点休息。晚安，明天见！',at,at,'sleep:'+g.id+':'+day)))
}
