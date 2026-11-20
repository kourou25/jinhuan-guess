import type {User} from '../types'
import {canManage} from './auth'

export const canDeleteComment=(u:User|null,comment:{user_id:number;kind:string;author_id:number|null})=>
 canManage(u,comment.user_id)||!!u&&comment.kind==='bot'&&comment.author_id===u.id

export async function deleteComment(db:D1Database,id:number,u:User){
 // 权限和未删除状态在事务内重核。先按仍存在的评论扣计数，再软删；并发重复请求只扣一次。
 const allowed=`SELECT c.id FROM comments c JOIN users cu ON cu.id=c.user_id JOIN memes m ON m.id=c.meme_id
  WHERE c.id=? AND c.deleted=0 AND (c.user_id=? OR ?=1 OR (cu.kind='bot' AND m.author_id=?))`
 const args=[id,u.id,u.is_admin===1?1:0,u.id]
 await db.batch([
  db.prepare(`UPDATE memes SET comment_count=MAX(comment_count-1,0) WHERE id=(SELECT meme_id FROM comments WHERE id IN (${allowed}))`).bind(...args),
  db.prepare(`UPDATE comments SET deleted=1 WHERE id IN (${allowed})`).bind(...args),
 ])
}
