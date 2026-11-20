// D币 entertainment rules. Official 2026 DLT prize combinations, not official tickets.
export const LOTTO_V2={front:35,back:12,price:10,space:21425712,winPercent:6.6705,prizeBudget:.8}
export const LOTTO_PRIZES=[
 {tier:1,match:'5+2',ways:1,prize:'浮动一等奖'},
 {tier:2,match:'5+1',ways:20,prize:'浮动二等奖'},
 {tier:3,match:'5+0 / 4+2',ways:195,prize:'参考 2500 倍'},
 {tier:4,match:'4+1',ways:3000,prize:'参考 150 倍'},
 {tier:5,match:'4+0 / 3+2',ways:11100,prize:'参考 75 倍'},
 {tier:6,match:'3+1 / 2+2',ways:127600,prize:'参考 7.5 倍'},
 {tier:7,match:'3+0 / 2+1 / 1+2 / 0+2',ways:1287281,prize:'参考 2.5 倍'},
]
export const SCRATCH_PRIZES=[{multiple:0,weight:5998},{multiple:1,weight:2500},{multiple:2,weight:1300},{multiple:5,weight:150},{multiple:10,weight:42},{multiple:20,weight:9},{multiple:50,weight:1}]
export function scratchMultiple(roll:number){let total=0;for(const p of SCRATCH_PRIZES){total+=p.weight;if(roll<total)return p.multiple}throw Error('scratch roll out of range')}
export function lottoTier(f:number,b:number){return f===5&&b===2?1:f===5&&b===1?2:f===5||f===4&&b===2?3:f===4&&b===1?4:f===4||f===3&&b===2?5:f===3&&b===1||f===2&&b===2?6:f===3||f===2&&b===1||b===2?7:0}
// Fixed lower-tier reference multipliers are scaled only when the period budget
// cannot cover them. Both top tiers share the rest, never issuing unbacked prizes.
export function lottoPayout(tier:number,counts:Record<string,number>,pool:number){
 if(!tier||!counts[tier])return 0
 const reference:Record<number,number>={3:25000,4:1500,5:750,6:75,7:25}
 const demand=Object.entries(reference).reduce((n,[k,v])=>n+(counts[k]||0)*v,0),heads=(counts[1]||0)+(counts[2]||0)
 const lowerBudget=Math.min(demand,Math.floor(pool*(heads ? .7 : 1))),scale=demand?lowerBudget/demand:0
 if(tier>=3)return Math.floor(reference[tier]*scale)
 const rest=pool-lowerBudget,share=counts[1]&&counts[2]?(tier===1 ? .85 : .15):1
 return Math.floor(rest*share/counts[tier])
}
