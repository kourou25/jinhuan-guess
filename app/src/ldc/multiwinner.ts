// Integer basis points; all rounding remains in the smallest unit of the currency.
export function winnerWeights(count:number){
 if(!Number.isInteger(count)||count<1||count>10)throw Error('猜词中奖人数需为1–10人')
 if(count===1)return [10000]
 if(count===2)return [7000,3000]
 if(count===3)return [6000,2500,1500]
 if(count===4)return [5000,2500,1500,1000]
 const sum=count*(count-1)/2,rest=Array.from({length:count-1},(_,i)=>Math.floor(6000*(count-1-i)/sum))
 rest[0]+=6000-rest.reduce((a,b)=>a+b,0)
 return [4000,...rest]
}
export function splitWinners(total:number,count:number,unit=1){
 const weights=winnerWeights(count),units=total/unit
 if(!Number.isSafeInteger(units)||units<1)throw Error('奖励金额无效')
 const values=weights.map(w=>Math.floor(units*w/10000))
 values[0]=units-values.slice(1).reduce((a,b)=>a+b,0)
 if(values.some(v=>v<1))throw Error('奖池不足，请提高金额或减少中奖人数，每个名次至少获得一个最小货币单位')
 return values.map(v=>v*unit)
}
export function multiwinnerOptions(b:Record<string,unknown>,total:number,unit=1){
 const count=b.guess_winners===undefined?1:b.guess_winners
 if(typeof count!=='number')throw Error('猜词中奖人数需为1–10人')
 const weights=winnerWeights(count),hidden=b.hidden_winners===undefined?count-1:b.hidden_winners
 if(typeof hidden!=='number'||!Number.isInteger(hidden)||hidden<0||hidden>=count)throw Error('隐藏人数需为0至中奖名额减一')
 return {count,hidden,weights,slots:splitWinners(total,count,unit)}
}
