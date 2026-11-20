import {AI_BLOCKLIST} from './blocklist'

/** 用于非流式公开输出。私有流式对话由提示词约束并按纯文本呈现。 */
export function filterAiText(input:unknown,maxChars:number):string|null {
 if(typeof input!=='string'||!Number.isSafeInteger(maxChars)||maxChars<=0)return null
 let text=input.trim().replace(/^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/g,'').trim()
 if(/^(?:SKIP)[.!。！]?$/i.test(text)||/作为\s*(?:AI|人工智能)|无法查看/i.test(text)||AI_BLOCKLIST.test(text))return null
 text=text.replace(/(?:https?:\/\/|www\.)[^\s<>"'“”]+/gi,'').replace(/@[^\s@]+/g,'').replace(/\s+/g,' ').trim()
 if(!text)return null
 const chars=Array.from(text)
 if(chars.length>maxChars){
  const limited=chars.slice(0,maxChars)
  let end=-1
  for(let i=limited.length-1;i>=0;i--)if(/[。！？.!?]/.test(limited[i])){end=i;break}
  text=limited.slice(0,end>=Math.floor(maxChars*.6)?end+1:maxChars).join('').trim()
 }
 return text||null
}
