import {COMMUNITY_REWARDS} from './community-growth'
import {FARM_BADGES} from './farm-badges'
const families=[
 {series:'guess_pressure',name:'传奇抗压王',symbol:'◆',desc:'参与300次调用耗尽且无人猜中的猜词局，每局累计一次'},
 {series:'guess_tormentor',name:'究极折磨王',symbol:'✧',desc:'发起300次调用耗尽且无人猜中的猜词局，每局累计一次'},
 {series:'guess_firstshot',name:'秒射',symbol:'ϟ',desc:'本局第一个有效猜答案即猜中，每局累计一次'},
 {series:'guess_easy',name:'弱爆（菜）',symbol:'✿',desc:'发起的题被第一个有效猜答案猜中，每局累计一次'},
] as const
export const ACTIVITY_REWARDS=[...COMMUNITY_REWARDS,...families.flatMap(f=>[1,3,10,30,100].map((wins,i)=>({...f,id:f.series+(i+1),label:f.name,level:i+1,wins,unit:'次'}))),
 ...FARM_BADGES.flatMap(f=>f.levels.map((wins,i)=>({series:f.id,name:f.name,id:f.id+(i+1),label:f.name,level:i+1,wins,unit:f.unit,desc:f.desc,symbol:f.id==='farm_plant'?'✿':f.id.startsWith('fishing_')?'≈':'✦'})))]
export const activityReward=(id:unknown)=>ACTIVITY_REWARDS.find(r=>r.id===id)
