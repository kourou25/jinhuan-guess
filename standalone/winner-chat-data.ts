type WinnerNotice={kind:'guess_winner';message_id:number;rank:number;amount_cents:number|null;payment_provider:'coin52'|'fish'|'credit';state:string;needs_fish_setup:boolean;remaining_slots:number;remaining_cents:number|null};
// Called with a database row only; never with client-submitted fields.
export function winnerChatData(row:{system_kind?:unknown;system_data?:unknown}):WinnerNotice|null{
 if(row.system_kind!=='guess_winner'||typeof row.system_data!=='string')return null;
 try{
  const d=JSON.parse(row.system_data),amount=(n:unknown)=>n===null||Number.isSafeInteger(n)&&Number(n)>=0;
  if(d.version!==1||!Number.isSafeInteger(d.message_id)||d.message_id<1||!Number.isSafeInteger(d.rank)||d.rank<1||d.rank>10||!amount(d.amount_cents)||!amount(d.remaining_cents)||!Number.isSafeInteger(d.remaining_slots)||d.remaining_slots<0||d.remaining_slots>9||!['coin52','fish','credit'].includes(d.payment_provider)||!['ready','reserved','sent','accepted','unknown','rejected'].includes(d.state))return null;
  return {kind:'guess_winner',message_id:d.message_id,rank:d.rank,amount_cents:d.amount_cents,payment_provider:d.payment_provider,state:d.state,needs_fish_setup:d.payment_provider==='fish'&&d.state==='rejected'&&d.needs_fish_setup===1,remaining_slots:d.remaining_slots,remaining_cents:d.remaining_cents};
 }catch{return null}
}
export function winnerChatBody(d:WinnerNotice):string{
 const coin=d.payment_provider==='coin52',unit=coin?'D币':'LDC',platform=coin?'本站 D币钱包':d.payment_provider==='fish'?'Fish 余额':'Linux DO Credit';
 const amount=(n:number|null)=>n===null?'核定中':(coin&&n%100===0?String(n/100):(n/100).toFixed(2))+' '+unit;
 const state=d.amount_cents===null?'名额已锁定':d.state==='accepted'?(d.payment_provider==='credit'?'平台已受理，到账以 Credit 为准':'已到账'):d.state==='rejected'?'发放失败，中奖名额保留':d.state==='unknown'?'到账状态待核对':'发放处理中';
 return `第 ${d.rank} 位猜中 · 奖励 ${amount(d.amount_cents)}\n${platform} · ${state}${d.needs_fish_setup?'\n收款人需先用同一 Linux.DO 账号登录 Fish 完成收款配置：https://hb.lafi.sh/；完成后请发起者沿原单重试。':''}\n中奖后剩余 ${d.remaining_slots} 个名额 · 剩余奖金 ${amount(d.remaining_cents)}`;
}
