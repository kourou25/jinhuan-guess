export const GUESS_TASKS=['generation','hint','similarity','yesno'] as const
export type GuessTask=typeof GUESS_TASKS[number]
export type GuessTaskOptions={source:'dedicated'|'site';model:string;thinking:boolean;maxTokens:number;stream?:boolean}
export type GuessTaskSettings=Partial<Record<GuessTask,GuessTaskOptions>>
export const guessTaskDefaults=(task:GuessTask):GuessTaskOptions=>({source:'dedicated',model:'',thinking:false,maxTokens:task==='generation'?384:task==='hint'?240:128,stream:true})
export function parseGuessTasks(value:unknown):GuessTaskSettings{
 if(value===undefined)return {}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('用途配置无效')
 const result:GuessTaskSettings={}
 for(const [task,entry] of Object.entries(value)){
  if(!GUESS_TASKS.includes(task as GuessTask)||!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('用途配置无效')
  const row=entry as Record<string,unknown>
  if(Object.keys(row).some(k=>!['maxTokens','model','source','thinking','stream'].includes(k))||row.stream!==undefined&&typeof row.stream!=='boolean'||!['dedicated','site'].includes(String(row.source))||typeof row.model!=='string'||row.model.length>100||/[\x00-\x1f\x7f]/.test(row.model)||typeof row.thinking!=='boolean'||typeof row.maxTokens!=='number'||!Number.isInteger(row.maxTokens)||row.maxTokens<64||row.maxTokens>16000)throw Error('用途配置或输出上限无效')
  result[task as GuessTask]={source:row.source as GuessTaskOptions['source'],model:row.model.trim(),thinking:row.thinking,maxTokens:row.maxTokens}
  if(row.stream!==undefined)result[task as GuessTask]!.stream=row.stream as boolean
 }
 return result
}
