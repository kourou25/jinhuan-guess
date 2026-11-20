import {getCookie} from 'hono/cookie'
import type {C} from '../types'
import {sha256} from '../lib/crypto'
import {fail} from '../lib/http'
import {now} from '../lib/time'
import {verifyPassword} from './password'
import {authConfiguration} from './auth-gate'

export async function accountProof(c:C,id:number,password:unknown){
  const sessionHash=await sha256(getCookie(c,'sid')??''),t=now()
  const row=await c.env.DB.prepare('SELECT hash FROM passwords WHERE user_id=?').bind(id).first<{hash:string}>()
  if(row){
    if(typeof password!=='string'||[...password.normalize('NFKC')].length>128||!await verifyPassword(password,row.hash,c.env.PASSWORD_PEPPER!))fail(401,'当前密码不正确')
    return {sessionHash,passwordHash:row.hash,method:null}
  }
  const session=await c.env.DB.prepare(`SELECT s.method FROM sessions s WHERE s.id=? AND s.user_id=? AND s.expires_at>?
    AND s.created_at>=? AND s.created_at<=? AND s.method IN ('google','linuxdo')
    AND EXISTS(SELECT 1 FROM identities i WHERE i.user_id=s.user_id AND i.provider=s.method)`)
    .bind(sessionHash,id,t,t-300,t).first<{method:string}>()
  if(!session)fail(403,'请重新登录当前账号，再进行此操作','reauth_required')
  return {sessionHash,passwordHash:null,method:session!.method}
}

type EmailChangePayload={sessionHash:string;oldEmail:string|null;passwordHash:string|null;newHash:string|null}
export function parseEmailChange(payload:string|null):EmailChangePayload|null{
  try{const p=JSON.parse(payload??'null');if(!p||Array.isArray(p)||typeof p.sessionHash!=='string'
    ||!(p.oldEmail===null||typeof p.oldEmail==='string')||!(p.passwordHash===null||typeof p.passwordHash==='string')
    ||!(p.newHash===null||typeof p.newHash==='string')||(!p.passwordHash&&!p.newHash))return null;return p}catch{return null}
}
export async function completeEmailChange(db:D1Database,input:{id:number;tokenHash:string;sessionHash:string;t:number}){
  const {id,tokenHash,sessionHash,t}=input
  const row=await db.prepare("SELECT email,payload FROM auth_tokens WHERE token_hash=? AND kind='email' AND user_id=? AND used_at IS NULL AND expires_at>?").bind(tokenHash,id,t).first<{email:string;payload:string}>()
  const p=row&&parseEmailChange(row.payload)
  if(!row||!p||p.sessionHash!==sessionHash)return {status:'invalid' as const}
  const claim=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=? AND claim_id=?)'
  try{
    const result=await db.batch([
      db.prepare(`UPDATE auth_tokens SET used_at=?,claim_id=? WHERE token_hash=? AND kind='email' AND user_id=? AND used_at IS NULL AND expires_at>?
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND disabled=0 AND kind='user')
        AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>?)
        AND COALESCE((SELECT hash FROM passwords WHERE user_id=?),'')=?
        AND (SELECT subject FROM identities WHERE user_id=? AND provider='email') IS ?`)
        .bind(t,claim,tokenHash,id,t,id,sessionHash,id,t,id,p.passwordHash??'',id,p.oldEmail),
      db.prepare(`DELETE FROM identities WHERE user_id=? AND provider='email' AND ${gate}`).bind(id,tokenHash,claim),
      db.prepare(`INSERT INTO identities(provider,subject,user_id,email,verified_at,created_at,last_login_at)
        SELECT 'email',?,?,?,?,?,NULL WHERE ${gate}`).bind(row.email,id,row.email,t,t,tokenHash,claim),
      ...(!p.passwordHash?[db.prepare(`INSERT INTO passwords(user_id,hash,updated_at) SELECT ?,?,? WHERE ${gate}`).bind(id,p.newHash,t,tokenHash,claim)]:[]),
      db.prepare(`DELETE FROM sessions WHERE user_id=? AND id<>? AND ${gate}`).bind(id,sessionHash,tokenHash,claim),
      db.prepare(`DELETE FROM login_fails WHERE user_id=? AND ${gate}`).bind(id,tokenHash,claim),
      db.prepare(`UPDATE auth_tokens SET used_at=? WHERE used_at IS NULL AND
        ((user_id=? AND kind IN ('email','reset','oauth_google','oauth_linuxdo','merge'))
        OR (kind='merge' AND CASE WHEN json_valid(payload) THEN json_extract(payload,'$.sourceId') END=?)) AND ${gate}`).bind(t,id,id,tokenHash,claim),
    ])
    return result[0].meta.changes===1?{status:'ok' as const,oldEmail:p.oldEmail,email:row.email}:{status:'invalid' as const}
  }catch(error){if(String(error).includes('UNIQUE constraint failed: identities.provider, identities.subject'))return {status:'email-taken' as const};throw error}
}

