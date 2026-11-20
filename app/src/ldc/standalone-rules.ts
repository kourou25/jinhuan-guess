export function guessMinutes(value:unknown=30){const n=Number(value);if(!Number.isInteger(n)||n<1||n>30)throw Error('猜词时限需为1–30分钟');return n}
export function revealFrame(answer:string,order:number[],start:number,end:number,time:number){
 const chars=[...answer],half=start+(end-start)/2,n=chars.length;
 const count=time>=end?n:time<half||n<=1?0:Math.min(n-1,1+Math.floor((time-half)*(n-1)/(end-half)));
 const shown=new Set(order.slice(0,count));
 return {letters:chars.map((char,index)=>shown.has(index)?char:null),revealed:count,total:n,starts_at:half,next_at:count>=n?null:count===0?half:count===n-1?end:half+count*(end-half)/(n-1)};
}
export async function revealOrder(key:string,id:string,length:number){
 const enc=new TextEncoder(),secret=await crypto.subtle.importKey('raw',enc.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const ranks=await Promise.all(Array.from({length},async(_,i)=>({i,hash:[...new Uint8Array(await crypto.subtle.sign('HMAC',secret,enc.encode('guess-reveal:'+id+':'+i)))].map(n=>n.toString(16).padStart(2,'0')).join('')})));
 return ranks.sort((a,b)=>a.hash.localeCompare(b.hash)).map(v=>v.i);
}
export type PredictionCurrency='coin52'|'ldc';
export function predictionCurrency(value:unknown):PredictionCurrency|null{if(value===undefined||value===null||value==='off')return null;if(value!=='coin52'&&value!=='ldc')throw Error('请选择关闭、LDC或D币下注');return value}
export function stakeMinor(currency:unknown,value:unknown){
 if(currency!=='ldc'&&currency!=='coin52')throw Error('下注币种无效');const s=String(value);
 if(!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(s))throw Error('请输入有效下注金额');const [a,b='']=s.split('.');
 const n=currency==='ldc'?Number(a)*100+Number(b.padEnd(2,'0')):Number(a);
 if(currency==='coin52'&&b||n<(currency==='ldc'?10:100)||n>(currency==='ldc'?10000:100000))throw Error(currency==='ldc'?'LDC下注为0.1–100':'D币下注为100–100000整数');return n;
}
export type Bet={id:string;user_id:number;target_id:number;amount:number};
export function poolReturns(bets:Bet[],winner:number|null){
 const winners=bets.filter(b=>b.target_id===winner),total=bets.reduce((n,b)=>n+BigInt(b.amount),0n),den=winners.reduce((n,b)=>n+BigInt(b.amount),0n);
 if(!den)return bets.map(b=>({...b,amount:b.amount,refund:true}));
 const rows=bets.map(b=>{const num=b.target_id===winner?total*BigInt(b.amount):0n;return {...b,amount:Number(num/den),remainder:num%den,refund:false}});
 let rest=Number(total-rows.reduce((n,r)=>n+BigInt(r.amount),0n));
 for(const row of [...rows].filter(r=>r.target_id===winner).sort((a,b)=>a.remainder===b.remainder?a.id.localeCompare(b.id):a.remainder>b.remainder?-1:1)){if(rest-->0)row.amount++}
 return rows.map(({remainder,...r})=>r);
}
