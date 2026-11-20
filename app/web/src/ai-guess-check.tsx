import {useState} from 'react'
import {useMutation} from '@tanstack/react-query'
import {api} from './api'
type Mode='similarity'|'yesno'|'generation'
type Result={score?:number;answer?:'yes'|'no'|'unknown';relation?:string|null;form?:string|null;identity?:string|null;rule_version?:string;model_called:boolean;generated_answer?:string;hints?:string[];elapsed_ms?:number}
const names:Record<string,string>={exact:'准确匹配',unrelated:'无关',context:'场景关联',category:'同类或上位类别',sibling:'同系列不同对象',similar:'特征相似',near:'描述接近同一目标',synonym:'同一目标的等义表达',candidate:'候选答案',description:'客观描述',comment:'态度评价',question:'提问',same:'同一目标',different:'不同对象',uncertain:'身份不明'}
export function AiGuessCheck(){
 const [answer,setAnswer]=useState(''),[guess,setGuess]=useState(''),[mode,setMode]=useState<Mode>('similarity')
 const [length,setLength]=useState('')
 const check=useMutation({mutationFn:()=>api<Result>('/api/admin/ai/guess-check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(mode==='generation'?{mode,...length?{answer_length:Number(length)}:{}}:{answer,guess,mode})})})
 return <details className="ai-guess-check"><summary>猜词评分校验</summary>
  <p className="hint">填写已结束题目作对照，使用群聊相同的评分规则。每分钟最多校验10次，真实模型调用计入全站额度，不发群消息或奖励。</p>
  <form onSubmit={e=>{e.preventDefault();check.mutate()}}>
   <label>校验模式<select aria-label="校验模式" value={mode} disabled={check.isPending} onChange={e=>{setMode(e.target.value as Mode);check.reset()}}><option value="similarity">相关度</option><option value="yesno">问是非</option><option value="generation">AI 出题检测</option></select></label>
   {mode==='generation'&&<label>答案字数<select aria-label="检测答案字数" value={length} disabled={check.isPending} onChange={e=>{setLength(e.target.value);check.reset()}}><option value="">不限 · 2–8字</option>{[2,3,4,5,6,7,8].map(n=><option key={n} value={n}>{n} 字</option>)}</select></label>}
   {mode==='generation'?<p className="hint">生成独立检测样例，不开局、不读取当前谜底，不检查群内历史去重。耗时包含服务端额度检查及模型请求。</p>:<>
    <label>对照答案<input aria-label="评分校验答案" value={answer} maxLength={40} required disabled={check.isPending} onChange={e=>{setAnswer(e.target.value);check.reset()}}/></label>
    <label>{mode==='yesno'?'是非问题':'候选表达'}<input aria-label="评分校验候选表达" value={guess} maxLength={200} required disabled={check.isPending} onChange={e=>{setGuess(e.target.value);check.reset()}}/></label>
   </>}
   <button type="submit" disabled={check.isPending||mode!=='generation'&&(!answer.trim()||!guess.trim())}>{check.isPending?'校验中…':mode==='generation'?'检测 AI 出题':mode==='yesno'?'校验是非':'校验相关度'}</button>
   {check.error&&<p role="alert">{check.error.message}</p>}
   {check.data&&(check.data.generated_answer?<div role="status" aria-label="出题检测结果"><p>出题成功：{check.data.generated_answer} · {((check.data.elapsed_ms||0)/1000).toFixed(1)} 秒</p><ol>{check.data.hints?.map((hint,i)=><li key={i}>{hint}</li>)}</ol><p>此样例未发到群里。</p></div>:<p role="status" aria-label="评分校验结果">{check.data.answer?`判断：${{yes:'是',no:'否',unknown:'无法判断'}[check.data.answer]}`:<>相关度 {check.data.score}% · {names[check.data.form||'']||'未分类'} · {names[check.data.identity||'']||'身份未分类'} · {names[check.data.relation||'']||'关系未分类'}</>} · 规则 {check.data.rule_version}{!check.data.model_called?' · 无模型调用':''}</p>)}
  </form>
 </details>
}
