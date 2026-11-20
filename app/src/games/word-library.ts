import type {Env} from '../env'
import {unseal,normalizeAnswer} from '../ldc/core'
import {sha256} from '../lib/crypto'
import {gameStores} from '../ldc/game-store'
export const WEB_WORD_PAIRS=[['伞','雨伞'],['凤梨','菠萝'],['单车','自行车'],['土豆','马铃薯'],['番茄','西红柿'],['电子计算机','电脑'],['机动车','汽车']] as const;
export async function seedWords(env:Env,at:number){const count=await env.DB.prepare("SELECT id FROM game_word_pairs WHERE approved=1 AND source='Chinese Open WordNet' LIMIT 1").first();if(count)return;await env.DB.batch(await Promise.all(WEB_WORD_PAIRS.map(async([a,b])=>env.DB.prepare('INSERT OR IGNORE INTO game_word_pairs(id,ordinary,undercover,source,source_url,license,approved,created_at) VALUES(?,?,?,?,?,?,1,?)').bind(await sha256(a+'\0'+b),a,b,'Chinese Open WordNet','https://github.com/omwn/omw-data/tree/main/wns/cow','Chinese Open WordNet license',at))))}
export async function importHistoryWords(env:Env,at=Math.floor(Date.now()/1000)){
 if(!env.LDC_ENCRYPTION_KEY)return {imported:0,scanned:0,has_more:false};
 const jobs=(await env.DB.prepare("SELECT store,packet_id,attempts FROM guess_word_archive_jobs WHERE status IN ('pending','error') AND next_at<=? ORDER BY next_at,store,packet_id LIMIT 32").bind(at).all<{store:string;packet_id:string;attempts:number}>()).results;
 let imported=0,failed=0;
 for(const job of jobs){
  const store=gameStores.find(s=>s.reward===job.store)!;
  const mark=(status:string,error:string|null=null)=>env.DB.prepare("UPDATE guess_word_archive_jobs SET status=?,last_error=? WHERE store=? AND packet_id=? AND status IN ('pending','error')").bind(status,error,job.store,job.packet_id);
  try{
   const r=await env.DB.prepare(`SELECT p.packet_id,p.answer_box,p.created_at,p.ends_at,p.state,(SELECT is_default FROM chat_groups WHERE id=m.group_id) AS public_scope,${store.reward==='none'?'p.winner_id IS NOT NULL':'(SELECT count(*) FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.recipient_id IS NOT NULL)>=p.count'} AS done
    FROM ${store.rounds} p JOIN chat_redpacks r ON r.id=p.packet_id JOIN chat_messages m ON m.id=r.message_id
    WHERE p.packet_id=? AND p.mode IN ('guess','clues') AND m.deleted=0`).bind(job.packet_id).first<{packet_id:string;answer_box:string;created_at:number;ends_at:number;state:string;done:number;public_scope:number}>();
   if(!r){await mark('skipped','source_unavailable').run();continue}
   if(r.state==='open'&&r.ends_at>at&&!r.done){await env.DB.prepare("UPDATE guess_word_archive_jobs SET next_at=? WHERE store=? AND packet_id=? AND status IN ('pending','error') AND next_at<>?").bind(r.ends_at,job.store,job.packet_id,r.ends_at).run();continue}
   const raw:unknown=JSON.parse(await unseal(env.LDC_ENCRYPTION_KEY,'ldc-answer:'+r.packet_id,r.answer_box));
   if(!Array.isArray(raw)||!raw.length||raw.length>100||raw.some(w=>typeof w!=='string'))throw Error('invalid_answer');
   const words=[...new Set(raw.map(normalizeAnswer).filter(w=>w&&[...w].length<=40))];
   if(!words.length)throw Error('invalid_answer');
   const statements=await Promise.all(words.map(async word=>env.DB.prepare('INSERT OR IGNORE INTO game_word_candidates(id,word,packet_id,source_kind,created_at) VALUES(?,?,?,?,?)').bind(await sha256(r.packet_id+'\0'+word),word,r.packet_id,store.reward,r.created_at)));
   if(words.length>=2&&r.public_scope)statements.push(env.DB.prepare('INSERT OR IGNORE INTO game_word_pairs(id,ordinary,undercover,source,license,approved,created_at) VALUES(?,?,?,?,?,1,?)').bind(await sha256(r.packet_id),words[0],words[1],'已公开猜词同义答案','site-history',r.created_at));
   statements.push(mark('done'));
   const results=await env.DB.batch(statements);imported+=results.slice(0,words.length).reduce((n,r)=>n+r.meta.changes,0);
  }catch{
   failed++;
   // Bounded retry: a damaged answer cannot block healthy jobs or leak into logs.
   await env.DB.prepare("UPDATE guess_word_archive_jobs SET attempts=attempts+1,status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'error' END,next_at=?,last_error='archive_failed' WHERE store=? AND packet_id=? AND status IN ('pending','error')").bind(at+Math.min(86400,300*2**job.attempts),job.store,job.packet_id).run();
  }
 }
 return {imported,scanned:jobs.length,failed,has_more:jobs.length===32};
}

// Public export contains only distinct words from the default shared game group.
// Identity, source-round linkage, guesses, rewards and private groups never leave here.
export async function exportHistoryWords(env:Env,after='',limit=200){
 const rows=(await env.DB.prepare(`SELECT DISTINCT c.word FROM game_word_candidates c INDEXED BY idx_game_word_candidates_word
  WHERE c.word>? AND EXISTS(SELECT 1 FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id JOIN chat_groups g ON g.id=m.group_id WHERE r.id=c.packet_id AND m.deleted=0 AND g.is_default=1)
  ORDER BY c.word LIMIT ?`).bind(after,limit+1).all<{word:string}>()).results;
 const items=rows.slice(0,limit).map(r=>({word:r.word}));
 return {format:'guess-words-v1',items,next_cursor:rows.length>limit?items.at(-1)!.word:null};
}
