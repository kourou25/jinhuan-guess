import {randHex,sha256} from '../lib/crypto'
import {mergeEligibilityQuery,type MergeEligibilityInput} from './account-merge-eligibility'

// 顺序稳定的凭据快照；last_seen/last_login_at不是安全版本，普通浏览或登录不使确认失效。
// 密码哈希只保存在服务器内部auth_tokens，不通过检查接口返回。
const snapshotSql=(id:string)=>`(SELECT json_object('id',u.id,'username',u.username,'created_at',u.created_at,
 'kind',u.kind,'disabled',u.disabled,'role',u.role,'is_admin',u.is_admin,'silenced',u.silenced,
 'identities',json((SELECT json_group_array(json_object('provider',provider,'subject',subject,'email',email,
   'username',username,'verified_at',verified_at,'created_at',created_at)) FROM
   (SELECT * FROM identities WHERE user_id=u.id ORDER BY provider,subject))),
 'password',(SELECT json_object('hash',hash,'updated_at',updated_at) FROM passwords WHERE user_id=u.id))
 FROM users u WHERE u.id=${id})`
export async function mergeAccountSnapshot(db:D1Database,id:number){
 return (await db.prepare(`SELECT ${snapshotSql('?')} AS snapshot`).bind(id).first<{snapshot:string|null}>())?.snapshot??null
}
export type MergePayload={v:1;sourceId:number;provider:'google'|'linuxdo';subject:string;sessionHash:string;targetSnapshot:string;sourceSnapshot:string}
export function parseMergePayload(raw:string|null):MergePayload|null{
 try{const p=JSON.parse(raw??'null');if(!p||Array.isArray(p)||p.v!==1||!Number.isSafeInteger(p.sourceId)||p.sourceId===0
  ||!['google','linuxdo'].includes(p.provider)||typeof p.subject!=='string'||!p.subject||p.subject.length>255
  ||typeof p.sessionHash!=='string'||!/^[a-f0-9]{64}$/.test(p.sessionHash)
  ||['targetSnapshot','sourceSnapshot'].some(k=>typeof p[k]!=='string'||!p[k]||p[k].length>65536))return null
  for(const key of ['targetSnapshot','sourceSnapshot']){const s=JSON.parse(p[key]);if(!s||!Array.isArray(s.identities)||typeof s.username!=='string')return null}
  return p
 }catch{return null}
}
type IssueInput={targetId:number;sessionHash:string;provider:'google'|'linuxdo';subject:string;oauthHash:string;now:number;ownerIds:number[]}
export async function issueMergeConfirmation(db:D1Database,input:IssueInput){
 const {targetId,sessionHash,provider,subject,oauthHash,now:t,ownerIds}=input
 const row=await db.prepare('SELECT payload FROM auth_tokens WHERE token_hash=? AND kind=? AND user_id=? AND used_at IS NULL AND expires_at>?')
  .bind(oauthHash,'oauth_'+provider,targetId,t).first<{payload:string}>()
 if(!row)return null
 let intent:Record<string,unknown>;try{intent=JSON.parse(row.payload)}catch{return null}
 if(!intent||intent.intent!=='bind'||intent.userId!==targetId||intent.sessionHash!==sessionHash
   ||typeof intent.mergeTargetSnapshot!=='string')return null
 const identity=await db.prepare('SELECT user_id FROM identities WHERE provider=? AND subject=?').bind(provider,subject).first<{user_id:number}>()
 if(!identity||identity.user_id===targetId)return null
 const sourceId=identity.user_id,sourceSnapshot=await mergeAccountSnapshot(db,sourceId)
 if(!sourceSnapshot)return null
 const payload:MergePayload={v:1,sourceId,provider,subject,sessionHash,targetSnapshot:intent.mergeTargetSnapshot,sourceSnapshot}
 const encoded=JSON.stringify(payload);if(!parseMergePayload(encoded))return null
 const eligibility=mergeEligibilityQuery({targetId,sourceId,provider,subject,now:t,ownerIds})
 const raw=randHex(),tokenHash=await sha256(raw),claim=crypto.randomUUID()
 const result=await db.batch([
  db.prepare(`UPDATE auth_tokens SET used_at=?,claim_id=? WHERE token_hash=? AND kind=? AND user_id=? AND payload=?
   AND used_at IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>?)
   AND ${snapshotSql('?')}=? AND ${snapshotSql('?')}=? AND (${eligibility.sql})='ok'`)
   .bind(t,claim,oauthHash,'oauth_'+provider,targetId,row.payload,t,sessionHash,targetId,t,
    targetId,payload.targetSnapshot,sourceId,sourceSnapshot,...eligibility.args),
  db.prepare(`INSERT INTO auth_tokens(token_hash,kind,user_id,payload,expires_at,created_at)
   SELECT ?,'merge',?,?,?,? WHERE EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=? AND claim_id=?)`)
   .bind(tokenHash,targetId,encoded,t+600,t,oauthHash,claim),
 ])
 return result[0].meta.changes===1&&result[1].meta.changes===1?raw:null
}

// MG05最终claim必须使用本查询作为标量守卫，不能把readMergeConfirmation的旧返回值当授权。
export function mergeConfirmationQuery(input:{targetId:number;sessionHash:string;tokenHash:string;now:number;ownerIds:number[]},payloadText:string,p:MergePayload){
 const eligibility=mergeEligibilityQuery({targetId:input.targetId,sourceId:p.sourceId,provider:p.provider,subject:p.subject,now:input.now,ownerIds:input.ownerIds} satisfies MergeEligibilityInput)
 return {sql:`SELECT CASE WHEN EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=? AND kind='merge' AND user_id=?
   AND payload=? AND used_at IS NULL AND expires_at>?) AND ?=?
   AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>?)
   AND ${snapshotSql('?')}=? AND ${snapshotSql('?')}=? AND (${eligibility.sql})='ok' THEN 1 ELSE 0 END AS valid`,
  args:[input.tokenHash,input.targetId,payloadText,input.now,input.sessionHash,p.sessionHash,input.sessionHash,input.targetId,input.now,
   input.targetId,p.targetSnapshot,p.sourceId,p.sourceSnapshot,...eligibility.args]}
}
export async function readMergeConfirmation(db:D1Database,input:{targetId:number;sessionHash:string;tokenHash:string;now:number;ownerIds:number[]}){
 const row=await db.prepare("SELECT payload FROM auth_tokens WHERE token_hash=? AND kind='merge' AND user_id=? AND used_at IS NULL AND expires_at>?")
  .bind(input.tokenHash,input.targetId,input.now).first<{payload:string}>()
 const p=row&&parseMergePayload(row.payload);if(!row||!p)return null
 const query=mergeConfirmationQuery(input,row.payload,p)
 if((await db.prepare(query.sql).bind(...query.args).first<{valid:number}>())?.valid!==1)return null
 return {payload:p,payloadText:row.payload,query}
}
