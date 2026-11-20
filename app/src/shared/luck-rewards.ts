const thresholds=[1,3,10,30,100] as const
const king=['初遇好运','福气临门','锦鲤附体','鸿运当头','天选锦鲤']
const last=['微光入袋','一分不弃','逆风收集','低谷漫游','逆运星主']
export const LUCK_REWARDS=['luck_king','luck_last'].flatMap(series=>thresholds.map((wins,i)=>({
 id:series+(i+1),series,level:i+1,wins,name:(series==='luck_king'?king:last)[i],symbol:series==='luck_king'?'♛':'☾',
})))
export const luckReward=(id:unknown)=>LUCK_REWARDS.find(r=>r.id===id)
