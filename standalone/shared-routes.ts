import {winnerChatData,winnerChatBody} from './winner-chat-data';
import {Hono} from 'hono';
import {getCookie,setCookie,deleteCookie} from 'hono/cookie';
import type {Ctx,C} from '../app/src/types';
import {needUser,isChatAdmin,isFancy} from '../app/src/services/auth';
import {decoOf} from '../app/src/shared/deco';
import {collectionTitle} from '../app/src/shared/title-collection';
import {needMember,assertCurrentAccess} from '../app/src/services/chat-access';
import {boundedJson,fail,sameOrigin} from '../app/src/lib/http';
import {randHex,sha256} from '../app/src/lib/crypto';
import {now} from '../app/src/lib/time';
import {sidebarDay} from '../app/src/games/sidebar-retention';
import {guessMemeRoutes} from '../app/src/routes/guess-meme';
import {personalAiRoutes} from '../app/src/routes/personal-ai';
import {starterGiftState,claimStarterGift} from '../app/src/games/starter-gift';

const MAIN='https://jinhuan.example',CC='https://play.jinhuan.example';
const gameNext=(value:string)=>/^\/(?:chat\/1|me\/ai|games\/(?:arena|drawing|review))(?:\?room=[-a-f0-9]{36})?$/i.test(value)||(/^\/chat\/1\?message_id=[1-9]\d{0,15}$/.test(value)&&Number.isSafeInteger(Number(value.split('=')[1])))?value:'/chat/1';
export const sharedRoutes=new Hono<Ctx>();
sharedRoutes.route('/',personalAiRoutes);sharedRoutes.route('/',guessMemeRoutes);
sharedRoutes.use('*',async(c,next)=>{c.header('cache-control','no-store');await next()});
sharedRoutes.get('/auth/guess/start',async c=>{
 if(new URL(c.req.url).origin!==CC)fail(403,'登录入口无效');
 const state=randHex(32);
 setCookie(c,'__Host-guess-state',state,{httpOnly:true,secure:true,sameSite:'Lax',path:'/',maxAge:120});
 setCookie(c,'__Host-guess-next',btoa(gameNext(c.req.query('next')||'/chat/1')),{httpOnly:true,secure:true,sameSite:'Lax',path:'/',maxAge:120});
 return c.redirect(MAIN+'/auth/guess/authorize?state='+state);
});
sharedRoutes.get('/auth/guess/authorize',async c=>{
 if(new URL(c.req.url).origin!==MAIN)fail(403,'登录来源无效');
 const state=c.req.query('state')||'';if(!/^[a-f0-9]{64}$/.test(state))fail(400,'登录请求已失效，请重新打开');
 if(!c.get('user'))return c.redirect('/login?next='+encodeURIComponent('/auth/guess/authorize?state='+state));
 const u=needUser(c),code=randHex(32),t=now();
 await c.env.DB.batch([
  c.env.DB.prepare('DELETE FROM guess_login_codes WHERE code_hash IN (SELECT code_hash FROM guess_login_codes WHERE expires_at<? LIMIT 100)').bind(t),
  c.env.DB.prepare('INSERT INTO guess_login_codes(code_hash,state_hash,user_id,expires_at) VALUES(?,?,?,?)').bind(await sha256(code),await sha256(state),u.id,t+120),
 ]);
 c.header('referrer-policy','no-referrer');
 return c.redirect(CC+'/auth/guess/callback?code='+code+'&state='+state);
});
sharedRoutes.get('/auth/guess/callback',async c=>{
 if(new URL(c.req.url).origin!==CC)fail(403,'登录回调无效');
 const state=c.req.query('state')||'',code=c.req.query('code')||'';
 if(!/^[a-f0-9]{64}$/.test(state)||! /^[a-f0-9]{64}$/.test(code)||getCookie(c,'__Host-guess-state')!==state)fail(403,'登录校验失败，请重新登录');
 const t=now(),sid=randHex(32),claim=randHex(16),hash=await sha256(code);
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`UPDATE guess_login_codes SET claim=? WHERE code_hash=? AND state_hash=? AND expires_at>? AND claim IS NULL
   AND EXISTS(SELECT 1 FROM users u WHERE u.id=user_id AND u.disabled=0 AND u.kind='user')`).bind(claim,hash,await sha256(state),t),
  c.env.DB.prepare(`INSERT INTO sessions(id,user_id,expires_at,created_at,seen_at,method,ua)
   SELECT ?,user_id,?,?,?,'shared',? FROM guess_login_codes WHERE code_hash=? AND claim=? RETURNING user_id`).bind(await sha256(sid),t+2592000,t,t,(c.req.header('user-agent')||'').slice(0,120),hash,claim),
 ]);
 if(!result[1].results.length)fail(403,'登录凭证已使用或过期，请重新登录');
 deleteCookie(c,'__Host-guess-state',{path:'/',secure:true});
 setCookie(c,'sid',sid,{httpOnly:true,secure:true,sameSite:'Lax',path:'/',maxAge:2592000});
 let next='/chat/1';try{next=gameNext(atob(getCookie(c,'__Host-guess-next')||''))}catch{}deleteCookie(c,'__Host-guess-next',{path:'/',secure:true});c.header('referrer-policy','no-referrer');return c.redirect(next);
});
async function access(c:C,write=false){
 const {u,g}=await needMember(c,1);await assertCurrentAccess(c,u.id,1);
 if(write){sameOrigin(c);if(u.silenced)fail(403,'当前账号已被禁言');
  if(!u.is_admin&&await c.env.DB.prepare("SELECT 1 FROM user_limits WHERE user_id=? AND kind='chat' AND (until=0 OR until>?)").bind(u.id,now()).first())fail(403,'当前账号不可发言');
 }
 return {u,g};
}
// START starter-gift routes
sharedRoutes.get('/api/guess-sidebar/starter',async c=>{const u=needUser(c);c.header('cache-control','private, no-store');return c.json(await starterGiftState(c.env.DB,u.id))});
sharedRoutes.post('/api/guess-sidebar/starter',async c=>{const u=needUser(c);sameOrigin(c);await boundedJson(c,1024);c.header('cache-control','private, no-store');return c.json(await claimStarterGift(c.env.DB,u.id))});
// END starter-gift routes
sharedRoutes.get('/api/guess-sidebar/groups',async c=>{const {g}=await access(c);return c.json({groups:[{...g,name:'猜词',notice:'',latest:null,unread:0,at_me:0,last_read:0,joined:true}],gone:[],dm_unread:0,can_manage:false,can_create:false})});
// Display the existing outfit; this route never grants or changes cosmetics.
function sidebarDeco(raw:unknown){
 const d=decoOf(raw);
 if(d&&(!d.ft||collectionTitle(d.ft)?.limited)){for(const key of ['ft','fn','fp','fxp','fl','cg_size','cg_random','cg_motion','cg_fire'])delete (d as Record<string,unknown>)[key]}
 return d&&Object.keys(d).length?d:null;
}
const fields=`SELECT m.*,u.username,COALESCE(u.nick,u.name,u.username) name,u.avatar,u.trust_level,u.is_admin,u.fancy,u.deco FROM guess_sidebar_messages m JOIN users u ON u.id=m.user_id`;
function dto(row:any,uid:number,admin:boolean){const system=winnerChatData(row),isSystem=row.system_kind==='guess_winner';return {system,id:row.id,body:row.deleted?'':system?winnerChatBody(system):row.body,deleted:!!row.deleted,created_at:row.created_at,updated_at:row.updated_at,mine:!isSystem&&row.user_id===uid,can_edit:!isSystem&&!row.deleted&&row.user_id===uid,can_delete:!isSystem&&!row.deleted&&(row.user_id===uid||admin),user:{id:row.user_id,username:row.username,name:row.name,avatar:row.avatar,trust_level:row.trust_level,is_admin:row.is_admin,fancy:isFancy(row),deco:sidebarDeco(row.deco)},reactions:[],media:null,image:null,floor:row.id}}
sharedRoutes.get('/api/guess-sidebar/messages',async c=>{
 const {u,g}=await access(c),after=Math.max(0,Number(c.req.query('after'))||0),since=Math.max(0,Number(c.req.query('since'))||0),day=sidebarDay(now()),visibleSince=Math.max(g.joined_at,day);
 const [fresh,changed]=await c.env.DB.batch([
  c.env.DB.prepare(fields+(after?' WHERE m.id>? AND m.created_at>=? ORDER BY m.id ASC LIMIT 101':' WHERE m.created_at>=? ORDER BY m.id DESC LIMIT 101')).bind(...(after?[after,visibleSince]:[visibleSince])),
  c.env.DB.prepare(fields+' WHERE m.id>? AND m.id<=? AND m.updated_at>=? AND m.created_at>=? ORDER BY m.id LIMIT 100').bind(Math.max(0,after-100),after,since,visibleSince),
 ]);
 const rows=fresh.results.slice(0,100);if(!after)rows.reverse();
 // Only game state metadata crosses the original chat boundary; never message text.
 const candidates=await c.env.DB.batch(['ldc_packets','guess_free_rounds'].map(table=>c.env.DB.prepare(`SELECT m.id,m.updated_at,m.deleted,p.room_revision,p.created_at FROM ${table} p
 JOIN chat_redpacks r ON r.id=p.packet_id JOIN chat_messages m ON m.id=r.message_id
 WHERE p.group_id=1 AND p.mode IN ('guess','clues') AND m.created_at>=? ORDER BY p.created_at DESC LIMIT 1`).bind(g.joined_at)));
 const signal=candidates.flatMap(r=>r.results).sort((a:any,b:any)=>b.created_at-a.created_at||b.id-a.id)[0]||null;
 return c.json({items:rows.map(r=>dto(r,u.id,isChatAdmin(u))),changed:changed.results.map(r=>dto(r,u.id,isChatAdmin(u))),more:fresh.results.length>100,day,now:now(),signal});
});
sharedRoutes.post('/api/guess-sidebar/messages',async c=>{
 const {u}=await access(c,true),b=await boundedJson(c,10000),body=String(b.body||'').replace(/\r/g,'').trim(),nonce=String(b.nonce||'');
 if(!body||body.length>4000)fail(400,'消息需为 1–4000 字');if(!/^[\w-]{16,64}$/.test(nonce))fail(400,'发送标识无效');
 const old=await c.env.DB.prepare(fields+' WHERE m.user_id=? AND m.nonce=? AND m.created_at>=?').bind(u.id,nonce,sidebarDay(now())).first();if(old)return c.json({message:dto(old,u.id,isChatAdmin(u))});
 const t=now();
 const result=await c.env.DB.prepare(`INSERT INTO guess_sidebar_messages(user_id,body,nonce,created_at,updated_at)
 SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM guess_sidebar_messages WHERE user_id=? AND created_at>? AND system_kind IS NULL)<30
 ON CONFLICT(user_id,nonce) DO NOTHING RETURNING id`).bind(u.id,body,nonce,t,t,u.id,t-60).first<{id:number}>();
 const row=await c.env.DB.prepare(fields+' WHERE m.user_id=? AND m.nonce=? AND m.created_at>=?').bind(u.id,nonce,sidebarDay(now())).first();if(!row)fail(429,'发言过于频繁，请稍后重试');
 return c.json({message:dto(row,u.id,isChatAdmin(u))});
});
sharedRoutes.on(['PATCH','DELETE'],'/api/guess-sidebar/messages/:id',async c=>{
 const {u}=await access(c,true),id=Number(c.req.param('id'));if(!Number.isSafeInteger(id)||id<1)fail(400,'消息编号无效');
 const row=await c.env.DB.prepare(fields+' WHERE m.id=? AND m.created_at>=?').bind(id,sidebarDay(now())).first<any>();if(!row)fail(404,'消息不存在');
 const removing=c.req.method==='DELETE';if(row.user_id!==u.id&&!(removing&&isChatAdmin(u)))fail(403,'不能修改其他玩家的消息');
 if(row.system_kind)fail(403,'系统消息不能修改或撤回');
 if(row.deleted)fail(409,'消息已撤回');
 const body=removing?'':String((await boundedJson(c,10000)).body||'').replace(/\r/g,'').trim();if(!removing&&(!body||body.length>4000))fail(400,'消息需为 1–4000 字');
 await c.env.DB.prepare('UPDATE guess_sidebar_messages SET body=?,deleted=?,updated_at=? WHERE id=? AND deleted=0').bind(body,removing?1:0,now(),id).run();
 return c.json({message:dto(await c.env.DB.prepare(fields+' WHERE m.id=?').bind(id).first(),u.id,isChatAdmin(u))});
});
