// Reversible public identifiers only. This is a presentation format, not encryption.
const alphabet=[...'🍎🍊🍋🍐🍇🍓🍒🥝🥥🍍'];
const digits=new Map(alphabet.map((symbol,i)=>[symbol,String(i)]));
const valid=value=>Number.isSafeInteger(value)&&value>0;
const encode=value=>String(value).split('').map(d=>alphabet[Number(d)]).join('');
function decode(value){
 const chars=[...value];if(!chars.length||chars.length>16||chars.some(c=>!digits.has(c)))return 0;
 const text=chars.map(c=>digits.get(c)).join('');if(text[0]==='0')return 0;
 const result=Number(text);return valid(result)?result:0;
}
export function emojiInvitePath(gid,messageId){
 if(!valid(gid)||!valid(messageId))throw Error('轮次信息尚未就绪');
 return '/🧩/'+(gid===1?'':encode(gid)+'/')+encode(messageId);
}
export function readEmojiInvite(path){
 let decoded;try{decoded=decodeURIComponent(path)}catch{return null}
 const parts=decoded.split('/');if(parts[0]!==''||parts[1]!=='🧩'||![3,4].includes(parts.length))return null;
 const gid=parts.length===3?1:decode(parts[2]),messageId=decode(parts.at(-1));
 return valid(gid)&&valid(messageId)?{gid,messageId}:null;
}
