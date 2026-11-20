import type {Env} from '../env'
import {seal,unseal,normalizeAnswer} from '../ldc/core'
import {sha256} from '../lib/crypto'
import {fail} from '../lib/http'
import {scoreGuess,judgeQuestion} from '../ldc/scoring'
import {styleRules,styleMatches} from './style-rules'

export type PersonalConfig={user_id:number;revision:string;name:string;base:string;model:string;key_box:string;prompt:string;enabled:number;updated_at:number}
export type Consent={id:string;user_id:number;room_id:string;role:'host'|'player';config_revision:string;max_calls:number;used_calls:number;expires_at:number;active:number;token_hash:string}
export function modelEndpoint(base:string){
 try{const u=new URL(base),host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.port||u.username||u.password||u.search||u.hash||base.length>512||!host.includes('.')||/^[\d.]+$|:|\.(localhost|local|internal|lan|home|test-invalid)$/.test(host)||host==='localhost'||host.endsWith('.localhost'))throw Error();
  u.pathname=u.pathname.replace(/\/+$/,'')+'/chat/completions';return u.href;
 }catch{return fail(400,'请填写不含账号、端口或查询参数的公网 HTTPS Base URL')}
}
export const configPublic=(r:PersonalConfig|null)=>r?{revision:r.revision,name:r.name,base:r.base,model:r.model,prompt:r.prompt,enabled:!!r.enabled,has_key:!!r.key_box,updated_at:r.updated_at}:null
export const loadPersonal=(env:Env,uid:number)=>env.DB.prepare('SELECT * FROM user_ai_configs WHERE user_id=?').bind(uid).first<PersonalConfig>()
export async function savePersonal(env:Env,uid:number,b:Record<string,unknown>,at:number){
 if(Object.keys(b).some(k=>!['revision','name','base','model','key','prompt','enabled'].includes(k))||typeof b.base!=='string'||typeof b.model!=='string'||typeof b.key!=='string'||typeof b.prompt!=='string'||typeof b.enabled!=='boolean'||typeof b.name!=='string'||(b.revision!==null&&typeof b.revision!=='string'))fail(400,'模型配置字段无效')
 const base=(b.base as string).trim(),model=(b.model as string).trim(),name=(b.name as string).trim(),prompt=b.prompt as string,key=b.key as string;
 modelEndpoint(base);
 if(!model||model.length>100||/[\x00-\x1f\x7f]/.test(model)||!name||name.length>40||prompt.length>4000||key.length>512||key&&/[^\x21-\x7e]/.test(key))fail(400,'名称最多40字、模型ID最多100字、提示词最多4000字，请检查密钥格式')
 const old=await loadPersonal(env,uid);if((old?.revision??null)!==b.revision)fail(409,'模型已被修改，请重新读取')
 if(!key&&!old?.key_box)fail(400,'请填写 API Key');if(old&&base!==old.base&&!key)fail(400,'更改 Base URL 时请重新填写密钥')
 if(!env.LDC_ENCRYPTION_KEY)fail(503,'服务端加密未就绪')
 const box=key?await seal(env.LDC_ENCRYPTION_KEY!,'personal-guess-ai:'+uid,key):old!.key_box,revision=crypto.randomUUID();
 const r=old?await env.DB.prepare('UPDATE user_ai_configs SET revision=?,name=?,base=?,model=?,key_box=?,prompt=?,enabled=?,updated_at=? WHERE user_id=? AND revision=?').bind(revision,name,base,model,box,prompt,b.enabled?1:0,at,uid,b.revision).run():await env.DB.prepare('INSERT OR IGNORE INTO user_ai_configs(user_id,revision,name,base,model,key_box,prompt,enabled,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(uid,revision,name,base,model,box,prompt,b.enabled?1:0,at).run();
 if(!r.meta.changes)fail(409,'模型已被修改，请重新读取');return configPublic(await loadPersonal(env,uid));
}
export async function consentPersonal(env:Env,uid:number,b:Record<string,unknown>,at:number){
 if(typeof b.room_id!=='string'||!/^[-a-f0-9]{32,36}$/i.test(b.room_id)||!['host','player'].includes(String(b.role))||!Number.isInteger(b.max_calls)||Number(b.max_calls)<1||Number(b.max_calls)>300)fail(400,'请确认房间、身份及1–300次调用上限')
 const cfg=await loadPersonal(env,uid);if(b.role==='player'&&(!cfg?.enabled||!cfg.key_box))fail(409,'请先配置并启用个人AI')
 const id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID();
 await env.DB.prepare('INSERT INTO user_ai_consents(id,token_hash,user_id,room_id,config_revision,role,max_calls,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,await sha256(token),uid,b.room_id,cfg?.revision||'',b.role,b.max_calls,at+3600,at).run();
 return {id,token,room_id:b.room_id,max_calls:b.max_calls,model:cfg?.model||null,name:cfg?.name||null};
}
async function boundedResponse(r:Response){
 if(!r.ok||!r.body)throw Error('上游模型返回错误');const reader=r.body.getReader();let text='',size=0;const decoder=new TextDecoder();
 try{while(true){const v=await reader.read();if(v.done)break;size+=v.value.byteLength;if(size>131072){await reader.cancel();throw Error('模型响应过大')}text+=decoder.decode(v.value,{stream:true})}return JSON.parse(text+decoder.decode())}finally{reader.releaseLock()}
}
export async function privateModel(env:Env,uid:number,cfg:PersonalConfig,task:'generate'|'guess',context:unknown,signal?:AbortSignal){
 const url=modelEndpoint(cfg.base),key=await unseal(env.LDC_ENCRYPTION_KEY!,'personal-guess-ai:'+uid,cfg.key_box);
 // Only these game-specific instructions can reach a personal key. Never run background tasks or generic chat.
 const system=task==='generate'?'你在中文猜词游戏中出题。仅输出JSON：{"answer":"2到8字的明确词语","hint":"不含答案的简短分类提示"}。不要输出额外内容。':'你在中文AI对抗猜词中参赛。依据公开记录推理，每次仅输出JSON：{"kind":"guess或question","text":"一个候选答案或是非问题"}。禁止索要秘密答案，禁止输出多个行动。';
 const rules=task==='guess'?await styleRules(env):[];
 const response=await fetch(url,{method:'POST',redirect:'manual',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({model:cfg.model,messages:[{role:'system',content:system+(rules.length?'\n本版本禁止以下高频发言模板，请采用新的表达方式：'+JSON.stringify(rules):'')},{role:'user',content:JSON.stringify({player_preferences:cfg.prompt,game:context})}],stream:false,max_tokens:256,temperature:task==='generate'?0.8:0.3}),signal:signal??AbortSignal.timeout(15000)});
 const data=await boundedResponse(response),raw=data.choices?.[0]?.message?.content;if(typeof raw!=='string'||raw.length>4000)throw Error('模型输出无效');
 let parsed;try{parsed=JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i,'$1'))}catch{throw Error('模型未按猜词格式输出')}
 if(task==='generate'){const answer=normalizeAnswer(parsed.answer);if(!answer||[...answer].length>8||[...answer].length<2||typeof parsed.hint!=='string'||parsed.hint.length>80)throw Error('出题格式无效');return {answer,hint:parsed.hint}}
 if(!['guess','question'].includes(parsed.kind)||typeof parsed.text!=='string'||!parsed.text.trim()||[...parsed.text].length>(parsed.kind==='guess'?40:160))throw Error('模型必须输出一个猜测或是非问题');if(styleMatches(parsed.text,rules).length)throw Error('模型命中本版本禁用模板');return {kind:parsed.kind as 'guess'|'question',text:parsed.text.trim()};
}
export async function executeConsent(env:Env,b:Record<string,unknown>,at:number){
 if(typeof b.id!=='string'||typeof b.token!=='string'||typeof b.operation!=='string'||!/^[-a-f0-9]{36}$/i.test(b.operation)||!['generate','guess','judge'].includes(String(b.task)))fail(400,'调用凭证无效');
 const consent=(await env.DB.prepare('SELECT c.* FROM user_ai_consents c JOIN users u ON u.id=c.user_id WHERE c.id=? AND c.token_hash=? AND c.active=1 AND c.expires_at>? AND u.disabled=0').bind(b.id,await sha256(b.token as string),at).first<Consent>())??fail(403,'参与授权已结束');
 if(b.task!=='guess'&&consent.role!=='host')fail(403,'仅出题方可请求出题或判题');
 const prior=await env.DB.prepare('SELECT state,result,created_at FROM user_ai_calls WHERE id=? AND consent_id=?').bind(b.operation,b.id).first<{state:string;result:string;created_at:number}>();if(prior){if(prior.state==='pending'&&prior.created_at<at-30){const result={error:'上次调用结果不确定，已停止且不会重复调用'};await env.DB.prepare("UPDATE user_ai_calls SET state='error',result=?,updated_at=? WHERE id=? AND state='pending'").bind(JSON.stringify(result),at,b.operation).run();return {state:'error',result}}return {state:prior.state,result:prior.result?JSON.parse(prior.result):null}};
 const cfg=await loadPersonal(env,consent.user_id);if(b.task!=='judge'&&(!cfg?.enabled||cfg.revision!==consent.config_revision))fail(409,'个人模型已更改或停用，本局调用已停止');
 const context=b.context;if(!context||typeof context!=='object'||JSON.stringify(context).length>20000)fail(400,'猜词上下文无效');
 const reserve=await env.DB.prepare("INSERT OR IGNORE INTO user_ai_calls(id,consent_id,task,state,created_at,updated_at) SELECT ?,?,?,'pending',?,? FROM user_ai_consents WHERE id=? AND active=1 AND used_calls<max_calls AND expires_at>?").bind(b.operation,b.id,b.task,at,at,b.id,at).run();if(!reserve.meta.changes){const duplicate=await env.DB.prepare('SELECT state,result FROM user_ai_calls WHERE id=? AND consent_id=?').bind(b.operation,b.id).first<{state:string;result:string|null}>();if(duplicate)return {state:duplicate.state,result:duplicate.result?JSON.parse(duplicate.result):null};fail(429,'已达到本局授权次数')}
 try{let result:unknown;
  if(b.task==='judge'){
   const c=context as {answer:unknown;kind:unknown;text:unknown};if(typeof c.answer!=='string'||[...c.answer].length>40||!c.answer||typeof c.text!=='string'||c.text.length>160||!['guess','question'].includes(String(c.kind)))throw Error('判题输入无效');
   result=normalizeAnswer(c.text)===normalizeAnswer(c.answer)&&c.kind==='guess'?{correct:true,score:100}:c.kind==='guess'?{correct:false,score:(await scoreGuess(env,consent.user_id,[normalizeAnswer(c.answer)],c.text))?.score??0}:{verdict:await judgeQuestion(env,consent.user_id,[normalizeAnswer(c.answer)],c.text)};
  }else result=await privateModel(env,consent.user_id,cfg!,b.task as 'generate'|'guess',context);
  const serialized=JSON.stringify(result);await env.DB.prepare("UPDATE user_ai_calls SET state='done',result=?,updated_at=? WHERE id=? AND state='pending'").bind(serialized,at,b.operation).run();
  if(b.task==='guess'){const r=result as {kind:string;text:string};await env.DB.prepare('INSERT OR IGNORE INTO game_ai_samples(id,room_id,user_id,model,prompt_hash,task,body,features,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(b.operation,consent.room_id,consent.user_id,cfg!.model,await sha256(cfg!.prompt),r.kind,r.text,JSON.stringify({length:[...r.text].length,prefix:r.text.slice(0,8),suffix:r.text.slice(-8),punctuation:(r.text.match(/[\p{P}]/gu)||[]).length}),at).run()}
  return {state:'done',result};
 }catch(error){console.error('personal_guess_ai_failed',error instanceof Error?error.name:'unknown');await env.DB.prepare("UPDATE user_ai_calls SET state='error',result=?,updated_at=? WHERE id=? AND state='pending'").bind(JSON.stringify({error:'模型调用失败或结果不确定，本次不自动重试'}),at,b.operation).run();return {state:'error',result:{error:'模型调用失败或结果不确定，本次不自动重试'}}}
}