export async function unlinkIdentity(c:C,id:number,provider:string,proof:Awaited<ReturnType<typeof accountProof>>){
  const config=await authConfiguration(c),t=now(),claim=crypto.randomUUID(),tokenHash=await sha256(crypto.randomUUID())
  const gate='EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=? AND claim_id=?)'
  const result=await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO auth_tokens(token_hash,kind,user_id,expires_at,used_at,claim_id,created_at)
      SELECT ?,'unlink',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND disabled=0 AND kind='user')
      AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>?
        AND (? IS NULL OR (method=? AND created_at>=? AND created_at<=?
          AND EXISTS(SELECT 1 FROM identities WHERE user_id=? AND provider=?))))
      AND COALESCE((SELECT hash FROM passwords WHERE user_id=?),'')=?
      AND EXISTS(SELECT 1 FROM identities WHERE user_id=? AND provider=?)
      AND EXISTS(SELECT 1 FROM identities i WHERE i.user_id=? AND i.provider<>? AND (
        (i.provider='linuxdo' AND ?=1) OR (i.provider='google' AND ?=1) OR
        (i.provider='email' AND ?=1 AND i.verified_at IS NOT NULL AND EXISTS(SELECT 1 FROM passwords WHERE user_id=?)) ))`)
      .bind(tokenHash,id,t+600,t,claim,t,id,proof.sessionHash,id,t,proof.method,proof.method,t-300,t,id,proof.method,id,proof.passwordHash??'',id,provider,id,provider,
        c.env.LINUXDO_CLIENT_ID&&c.env.LINUXDO_CLIENT_SECRET?1:0,config.google?1:0,config.email?1:0,id),
    c.env.DB.prepare(`DELETE FROM identities WHERE user_id=? AND provider=? AND ${gate}`).bind(id,provider,tokenHash,claim),
    c.env.DB.prepare(`DELETE FROM passwords WHERE user_id=? AND ?='email' AND ${gate}`).bind(id,provider,tokenHash,claim),
    c.env.DB.prepare(`UPDATE users SET trust_level=1,silenced=0,updated_at=? WHERE id=? AND ?='linuxdo' AND ${gate}`).bind(t,id,provider,tokenHash,claim),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND id<>? AND ${gate}`).bind(id,proof.sessionHash,tokenHash,claim),
    c.env.DB.prepare(`UPDATE auth_tokens SET used_at=? WHERE used_at IS NULL AND
      ((user_id=? AND kind IN ('email','reset','oauth_google','oauth_linuxdo','merge'))
      OR (kind='merge' AND CASE WHEN json_valid(payload) THEN json_extract(payload,'$.sourceId') END=?)) AND ${gate}`).bind(t,id,id,tokenHash,claim),
  ])
  return result[0].meta.changes===1
}
