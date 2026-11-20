import {cleanGame,gameJson,normalizeAnswer,seal,unseal} from './core'
import {validAnswerReference} from './answer-reference-rules'

export const autoContext=(uid:number,gid:number,nonce:string,total:number,mode:string)=>`ldc-auto:${uid}:${gid}:${nonce}:${total}:${mode}`
export function selectedWordLength(value:unknown){
 if(value===undefined)return undefined
 if(typeof value!=='number'||!Number.isInteger(value)||value<2||value>8)throw Error('出题字数请选择2–8字或不限')
 return value
}
export const aiHintLength=(ordinal:number)=>Math.min(5,Math.max(2,ordinal))
export const validAiHint=(hint:string,ordinal:number)=>[...hint].length===aiHintLength(ordinal)&&/^\p{Script=Han}+$/u.test(hint)&&!/[吗么呢]$/u.test(hint)
export function parseAutoWord(text:string,length?:number){
 selectedWordLength(length)
 const value=gameJson(text) as {answer?:unknown;hints?:unknown;reference?:unknown}|null
 if(!value||!['answer,hints','answer,hints,reference'].includes(Object.keys(value).sort().join(','))||typeof value.answer!=='string'||!Array.isArray(value.hints)||value.hints.length!==3||value.hints.some(h=>typeof h!=='string'))throw Error('auto_word_format')
 const answer=normalizeAnswer(value.answer)
 const hints=(value.hints as string[]).map(h=>h.trim())
 if(length!==undefined&&[...answer].length!==length)throw Error('auto_word_length')
 if(hints.some((h,i)=>!validAiHint(h,i+1)))throw Error('auto_hint_length')
 if(!/^[\p{L}\p{N}]{2,8}$/u.test(answer)||!/[\p{Script=Han}]/u.test(answer)||/[\p{Cc}\p{Cf}]/u.test(value.answer))throw Error('auto_answer_invalid')
 if(new Set(hints.map(normalizeAnswer)).size!==3)throw Error('auto_hint_duplicate')
 if(hints.some(h=>/[\p{Cc}\p{Cf}]/u.test(h)||normalizeAnswer(h).includes(answer)))throw Error('auto_hint_answer')
 return {...cleanGame({mode:'guess',answers:answer,hints:hints.join('\n')}),...(value.reference===undefined?{}:{reference:validAnswerReference(value.reference)})}
}
export async function sealAutoWord(key:string,context:string,game:ReturnType<typeof cleanGame>&{reference?:string},expires:number){return seal(key,context,JSON.stringify({game,expires}))}
export async function openAutoWord(key:string,context:string,token:string,time:number){
 if(token.length>6000)throw Error('auto_word_token')
 const d=JSON.parse(await unseal(key,context,token)) as {game:ReturnType<typeof cleanGame>&{reference?:string};expires:number}
 if(!Number.isSafeInteger(d.expires)||d.expires<=time||d.expires>time+900||d.game.mode!=='guess')throw Error('auto_word_expired')
 return {...cleanGame({mode:'guess',answers:d.game.answers.join('\n'),hints:d.game.hints.join('\n')}),...(d.game.reference===undefined?{}:{reference:validAnswerReference(d.game.reference)})}
}
