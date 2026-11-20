export function roundCurrency(round){
 if(round?.reward_type==='none')return {id:'legacy',label:'历史无奖励局',unit:'',amount:''};
 const coin=round?.payment_provider==='coin52'||['D币','coin52'].includes(round?.currency);
 const unit=coin?'D币':'LDC',raw=round?.total??(Number.isFinite(round?.amount_cents)?round.amount_cents/100:null);
 const amount=raw===null?'':Number.isFinite(Number(raw))?(coin?String(Number(raw)):Number(raw).toFixed(2)):String(raw);
 return {id:coin?'coin52':'ldc',label:unit+' 奖励局',unit,amount};
}
export function currencyBadge(h,round){const c=roundCurrency(round);return h('span',{class:'gm-currency gm-currency-'+c.id,'aria-label':c.label},c.label)}
