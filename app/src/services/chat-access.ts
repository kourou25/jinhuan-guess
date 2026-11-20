import {independentGuessRequest,guessBansSql} from './guess-access'
import type {C} from '../types'
import {needUser} from './auth'
import {fail} from '../lib/http'
import {now} from '../lib/time'
export function joinDefaultGroups(c:C,uid:number){
 return c.env.DB.prepare(`INSERT OR IGNORE INTO chat_members(group_id,user_id,joined_at,last_read)
 SELECT g.id,?1,?2,(SELECT COALESCE(MAX(m.id),0) FROM chat_messages m WHERE m.group_id=g.id)
 FROM chat_groups g WHERE g.is_default=1
 AND EXISTS(SELECT 1 FROM users u WHERE u.id=?1 AND u.disabled=0 AND u.kind='user')
 AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.group_id=g.id AND b.user_id=?1)`).bind(uid,now())
}
// 欢迎消息由现有入群触发器原子写入；复用其 ID 为分页提供下界。
// 老数据没有欢迎消息时按 joined_at 过滤，不回填或扩大历史范围。
export const CHAT_HISTORY_FLOOR=`COALESCE((SELECT MAX(j.id) FROM chat_messages j INDEXED BY idx_chat_msg_user
 WHERE j.user_id=cm.user_id AND j.created_at=cm.joined_at AND j.group_id=cm.group_id AND j.system_kind='join'),0)`
export type ChatGroup={id:number;name:string;is_default:number;created_at:number;joined_at:number;history_floor:number;last_read:number|null;away_from:number|null}
export async function needMember(c:C,gid:number,joinDefault=true){
 const u=needUser(c)
 const g=await c.env.DB.prepare(`SELECT g.id,g.name,g.is_default,g.created_at,cm.joined_at,cm.last_read,cm.away_from,${CHAT_HISTORY_FLOOR} AS history_floor
 FROM chat_groups g LEFT JOIN chat_members cm ON cm.group_id=g.id AND cm.user_id=? WHERE g.id=?`).bind(u.id,gid).first<ChatGroup>()
 if(!g)fail(404,'群不存在')
 if(await independentGuessRequest(c,gid)){
  if(await c.env.DB.prepare(`SELECT 1 FROM ${guessBansSql} WHERE group_id=? AND user_id=?`).bind(gid,u.id).first())fail(403,'当前账号暂不可参与游戏')
  return {u,g:{...g!,joined_at:0,history_floor:0,last_read:0,away_from:null}}
 }
 if(g!.last_read==null){
  const ban=await c.env.DB.prepare('SELECT kind FROM chat_bans WHERE group_id=? AND user_id=?').bind(gid,u.id).first<{kind:string}>()
  if(ban)fail(403,ban.kind==='left'?'你已自行退出群聊，请保持看图的纯粹':'群聊已临时关闭')
  if(!g!.is_default||!joinDefault)fail(403,'你不在这个群里')
  await joinDefaultGroups(c,u.id).run()
  const member=await c.env.DB.prepare(`SELECT joined_at,last_read,away_from,${CHAT_HISTORY_FLOOR} AS history_floor FROM chat_members cm WHERE group_id=? AND user_id=?`).bind(gid,u.id).first<{joined_at:number;history_floor:number;last_read:number;away_from:number}>()
  if(!member)fail(403,'你不在这个群里')
  g!.history_floor=member!.history_floor;g!.joined_at=member!.joined_at;g!.last_read=member!.last_read;g!.away_from=member!.away_from
 }
 return {u,g:g!}
}
export async function assertCurrentAccess(c:C,uid:number,gid?:number){
 const user=await c.env.DB.prepare("SELECT id FROM users WHERE id=? AND disabled=0 AND kind='user'").bind(uid).first()
 if(!user)fail(403,'账号暂不可用')
 if(gid!==undefined){
  if(await independentGuessRequest(c,gid)){
   if(await c.env.DB.prepare(`SELECT 1 FROM ${guessBansSql} WHERE group_id=? AND user_id=?`).bind(gid,uid).first())fail(403,'当前账号暂不可参与游戏')
   return
  }
  const member=await c.env.DB.prepare(`SELECT 1 FROM chat_members m JOIN chat_groups g ON g.id=m.group_id
  WHERE m.group_id=?1 AND m.user_id=?2 AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.group_id=?1 AND b.user_id=?2)`).bind(gid,uid).first()
  if(!member)fail(403,'你不在这个群里')
 }
}
