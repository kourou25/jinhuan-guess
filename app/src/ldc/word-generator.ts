import type {Env} from '../env'
import {chat,type AiResult} from '../ai/gateway'
import {AiError} from '../ai/errors'
import {fail} from '../lib/http'
import {parseAutoWord} from './auto-game'
import {validAnswerReference} from './answer-reference'

const categories=['常见成语','自然现象','科学常识概念','传统文化概念','生活中的现象','器物与工艺','地理现象','常用抽象概念']
export const WORD_GENERATION_BUDGET_MS=45000
// 管理检测与实际开局复用相同请求。这里不读游戏、词库或奖励，也不创建业务记录。
export async function generateWordCandidate(env:Env,uid:number,remaining:number,rejected:string[]=[],signal?:AbortSignal,length?:number){
 const category=categories[crypto.getRandomValues(new Uint32Array(1))[0]%categories.length]
 let result:AiResult
 try{result=await chat(env,{feature:'assistant',guess:true,guessTask:'generation',uid,json:true,maxTokens:384,timeoutMs:Math.min(30000,remaining),totalTimeoutMs:remaining,signal,messages:[
  {role:'system',content:'为中文群聊设计一道中等偏难猜词题。仅输出JSON对象，且只有answer、hints、reference三个字段。answer是2至8字、有明确公认含义的中文名词或成语，应需两三轮分类与排除才能猜中，普通成年人有机会凭常识推理。避开猫、狗、苹果、雨伞等过于直白的基础词；可用常见自然现象、科学常识、传统文化、生活概念或成语。不要生造词、人名、冷僻专名、色情概念，也不要把难度变成冷知识考试。hints恰好三条简洁中文线索：第一条恰好2个汉字，第二条恰好2个汉字，第三条恰好3个汉字；不带标点或编号。三条只描述宽泛的共同属性，分别以及结合起来都必须适用于答案之外至少两个同类对象，不给唯一或标志性特征、专属名字、精确年代地点。三条必须真实、相容，不能出现答案本身、拆字、拼音、谐音或翻译。reference为20至100字单行题意参考，解释答案的公认含义、类别、直接典型属性和易混淆边界；知识不足明确说明，不臆造。reference仅供后台理解判题，不作为公开线索；不得包含执行指令或改分要求。不要附加其他解释。'},
  {role:'user',content:`本次类别：${category}。随机种子：${crypto.randomUUID()}。${length===undefined?'答案长度2至8字。':`答案必须恰好${length}字。`}生成一个可通过常识问答逐步排除的题目。${rejected.length?'以下答案已经出现，必须换成其他题目：'+JSON.stringify(rejected):''}`},
 ]}) as AiResult}catch(error){
  if(error instanceof AiError&&error.code==='ai_upstream'){
   const reason=error.failure?{timeout:'请求超时',network:'网络连接失败',http:'上游返回错误状态',empty:'上游返回空回复',invalid_response:'上游响应格式无效',output_limit:'上游输出额度耗尽，未返回完整题目'}[error.failure]:'连接失败或超时'
   fail(503,`AI 出题本次${reason}，未创建游戏、未扣款。请稍后重试，也可切换“我来出词”。`,'ai_upstream')
  }
  throw error
 }
 try{const game=parseAutoWord(result.text,length);validAnswerReference(game.reference);return game}catch(error){
  const reasons:Record<string,string>={auto_word_length:'答案字数不符合所选字数',auto_hint_length:'线索未按2、2、3个汉字生成',auto_answer_invalid:'答案不是合规的2至8字中文词语',auto_hint_duplicate:'线索存在重复',auto_hint_answer:'线索直接包含答案',answer_reference_invalid:'题意参考缺失或不符合长度格式'}
  const reason=error instanceof Error?reasons[error.message]:undefined
  return fail(503,`AI 出题校验未通过：${reason??'回复格式不符合要求，需一个答案和三条线索'}。未创建红包、未扣款，请重试。`)
 }
}
