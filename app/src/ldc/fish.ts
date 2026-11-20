import {money} from './core'

const origin='https://hb.lafi.sh/api/open'
type FishIdentity={userId:string;username:string}
export type FishAward={order_no:string;recipient_subject:string;recipient_username:string;amount_cents:number}
type Result={state:'accepted'|'sent'|'rejected'|'unknown'|'not_found';receipt:string|null;error:string|null}
const errors:Record<string,string>={
 INVALID_API_KEY:'Fish 密钥已失效，请发包者检查绑定。',TRANSFER_DISABLED:'Fish 转账暂时关闭，请稍后核对。',TRANSFER_NOT_ALLOWED:'Fish 账户尚未具备转账权限，请检查 PLUS 状态。',
 RECIPIENT_NOT_FOUND:'收款人需先用同一 Linux.DO 账号登录 Fish，再核对发放。',BALANCE_INSUFFICIENT:'发包者 Fish 余额不足，充值后可沿原单重试。',DAILY_LIMIT_EXCEEDED:'Fish Key 今日转账额度不足，调整额度或次日重试。',
 RATE_LIMITED:'Fish 请求频率受限，请稍后核对原单。',SELF_TRANSFER:'Fish 不支持给自己转账。',RECIPIENT_IS_OWNER:'Fish 不允许该收款人接收此笔转账。',AMOUNT_OUT_OF_RANGE:'奖励金额不符合 Fish 限制。',INVALID_REQUEST:'Fish 拒绝了转账参数，请联系站长核对。',
 OUT_TRANSFER_NO_CONFLICT:'Fish 原单内容不一致，已停止发送，请核对原单。',TRANSFER_NOT_FOUND:'Fish 尚未找到该原单，可由发包者沿原单重试。',RECEIPT_MISMATCH:'Fish 回执与本站订单不一致，已保留名额待核对。',UNAVAILABLE:'Fish 暂不可用，结果待核对，不会重复发放。',
}
export const fishErrorText=(code:string|null|undefined)=>code?errors[code]||errors.UNAVAILABLE:null
async function request(key:string,path:string,body?:unknown){
 try{
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',redirect:'manual',signal:AbortSignal.timeout(12000),headers:{authorization:'Bearer '+key,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  const reader=response.body?.getReader();if(!reader)return {status:response.status,body:null}
  const chunks:Uint8Array[]=[];let size=0
  try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>65536){await reader.cancel();return {status:response.status,body:null}}chunks.push(r.value)}}finally{reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength}
  const value=JSON.parse(new TextDecoder().decode(bytes));return {status:response.status,body:value&&typeof value==='object'&&!Array.isArray(value)?value:null}
 }catch{return {status:0,body:null}}
}
function minor(s:unknown){if(typeof s!=='string'||!/^(0|[1-9]\d{0,12})(\.\d{1,2})?$/.test(s))return null;const [a,b='']=s.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));return Number.isSafeInteger(n)?n:null}
const identity=(v:any):v is FishIdentity=>typeof v?.userId==='string'&&/^[1-9]\d{0,18}$/.test(v.userId)&&typeof v.username==='string'&&v.username.length>0&&v.username.length<100
export async function fishBalance(key:string){
 const r=await request(key,'/balance'),b=r.body
 if(r.status!==200||!identity(b?.owner)||minor(b?.available)===null||typeof b?.canTransfer!=='boolean')throw Error(fishErrorText(b?.error?.code)||errors.UNAVAILABLE)
 return {quotaKnown:b.apiKey?.dailyLimit===null||minor(b.apiKey?.dailyLimit)!==null,owner:b.owner as FishIdentity,available:b.available as string,canTransfer:b.canTransfer as boolean,reason:fishErrorText(b.reason),keyName:typeof b.apiKey?.name==='string'?b.apiKey.name.slice(0,100):'',dailyLimit:minor(b.apiKey?.dailyLimit)!==null?b.apiKey.dailyLimit:null,usedToday:minor(b.apiKey?.usedToday)!==null?b.apiKey.usedToday:null}
}
function parse(r:{status:number;body:any},a:FishAward,owner:FishIdentity,lookup:boolean):Result{
 const b=r.body?.transfer,code=r.body?.error?.code
 if(r.status===200){
  if(!b||b.dryRun||typeof b.id!=='string'||!/^[-\w]{1,100}$/.test(b.id)||b.outTransferNo!==a.order_no||b.direction!=='out'||b.destination!=='balance'||minor(b.amount)!==a.amount_cents||b.from?.userId!==owner.userId||!identity(b.from)||b.to?.userId!==a.recipient_subject||!identity(b.to)||!['sent','sending','not_sent'].includes(b.status))return {state:'unknown',receipt:null,error:'RECEIPT_MISMATCH'}
  return {state:b.status==='sent'?'accepted':b.status==='sending'?'sent':'rejected',receipt:b.id,error:b.status==='not_sent'?'UNAVAILABLE':null}
 }
 if(lookup&&r.status===404&&code==='TRANSFER_NOT_FOUND')return {state:'not_found',receipt:null,error:code}
 const definite=new Set(['INVALID_API_KEY','TRANSFER_DISABLED','TRANSFER_NOT_ALLOWED','RECIPIENT_NOT_FOUND','BALANCE_INSUFFICIENT','DAILY_LIMIT_EXCEEDED','RATE_LIMITED','SELF_TRANSFER','RECIPIENT_IS_OWNER','AMOUNT_OUT_OF_RANGE','INVALID_REQUEST'])
 return {state:!lookup&&[400,401,403,404,409,429].includes(r.status)&&definite.has(code)?'rejected':'unknown',receipt:null,error:typeof code==='string'&&Object.hasOwn(errors,code)?code:'UNAVAILABLE'}
}
export async function queryFish(key:string,a:FishAward,owner:FishIdentity){return parse(await request(key,'/balance/transfers/out/'+encodeURIComponent(a.order_no)),a,owner,true)}
export async function transferFish(key:string,a:FishAward,owner:FishIdentity,remark='尽欢红包奖励'){return parse(await request(key,'/balance/transfers',{outTransferNo:a.order_no,toUserId:a.recipient_subject,toUsername:a.recipient_username,destination:'balance',amount:money(a.amount_cents),remark}),a,owner,false)}
