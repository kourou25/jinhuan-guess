import type {XContent,SocialMedia} from './social-x'

// 微博桌面短码每四位编码七位十进制ID；只接受有限长度的对象编号。
export function weiboObjectId(value:string){
 if(/^\d{5,25}$/.test(value))return value
 if(!/^[0-9A-Za-z]{5,12}$/.test(value))return null
 const alphabet='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',groups:string[]=[]
 for(let end=value.length;end>0;end-=4){let n=0;for(const ch of value.slice(Math.max(0,end-4),end))n=n*62+alphabet.indexOf(ch);if(n>9999999)return null;groups.unshift(end>4?String(n).padStart(7,'0'):String(n))}
 const id=groups.join('');return /^\d{5,25}$/.test(id)?id:null
}
export function weiboMediaUrl(raw:unknown,video=false){
 if(video)return null
 try{const u=new URL(String(raw));return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&(u.hostname==='sinaimg.cn'||u.hostname.endsWith('.sinaimg.cn'))?u.href:null}catch{return null}
}
// 只解析公开页面中的JSON字符串和对象，绝不执行Flight/页面脚本。
export function parseWeiboPage(html:string,expectedId:string):XContent|null{
 if(html.length>262144||!/^\d{5,25}$/.test(expectedId))return null
 let stream=''
 for(const m of html.matchAll(/self\.__next_f\.push\((\[1,"(?:[^"\\]|\\.)*"\])\)/g)){
  try{const part=JSON.parse(m[1]);if(typeof part[1]==='string')stream+=part[1]}catch{}
 }
 const stack:{value:unknown;depth:number}[]=[]
 for(const record of stream.split('\n')){const colon=record.indexOf(':');if(colon<1)continue;try{stack.push({value:JSON.parse(record.slice(colon+1)),depth:0})}catch{}}
 let remaining=10000
 while(stack.length&&remaining-->0){
  const {value,depth}=stack.pop()!;if(!value||typeof value!=='object'||depth>24)continue
  const node=value as Record<string,any>
  if(node.id===expectedId&&node.header&&node.content&&node.content.id===expectedId){
   const text=node.content.textRaw
   if(typeof text!=='string'||typeof node.header.name!=='string')return null
   const media:SocialMedia[]=[],seen=new Set<string>(),cards=[node.content.card?.data];let budget=300
   while(cards.length&&media.length<12&&budget-->0){
    const card=cards.shift();if(!card||typeof card!=='object')continue
    const url=weiboMediaUrl(card.url)
    if(url&&!seen.has(url)){seen.add(url);media.push({url,kind:'image',width:null,height:null})}
    for(const child of Object.values(card))if(child&&typeof child==='object')cards.push(child)
   }
   const description=text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\ufeff]/g,'').trim().slice(0,10000)
   if(!description&&!media.length)return null
   return {title:node.header.name.slice(0,100),description,image:media[0]?.url||null,media,available:true}
  }
  for(const child of Object.values(node))if(child&&typeof child==='object')stack.push({value:child,depth:depth+1})
 }
 return null
}
