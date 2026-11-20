import {Hono} from 'hono'
import type {Ctx} from '../types'
import {needUser,canManageAi} from '../services/auth'
import {fail,boundedJson,sameOrigin} from '../lib/http'
import {now} from '../lib/time'
import {aiAdminState,validAiSetting} from '../ai/admin'
import {aiProviders} from '../ai/config'
import {retryImageReply} from '../ai/images'
import {scoreGuess,judgeQuestion} from '../ldc/scoring'
import {normalizeAnswer} from '../ldc/core'
import {SIMILARITY_VERSION} from '../ldc/similarity'
import {YESNO_VERSION} from '../ldc/yesno'
import {generateWordCandidate,WORD_GENERATION_BUDGET_MS} from '../ldc/word-generator'
import {allowEarlyAiProbe} from '../ai/breaker'
import {guessConfigState,saveGuessDraft,activateGuessDraft,disableGuessProvider} from '../ai/guess-config'
import {chat,type AiResult} from '../ai/gateway'
import {GUESS_TASKS,type GuessTask} from '../ai/guess-tasks'
import {connectionState,saveConnectionDraft,activateConnections,disableConnections,connectionRuntimeState} from '../ai/connections'
import {AI_TASKS,type AiTask} from '../ai/connections-shared'

export const aiAdmin=new Hono<Ctx>()
for(const path of ['/api/admin/ai','/api/admin/ai/*'])aiAdmin.use(path,async(c,next)=>{
 if(!canManageAi(c,needUser(c)))fail(403,'只有站点管理员能管理 AI')
 if(!['GET','HEAD','OPTIONS'].includes(c.req.method))sameOrigin(c)
 c.header('cache-control','no-store');await next()
})
aiAdmin.get('/api/admin/ai/jobs',async c=>{
 const state=c.req.query('state')??'all',before=c.req.query('before')
 if(!['all','pending','running','done','failed','skipped'].includes(state))fail(400,'任务状态无效')
 const cursor=before===undefined?Number.MAX_SAFE_INTEGER:Number(before)
 if(before!==undefined&&(!/^\d+$/.test(before)||!Number.isSafeInteger(cursor)||cursor<=0))fail(400,'分页位置无效')
 const {results}=await c.env.DB.prepare(`SELECT id,target_id,state,attempts,run_after,err,created_at,updated_at FROM ai_jobs
  WHERE kind='img_reply' AND id<? AND (?='all' OR state=?) ORDER BY id DESC LIMIT 31`).bind(cursor,state,state).all<{id:number;err:string|null}>()
 const reasons=new Set(['ineligible','filtered','gif','image','fetch','size','bot_collision','ai_disabled','ai_off','quota','ai_busy','ai_upstream','ai_input','internal','interrupted','user_disabled','post_disabled'])
 return c.json({jobs:results.slice(0,30).map(r=>({...r,err:r.err===null?null:reasons.has(r.err)?r.err:'internal'})),next:results.length>30?results[29].id:null})
})
aiAdmin.post('/api/admin/ai/jobs/:id/retry',async c=>{
 const raw=c.req.param('id'),id=Number(raw)
 if(!/^\d+$/.test(raw)||!Number.isSafeInteger(id)||id<=0)fail(400,'任务编号无效')
 const body=await boundedJson(c,1024)
 if(Object.keys(body).length)fail(400,'重试不接受额外参数')
 if(!await retryImageReply(c.env,id,now()))fail(409,'任务已变化或当前不符合重试条件')
 return c.json({ok:true})
})
aiAdmin.get('/api/admin/ai',async c=>c.json(await aiAdminState(c.env,now())))
aiAdmin.get('/api/admin/ai/connections',async c=>c.json({...await connectionState(c.env),runtime:await connectionRuntimeState(c.env,now())}))
aiAdmin.put('/api/admin/ai/connections',async c=>{sameOrigin(c);return c.json(await saveConnectionDraft(c.env,await boundedJson(c,20000),now()))})
aiAdmin.post('/api/admin/ai/connections/:action',async c=>{
 sameOrigin(c)
 const body=await boundedJson(c,1024),action=c.req.param('action')
 if(!['activate','disable','test'].includes(action)||Object.keys(body).some(k=>!['revision',...(action==='test'?['task']:[])].includes(k))||typeof body.revision!=='string')fail(400,'连接操作参数无效')
 if(action==='activate')return c.json(await activateConnections(c.env,body.revision,now()))
 if(action==='disable')return c.json(await disableConnections(c.env,body.revision))
 if(!AI_TASKS.includes(body.task as AiTask))fail(400,'测试用途无效')
 const t=now(),allowed=await c.env.DB.prepare(`INSERT INTO site_settings(k,v,updated_at) VALUES('ai.connections.test_at','1',?)
  ON CONFLICT(k) DO UPDATE SET updated_at=excluded.updated_at WHERE site_settings.updated_at<=excluded.updated_at-10 RETURNING k`).bind(t).first()
 if(!allowed)fail(429,'请间隔10秒再测试')
 const started=Date.now(),result=await chat(c.env,{feature:'test',connectionTest:{revision:body.revision as string,task:body.task as AiTask},uid:needUser(c).id,messages:[{role:'user',content:'只返回 JSON 对象 {"ok":true}。'}],json:true,temperature:0,maxTokens:128,timeoutMs:12000,totalTimeoutMs:body.task==='generation'?45000:20000,signal:c.req.raw.signal}) as AiResult
 let structured=false;try{structured=JSON.parse(result.text).ok===true}catch{}
 return c.json({ok:true,structured,model:result.model,elapsed_ms:Date.now()-started})
})
aiAdmin.get('/api/admin/ai/guess-model',async c=>c.json(await guessConfigState(c.env)))
aiAdmin.put('/api/admin/ai/guess-model',async c=>{
 sameOrigin(c)
 return c.json(await saveGuessDraft(c.env,await boundedJson(c,4096),now()))
})
aiAdmin.post('/api/admin/ai/guess-model/activate',async c=>{
 sameOrigin(c)
 const body=await boundedJson(c,1024)
 if(Object.keys(body).some(k=>k!=='revision'))fail(400,'启用参数无效')
 return c.json(await activateGuessDraft(c.env,body.revision,now()))
})
aiAdmin.post('/api/admin/ai/guess-model/disable',async c=>{
 sameOrigin(c)
 if(Object.keys(await boundedJson(c,1024)).length)fail(400,'停用参数无效')
 return c.json(await disableGuessProvider(c.env))
})
aiAdmin.post('/api/admin/ai/guess-model/test',async c=>{
 sameOrigin(c)
 const body=await boundedJson(c,1024),state=await guessConfigState(c.env)
 if(Object.keys(body).some(k=>!['revision','task'].includes(k))||body.task!==undefined&&!GUESS_TASKS.includes(body.task as GuessTask))fail(400,'测试用途无效')
 if(!state.draft?.ready||state.draft.revision!==body.revision)fail(409,'请先保存完整配置，再测试连接')
 const t=now(),allowed=await c.env.DB.prepare(`INSERT INTO site_settings(k,v,updated_at) VALUES('ai.guess.test_at','1',?)
  ON CONFLICT(k) DO UPDATE SET updated_at=excluded.updated_at WHERE site_settings.updated_at<=excluded.updated_at-10 RETURNING k`).bind(t).first()
 if(!allowed)fail(429,'请间隔10秒再测试')
 const started=Date.now(),result=await chat(c.env,{feature:'test',guessDraft:true,...(body.task?{guessTask:body.task as GuessTask}:{}),uid:needUser(c).id,messages:[{role:'user',content:'只返回 JSON 对象 {"ok":true}。'}],json:true,temperature:0,maxTokens:128,timeoutMs:12000,totalTimeoutMs:body.task==='generation'?45000:body.task?20000:12000,signal:c.req.raw.signal}) as AiResult
 let structured=false
 try{structured=JSON.parse(result.text).ok===true}catch{}
 return c.json({ok:true,structured,model:result.model,elapsed_ms:Date.now()-started})
})
aiAdmin.post('/api/admin/ai/probe',async c=>{
 sameOrigin(c)
 const body=await boundedJson(c,1024)
 if(Object.keys(body).length)fail(400,'恢复探测不接受额外参数')
 const admin=await aiAdminState(c.env,now())
 if(admin.settings['ai.enabled']!=='on'||!admin.providers.primary.ready)fail(409,'请先启用并配置文字模型')
 const state=await allowEarlyAiProbe(c.env.DB,now(),'primary')
 if(state==='invalid')fail(409,'文字通道状态异常，请先核对配置和数据库状态')
 if(state==='not_open')fail(409,'文字通道当前未处于冷却，无需提前探测')
 if(state==='busy')fail(409,'已有请求正在探测或状态已变化，请刷新状态')
 if(state==='rate')fail(429,'每分钟最多提前探测一次，请稍后重试')
 return c.json({status:'half_open',recovered:false})
})
aiAdmin.post('/api/admin/ai/guess-check',async c=>{
 sameOrigin(c)
 const body=await boundedJson(c,2048),u=needUser(c)
 const mode=body.mode===undefined?'similarity':body.mode
 if(mode!=='similarity'&&mode!=='yesno'&&mode!=='generation')fail(400,'校验模式无效')
 if(Object.keys(body).some(k=>!(mode==='generation'?['mode','answer_length']:['answer','guess','mode']).includes(k))||mode!=='generation'&&(typeof body.answer!=='string'||typeof body.guess!=='string'))fail(400,'请填写答案和候选表达')
 if(mode==='generation'&&body.answer_length!==undefined&&(typeof body.answer_length!=='number'||!Number.isInteger(body.answer_length)||body.answer_length<2||body.answer_length>8))fail(400,'出题字数请选择2–8字或不限')
 const answer=String(body.answer??'').trim(),guess=String(body.guess??'').trim()
 if(mode!=='generation'&&(!normalizeAnswer(answer)||!normalizeAnswer(guess)||[...answer].length>40||[...guess].length>200||/[\p{Cc}\p{Cf}]/u.test(answer+guess)))fail(400,'答案最多40字，候选表达最多200字')
 const t=now(),day=new Date((t+28800)*1000).toISOString().slice(0,10)
 const allowed=await c.env.DB.prepare(`INSERT INTO quota_usage(day,scope,key,n) VALUES(?,?,?,1) ON CONFLICT(day,scope,key) DO UPDATE SET n=n+1 WHERE n<10 RETURNING n`).bind(day,'guess-check:'+Math.floor(t/60),u.id).first()
 if(!allowed)fail(429,'每分钟最多校验10次，请稍后重试')
 if(mode==='generation'){
  const started=Date.now(),game=await generateWordCandidate(c.env,u.id,WORD_GENERATION_BUDGET_MS,[],c.req.raw.signal,body.answer_length as number|undefined)
  return c.json({generated_answer:game.answers[0],hints:game.hints,elapsed_ms:Date.now()-started,model_called:true})
 }
 if(mode==='yesno')return c.json({answer:await judgeQuestion(c.env,u.id,[normalizeAnswer(answer)],guess,c.req.raw.signal),rule_version:YESNO_VERSION,model_called:true})
 if(normalizeAnswer(answer)===normalizeAnswer(guess))return c.json({score:100,relation:'exact',form:'candidate',identity:'same',rule_version:SIMILARITY_VERSION,model_called:false})
 const result=await scoreGuess(c.env,u.id,[normalizeAnswer(answer)],guess,c.req.raw.signal)
 if(!result)fail(503,'模型评分格式无效，请重新校验')
 return c.json({...result,rule_version:SIMILARITY_VERSION,model_called:true})
})
aiAdmin.put('/api/admin/ai',async c=>{
 const body=await boundedJson(c),settings=body.settings
 if(!settings||typeof settings!=='object'||Array.isArray(settings))fail(400,'设置值无效')
 const entries=Object.entries(settings as Record<string,unknown>)
 if(!entries.length||entries.some(([k,v])=>!validAiSetting(k,v)))fail(400,'设置值无效')
 if(entries.some(([k,v])=>k==='ai.enabled'&&v==='on')&&!aiProviders(c.env,false).length&&!Object.values(await connectionRuntimeState(c.env,now())).some(r=>r.ready))fail(409,'请先配置文字模型或启用完整的用途连接')
 const t=now()
 await c.env.DB.batch(entries.map(([k,v])=>c.env.DB.prepare('INSERT INTO site_settings(k,v,updated_at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated_at=excluded.updated_at').bind(k,String(v),t)))
 return c.json({ok:true})
})
