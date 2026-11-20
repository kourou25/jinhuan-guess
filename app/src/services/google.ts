import {emailInput,handleInput} from '../shared/schemas'
import {completeSignup} from './accounts'
import {randHex} from '../lib/crypto'

export type GoogleProfile = {sub:string;email:string|null;emailVerified:boolean;name:string;picture:string|null}
export type GoogleIntent = {intent:'login';next:string;invite:string} | {intent:'bind';next:string;userId:number;sessionHash:string;mergeTargetSnapshot?:string}
export const base64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
export async function pkceChallenge(verifier:string){return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))}

// 仅用于本服务通过固定 HTTPS token 端点、client secret 换取的 ID token。
// 不导出接收浏览器 ID token 的 HTTP 入口；不保存原 token 或 access token。
export function profileFromGoogleToken(token:unknown,clientId:string,nonce:string,t:number):GoogleProfile {
  if(typeof token!=='string'||token.length>16384)throw new Error('invalid_google_token')
  const parts=token.split('.')
  if(parts.length!==3||parts.some(p=>!p||!/^[A-Za-z0-9_-]+$/.test(p)))throw new Error('invalid_google_token')
  const decode=(part:string)=>JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Uint8Array.from(atob(part.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0))))
  const header=decode(parts[0]),p=decode(parts[1])
  if(!header||header.alg!=='RS256'||!p||typeof p!=='object'||Array.isArray(p)
    ||!['https://accounts.google.com','accounts.google.com'].includes(p.iss)||p.aud!==clientId
    ||(p.azp!==undefined&&p.azp!==clientId)||!Number.isSafeInteger(p.exp)||p.exp<=t
    ||!Number.isSafeInteger(p.iat)||p.iat>t+60||p.iat>p.exp||p.nonce!==nonce
    ||typeof p.sub!=='string'||!/^[\x21-\x7e]{1,255}$/.test(p.sub))throw new Error('invalid_google_claims')
  let email:string|null=null
  if(p.email!==undefined)email=emailInput(p.email)
  return {sub:p.sub,email,emailVerified:!!email&&(p.email_verified===true||p.email_verified==='true'),
    name:typeof p.name==='string'?[...p.name.trim()].slice(0,20).join(''):'',
    picture:typeof p.picture==='string'&&/^https:\/\//.test(p.picture)&&p.picture.length<=2048?p.picture:null}
}

type IdentityInput = {tokenHash:string;kind:'oauth_google'|'gpending';intent:GoogleIntent;profile:GoogleProfile;t:number;sessionHash:string;ua:string}
type IdentityResult = {status:'ok';userId:number}|{status:'new'}|{status:'disabled'|'identity-in-use'|'already-bound'|'invalid-state'}
export async function completeGoogleIdentity(db:D1Database,input:IdentityInput):Promise<IdentityResult>{
  const {profile:p,intent,tokenHash,kind,t}=input
  const mapped=await db.prepare("SELECT user_id FROM identities WHERE provider='google' AND subject=?").bind(p.sub).first<{user_id:number}>()
  if(intent.intent==='bind'&&mapped&&mapped.user_id!==intent.userId)return {status:'identity-in-use'}
  if(intent.intent==='login'&&!mapped)return {status:'new'}
  const id=intent.intent==='bind'?intent.userId:mapped!.user_id
  const user=await db.prepare('SELECT disabled,kind FROM users WHERE id=?').bind(id).first<{disabled:number;kind:string}>()
  if(!user||user.disabled||user.kind!=='user')return {status:'disabled'}
  if(intent.intent==='bind'&&await db.prepare("SELECT 1 FROM identities WHERE provider='google' AND user_id=? AND subject<>?").bind(id,p.sub).first())return {status:'already-bound'}
  const claim=crypto.randomUUID(),claimed='EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=? AND claim_id=?)'
  const guard=intent.intent==='bind'?`EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>?)
    AND NOT EXISTS(SELECT 1 FROM identities WHERE provider='google' AND subject=? AND user_id<>?)
    AND NOT EXISTS(SELECT 1 FROM identities WHERE provider='google' AND user_id=? AND subject<>?)`
    :"EXISTS(SELECT 1 FROM identities WHERE provider='google' AND subject=? AND user_id=?)"
  const args=intent.intent==='bind'?[intent.sessionHash,id,t,p.sub,id,id,p.sub]:[p.sub,id]
  const statements=[
    db.prepare(`UPDATE auth_tokens SET used_at=?,claim_id=? WHERE token_hash=? AND kind=? AND used_at IS NULL AND expires_at>?
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND disabled=0 AND kind='user') AND ${guard}`).bind(t,claim,tokenHash,kind,t,id,...args),
    db.prepare(`INSERT INTO identities(provider,subject,user_id,email,verified_at,created_at,last_login_at)
      SELECT 'google',?,?,?,?,?,? WHERE ${claimed} ON CONFLICT(provider,subject) DO UPDATE SET email=excluded.email,
      verified_at=excluded.verified_at,last_login_at=excluded.last_login_at WHERE identities.user_id=excluded.user_id`)
      .bind(p.sub,id,p.email,p.emailVerified?t:null,t,t,tokenHash,claim),
  ]
  if(intent.intent==='bind')statements.push(db.prepare(`UPDATE auth_tokens SET used_at=? WHERE kind='merge' AND used_at IS NULL
    AND (user_id=? OR CASE WHEN json_valid(payload) THEN json_extract(payload,'$.sourceId') END=?) AND ${claimed}`).bind(t,id,id,tokenHash,claim))
  if(intent.intent==='login')statements.push(
    db.prepare(`INSERT INTO sessions(id,user_id,expires_at,created_at,seen_at,method,ua) SELECT ?,?,?,?,?,'google',? WHERE ${claimed}`)
      .bind(input.sessionHash,id,t+2592000,t,t,input.ua.slice(0,120),tokenHash,claim),
    db.prepare(`INSERT OR IGNORE INTO chat_members(group_id,user_id,joined_at,last_read)
      SELECT g.id,?,?,(SELECT COALESCE(MAX(m.id),0) FROM chat_messages m WHERE m.group_id=g.id) FROM chat_groups g
      WHERE g.is_default=1 AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.group_id=g.id AND b.user_id=?) AND ${claimed}`)
      .bind(id,t,id,tokenHash,claim),
  )
  const result=await db.batch(statements)
  return result[0].meta.changes===1?{status:'ok',userId:id}:{status:'invalid-state'}
}

