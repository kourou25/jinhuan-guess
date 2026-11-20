import {CHAT_HISTORY_FLOOR} from '../services/chat-access'
type Row={id:number;body:string;created_at:number;image_key:string|null;media:string|null;username:string;name:string|null;reply_user:number|null}
const compact=(text:string)=>text.replace(/https?:\/\/\S+/gi,'[链接]').replace(/\s+/g,' ').trim()
export async function chatContext(db:D1Database,gid:number,uid:number,username:string,n:number,after=0){
 const latest=await db.prepare(`SELECT x.created_at,cm.joined_at,${CHAT_HISTORY_FLOOR} AS history_floor FROM chat_members cm JOIN chat_messages x ON x.group_id=cm.group_id
 WHERE cm.group_id=? AND cm.user_id=? AND x.deleted=0 AND x.system_kind IS NULL ORDER BY x.id DESC LIMIT 1`).bind(gid,uid).first<{created_at:number;joined_at:number;history_floor:number}>()
 if(!latest)return {text:'',count:0,from_id:0,to_id:0}
 const rows=await db.prepare(`SELECT x.id,substr(x.body,1,2000) body,x.created_at,x.image_key,x.media,u.username,COALESCE(u.nick,u.name,u.username) name,r.user_id reply_user
 FROM chat_messages x JOIN users u ON u.id=x.user_id LEFT JOIN chat_messages r ON r.id=x.reply_to AND r.group_id=x.group_id AND r.deleted=0
 WHERE x.group_id=? AND x.deleted=0 AND x.system_kind IS NULL AND x.created_at>=? AND x.id>?
 ORDER BY x.id DESC LIMIT ?`).bind(gid,Math.max(latest.created_at-86400,latest.joined_at),Math.max(after,latest.history_floor-1),n).all<Row>()
 const mention=new RegExp('(^|[^\\w])@'+username.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![\\w-])','i')
 const entries=rows.results.map(row=>{
  let media='';try{const list=JSON.parse(row.media??'null');if(Array.isArray(list)&&list.length)media=list.some(m=>m?.kind==='f')?' [文件]':' [图片]'}catch{}
  if(!media&&row.image_key)media=' [图片]'
  const me=mention.test(row.body)||row.reply_user===uid
  const time=new Date((row.created_at+28800)*1000).toISOString().slice(11,16)
  return {id:row.id,me,text:`${me?'[me] ':''}[${time}] ${compact(row.name||row.username).slice(0,24)}：${compact(row.body)}${media}`}
 })
 const marked=entries.filter(e=>e.me),cap=Math.floor(24000/Math.max(marked.length,1))-1,selected=new Map<number,string>();let used=0
 for(const e of marked){const line=e.text.slice(0,cap);selected.set(e.id,line);used+=line.length+1}
 for(const e of entries){if(e.me||used+e.text.length+1>24000)continue;selected.set(e.id,e.text);used+=e.text.length+1}
 const ids=[...selected.keys()].sort((a,b)=>a-b)
 return {text:ids.map(id=>selected.get(id)).join('\n'),count:ids.length,from_id:ids[0]??0,to_id:ids.at(-1)??0}
}
