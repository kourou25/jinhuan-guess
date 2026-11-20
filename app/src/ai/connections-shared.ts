export const AI_TASKS=['generation','hint','similarity','yesno','chat'] as const
export type AiTask=typeof AI_TASKS[number]
export type ConnectionTask={connection:string;thinking:boolean;stream:boolean;maxTokens:number}
export type ConnectionTasks=Partial<Record<AiTask,ConnectionTask>>
export const taskLabels:Record<AiTask,string>={generation:'出题',hint:'给线索',similarity:'相关度',yesno:'是非判断',chat:'普通对话'}
export const connectionTaskDefault=(task:AiTask):ConnectionTask=>({connection:'',thinking:false,stream:true,maxTokens:task==='generation'?384:task==='hint'?240:task==='chat'?1000:128})
export function parseConnectionTasks(value:unknown):ConnectionTasks{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('用途配置无效')
 const result:ConnectionTasks={}
 for(const [key,entry] of Object.entries(value)){
  if(!AI_TASKS.includes(key as AiTask)||!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('用途配置无效')
  const r=entry as Record<string,unknown>
  if(Object.keys(r).some(k=>!['connection','thinking','stream','maxTokens'].includes(k))||typeof r.connection!=='string'||r.connection.length>48||typeof r.thinking!=='boolean'||typeof r.stream!=='boolean'||typeof r.maxTokens!=='number'||!Number.isInteger(r.maxTokens)||r.maxTokens<64||r.maxTokens>16000)throw Error('用途配置无效')
  if(r.connection)result[key as AiTask]={connection:r.connection,thinking:r.thinking,stream:r.stream,maxTokens:r.maxTokens}
 }
 return result
}
