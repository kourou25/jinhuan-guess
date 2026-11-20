import {money} from './core'
type Credentials={client_id:string;secret:string}
async function request(url:URL,init:RequestInit={}){
 try{
  const r=await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(12000)}),reader=r.body?.getReader()
  if(!reader)return {status:r.status,body:null}
  const chunks:Uint8Array[]=[];let length=0
  try{while(true){const v=await reader.read();if(v.done)break;length+=v.value.byteLength;if(length>65536){await reader.cancel();return {status:r.status,body:null}}chunks.push(v.value)}}finally{reader.releaseLock()}
  const all=new Uint8Array(length);let pos=0;for(const b of chunks){all.set(b,pos);pos+=b.length}
  let body:any;try{body=JSON.parse(new TextDecoder().decode(all))}catch{return {status:r.status,body:null}}
  return {status:r.status,body:body&&typeof body==='object'&&!Array.isArray(body)?body:null}
 }catch{return {status:0,body:null}}
}
export async function queryCredit(c:Credentials,order:string){const u=new URL('https://credit.linux.do/epay/api.php');u.search=new URLSearchParams({act:'order',pid:c.client_id,key:c.secret,out_trade_no:order}).toString();return request(u)}
export async function verifyCredit(c:Credentials){const r=await queryCredit(c,'jh-verify-'+crypto.randomUUID());return r.status===404&&r.body?.code===-1&&typeof r.body.msg==='string'}
export async function distributeCredit(c:Credentials,a:{order_no:string;recipient_subject:string;recipient_username:string;amount_cents:number}){
 const r=await request(new URL('https://credit.linux.do/lpay/distribute'),{method:'POST',headers:{'content-type':'application/json',authorization:'Basic '+btoa(c.client_id+':'+c.secret)},body:JSON.stringify({user_id:Number(a.recipient_subject),username:a.recipient_username,amount:money(a.amount_cents),out_trade_no:a.order_no,remark:'尽欢站内红包'})})
 const d=r.body?.data
 if(r.status===200&&d?.out_trade_no===a.order_no&&typeof d.trade_no==='string'&&/^\d{1,24}$/.test(d.trade_no)&&(r.body.code===1||r.body.error_msg===''))return {state:'accepted',receipt:d.trade_no}
 // 只有确定的事务拒绝才标记失败；超时、网关与异常格式保留未知，后续仅查原单。
 return {state:r.status===400&&typeof r.body?.error_msg==='string'&&r.body.error_msg&&r.body.data==null?'rejected':'unknown',receipt:null}
}
export async function reconcileCredit(c:Credentials,a:{order_no:string;amount_cents:number}){const r=await queryCredit(c,a.order_no),b=r.body;return r.status===200&&b?.code===1&&b.status===1&&String(b.pid)===c.client_id&&b.out_trade_no===a.order_no&&Number(b.money)===a.amount_cents/100&&typeof b.trade_no==='string'&&/^\d{1,24}$/.test(b.trade_no)?b.trade_no:null}
