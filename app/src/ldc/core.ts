const enc=new TextEncoder(),dec=new TextDecoder()
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes))
const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0))
async function keyOf(s:string){const b=bytes(s);if(b.length!==32)throw Error('ldc_key');return crypto.subtle.importKey('raw',b,'AES-GCM',false,['encrypt','decrypt'])}
export async function seal(key:string,aad:string,text:string){const iv=crypto.getRandomValues(new Uint8Array(12));return 'v1.'+b64(iv)+'.'+b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},await keyOf(key),enc.encode(text))))}
export async function unseal(key:string,aad:string,box:string){const [v,iv,data]=box.split('.');if(v!=='v1')throw Error('ldc_box');return dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:enc.encode(aad)},await keyOf(key),bytes(data)))}
export function cents(v:unknown){if(typeof v!=='string'||!/^\d{1,4}(?:\.\d{1,2})?$/.test(v))throw Error('金额需为最多两位小数');const [a,b='']=v.split('.'),n=Number(a)*100+Number(b.padEnd(2,'0'));if(n<1||n>200000)throw Error('总额需为0.01–2000 LDC');return n}
// D币 uses the same cent storage, with a separate integer-denominated limit.
export function rewardCents(v:unknown,provider:unknown){
 if(provider!=='coin52')return cents(v)
 if(typeof v!=='string'||!/^\d{1,5}(?:\.0{1,2})?$/.test(v)||Number(v)<1||Number(v)>20000)throw Error('D币总额需为1–20000的整数')
 return Number(v)*100
}
export const money=(n:number)=>(n/100).toFixed(2)
export function hintInterval(b:Record<string,unknown>){const n=b.auto_hint_every===undefined?0:b.auto_hint_every;if(typeof n!=='number'||!Number.isInteger(n)||n<0||n>1000)throw Error('自动线索间隔需为0–1000的整数，0为关闭');return n}
export const extraHints=(json:string|undefined)=>JSON.parse(json||'[]') as {id:string;text:string;source:'owner'|'ai';at:number}[]
function randomInt(max:number){const cap=Math.floor(4294967296/max)*max;let n:number;do{n=crypto.getRandomValues(new Uint32Array(1))[0]}while(n>=cap);return n%max}
export function splitAmount(total:number,count:number,mode:string){if(!Number.isInteger(total)||!Number.isInteger(count)||count<1||count>100||total<count||total>200000)throw Error('份数需为1–100，每份至少0.01 LDC');let left=total;return Array.from({length:count},(_,i)=>{const remaining=count-i,n=remaining===1?left:mode==='random'?1+randomInt(Math.min(left-remaining+1,Math.floor(left/remaining*2))):Math.ceil(left/remaining);left-=n;return n})}
export const normalizeAnswer=(s:unknown)=>String(s??'').normalize('NFKC').toLocaleLowerCase('en').replace(/[\s\p{P}\p{Z}]/gu,'')
export function cleanGame(b:Record<string,unknown>){const mode=String(b.mode),game=['guess','clues'].includes(mode);if(!['fixed','random','guess','clues'].includes(mode))throw Error('请选择红包玩法');const answers=game?[...new Set(String(b.answers??'').split(/\r?\n/).map(normalizeAnswer).filter(Boolean))]:[];if(game&&(!answers.length||answers.length>6||answers.some(a=>[...a].length>40||/[\p{Cc}\p{Cf}]/u.test(a))))throw Error('请填写1–6个答案，每个最多40字');const hints=String(b.hints??'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(hints.length>6||hints.some(h=>h.length>160)||mode==='clues'&&!hints.length)throw Error('最多6条线索，每条160字；逐步线索至少填一条');return {mode,answers,hints}}
export function parseVerdict(text:string):'yes'|'no'|'unknown'|'not_question'{try{const d=gameJson(text) as {answer:string}|null;return d&&Object.keys(d).length===1&&['yes','no','unknown','not_question'].includes(d.answer)?d.answer as 'yes'|'no'|'unknown'|'not_question':'unknown'}catch{return 'unknown'}}
// Accept JSON code fences, never surrounding prose or extra fields that could reveal the answer.
export function gameJson(text:string):unknown{return JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i,'$1'))}
export function parseSimilarityAssessment(text:string){try{
 const d=gameJson(text) as {score:unknown;relation?:unknown;form?:unknown;identity?:unknown}|null
 if(!d||Object.keys(d).some(k=>!['score','relation','form','identity'].includes(k))||typeof d.score!=='number'||!Number.isFinite(d.score)||d.score<0||d.score>100)return null
 const caps:Record<string,number>={unrelated:9,context:29,category:49,sibling:59,similar:69,near:89,synonym:99}
 if(Object.hasOwn(d,'relation')&&(typeof d.relation!=='string'||!Object.hasOwn(caps,d.relation)))return null
 const formCaps:Record<string,number>={candidate:99,description:99,comment:9,question:0},identityCaps:Record<string,number>={same:99,different:59,uncertain:49}
 const classified=Object.hasOwn(d,'form')||Object.hasOwn(d,'identity')
 if(classified&&(typeof d.relation!=='string'||typeof d.form!=='string'||!Object.hasOwn(formCaps,d.form)||typeof d.identity!=='string'||!Object.hasOwn(identityCaps,d.identity)))return null
 // Missing classifications remain usable, but cannot assert high object identity.
 const score=Math.min(typeof d.relation==='string'?caps[d.relation]:69,classified?formCaps[d.form as string]:69,classified?identityCaps[d.identity as string]:69,Math.round(d.score))
 return {score,relation:typeof d.relation==='string'?d.relation:null,form:classified?d.form as string:null,identity:classified?d.identity as string:null}
}catch{return null}}
export const parseSimilarity=(text:string):number|null=>parseSimilarityAssessment(text)?.score??null
