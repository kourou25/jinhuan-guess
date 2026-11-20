import {guessMembersSql,guessBansSql} from '../services/guess-access'
import type {C} from '../types';
import type {NativePacket} from './packets';
import {unseal} from './core';
import {gameTables} from './game-store';
import {revealFrame,revealOrder} from './standalone-rules';
import {predictionView} from './predictions';
import {GUESS_REWARDS} from '../shared/guess-rewards';
import {ACTIVITY_REWARDS} from '../shared/activity-rewards';
import {now} from '../lib/time';

export async function standaloneView(c:C,p:NativePacket,uid:number,state:{state:string;recipients:any[]}){
 const answer=JSON.parse(await unseal(c.env.LDC_ENCRYPTION_KEY!,'ldc-answer:'+p.packet_id,p.answer_box!))[0] as string;
 const reveal=revealFrame(answer,await revealOrder(c.env.LDC_ENCRYPTION_KEY!,p.packet_id,[...answer].length),p.created_at,p.ends_at,state.state==='closed'?p.ends_at:now());
 const winnerIds=new Map<number,number>();for(const [i,r] of state.recipients.entries())if(!r.purpose||r.purpose==='winner')winnerIds.set(r.user_id,i+1);
 const rows=(await c.env.DB.prepare(`WITH scores AS (
 SELECT q.user_id,q.score,q.created_at,row_number() OVER(PARTITION BY q.user_id ORDER BY q.score DESC,q.created_at ASC,q.id ASC) rn
 FROM ${gameTables(p).questions} q WHERE q.packet_id=? AND q.kind='guess'
 AND ((q.source_room_id IS NOT NULL AND EXISTS(SELECT 1 FROM guess_room_messages m WHERE m.id=q.source_room_id AND m.deleted=0 AND m.body=q.source_body)) OR (q.source_room_id IS NULL AND EXISTS(SELECT 1 FROM chat_messages m WHERE m.id=q.source_message_id AND m.deleted=0 AND m.body=q.source_body)))
 ) SELECT u.id,COALESCE(u.nick,u.name,u.username) name,u.avatar,u.deco,COALESCE(b.n,0) wins,(SELECT json_group_object(badge,n) FROM user_badges WHERE user_id=u.id) badges,s.score,s.created_at
 FROM users u JOIN ${guessMembersSql} cm ON cm.user_id=u.id AND cm.group_id=? LEFT JOIN scores s ON s.user_id=u.id AND s.rn=1 LEFT JOIN user_badges b ON b.user_id=u.id AND b.badge='guess'
 WHERE u.disabled=0 AND u.kind='user' AND u.id<>? AND NOT EXISTS(SELECT 1 FROM ${guessBansSql} x WHERE x.user_id=u.id AND x.group_id=cm.group_id)
 AND (s.user_id IS NOT NULL OR u.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)))
 ORDER BY s.score DESC,s.created_at ASC,u.id LIMIT 100`).bind(p.packet_id,p.group_id,p.owner_id,JSON.stringify([...winnerIds.keys()])).all<{id:number;name:string;avatar:string|null;deco:string|null;badges:string;wins:number;score:number|null;created_at:number|null}>()).results;
 const rewards=[...GUESS_REWARDS.map(r=>({...r,series:'guess'})),...ACTIVITY_REWARDS.filter(r=>r.series.startsWith('guess_'))];
 const players=rows.map(r=>{const earned=[...GUESS_REWARDS].reverse().find(v=>r.wins>=v.wins);let worn;try{const badges=JSON.parse(r.badges||'{}');worn=rewards.find(v=>v.id===JSON.parse(r.deco||'{}').gr&&v.wins<=(badges[v.series]||0))}catch{}return {id:r.id,name:r.name,avatar:r.avatar,score:winnerIds.has(r.id)?100:r.score,winner_rank:winnerIds.get(r.id)||null,achieved_at:r.created_at,title:worn?.name||null,badge:worn?.symbol||null,level:earned?.level||0}}).sort((a,b)=>a.winner_rank&&b.winner_rank?a.winner_rank-b.winner_rank:a.winner_rank?-1:b.winner_rank?1:(b.score??-1)-(a.score??-1)||(a.achieved_at??Infinity)-(b.achieved_at??Infinity)||a.id-b.id);
 return {reveal,players,prediction:await predictionView(c,p,uid)};
}