export async function googleHandle(db:D1Database,p:GoogleProfile,owners:string[],random=false){
  let base=(p.email?.split('@')[0]||p.name||'meme').normalize('NFKD').replace(/[^A-Za-z0-9_.-]/g,'').replace(/^[.-]+|[.-]+$/g,'').slice(0,14)
  try{handleInput(base,owners)}catch{base='meme'}
  for(let i=0;i<3;i++){
    const value=random||i?base+'_'+randHex(2):base
    if(!await db.prepare('SELECT 1 FROM users WHERE username=?1 COLLATE NOCASE UNION ALL SELECT 1 FROM memes WHERE author_name=?1 COLLATE NOCASE LIMIT 1').bind(value).first())return value
  }
  return 'meme_'+randHex(6)
}

export type GooglePending = GoogleProfile & {handle:string;nick:string;next:string;invite:string}
export function parseGooglePending(payload:string):GooglePending|null {
  try {
    const p=JSON.parse(payload)
    if(!p||typeof p!=='object'||Array.isArray(p)||typeof p.sub!=='string'||!/^[\x21-\x7e]{1,255}$/.test(p.sub)
      ||!(p.email===null||typeof p.email==='string')||typeof p.emailVerified!=='boolean'
      ||!(p.picture===null||typeof p.picture==='string')
      ||['name','handle','nick','next','invite'].some(key=>typeof p[key]!=='string')||!p.handle)return null
    return p as GooglePending
  }catch{return null}
}
export async function completeGoogleSignup(db:D1Database,input:{tokenHash:string;invite?:string;required:boolean;t:number;sessionHash:string;ua:string;owners:string[]}){
  const row=await db.prepare("SELECT payload FROM auth_tokens WHERE token_hash=? AND kind='gpending' AND used_at IS NULL AND expires_at>?").bind(input.tokenHash,input.t).first<{payload:string}>()
  if(!row)return {status:'invalid-token' as const}
  const p=parseGooglePending(row.payload)
  if(!p)return {status:'invalid-token' as const}
  for(let attempt=0;attempt<3;attempt++){
    const identity=await completeGoogleIdentity(db,{tokenHash:input.tokenHash,kind:'gpending',intent:{intent:'login',next:p.next,invite:p.invite},profile:p,t:input.t,sessionHash:input.sessionHash,ua:input.ua})
    if(identity.status!=='new')return {...identity,next:p.next,created:false}
    const result=await completeSignup(db,{provider:'google',tokenHash:input.tokenHash,handle:attempt?await googleHandle(db,p,input.owners,true):p.handle,invite:input.invite,inviteRequired:input.required,now:input.t,sessionHash:input.sessionHash,userAgent:input.ua})
    if(result.status==='created')return {...result,next:p.next,created:true}
    if(result.status==='handle-taken'||result.status==='email-taken'){
      // identity 可能刚被另一标签页注册；再读映射，不消耗额外邀请码。
      if(attempt<2)continue
    }
    return result
  }
  return {status:'invalid-state' as const}
}
