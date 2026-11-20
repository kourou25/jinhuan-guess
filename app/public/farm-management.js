import {cropMatureAt,cropHasPests} from './farm-crop-care.js'
import {ranchAnimalStatus} from './farm-ranch.js'
import {pigStatus} from './farm-pigs.js'
// UI planning only; the existing server remains authoritative for every operation.
export function planFarmBatch(state,catalog,type,cropId,t,{autoBuy=false}={}){
 if(!state||!catalog||!Number.isFinite(t)||!['till','plant','water','pest','harvest'].includes(type))return []
 const crop=catalog.crops.find(c=>c.id===cropId),actions=[]
 let seeds=state.seeds[cropId]??0,coins=state.coins
 if(type==='plant'&&(!crop||!catalog.allUnlocked&&state.xp<crop.unlock))return []
 for(const [plot,p] of state.plots.entries()){
  if((p.leaseUntil??0)>t)continue
  const spec=p.crop&&catalog.crops.find(c=>c.id===p.crop)
  const eligible=type==='till'?!p.tilled:type==='plant'?p.tilled&&!p.crop&&(seeds>0||autoBuy&&coins>=crop.seedPrice):type==='water'?p.crop&&p.wateredAt===null:type==='pest'?spec&&cropHasPests(p,spec,t):spec&&p.wateredAt!==null&&t>=cropMatureAt(p,spec)
  if(!eligible)continue
  actions.push({type,plot,...type==='plant'?{crop:cropId,...autoBuy?{autoBuy:true}:{}}:{}})
  if(type==='plant'){if(seeds>0)seeds--;else coins-=crop.seedPrice}
 }
 return actions
}
export const isFarmTap=(pointer,dragged)=>!dragged&&Math.hypot(pointer.x-pointer.downX,pointer.y-pointer.downY)<10

export function planRanchBatch(state,catalog,type,t){
 if(!state?.ranch||!catalog?.ranch||!Number.isFinite(t)||!['animal_collect','animal_feed','animal_clean'].includes(type))return []
 const actions=[],products={...state.ranch.products}
 let feed=state.ranch.feed
 for(const [animal,a] of state.ranch.animals.entries()){
  const spec=catalog.animals.find(c=>c.id===a.kind);if(!spec)continue
  const status=ranchAnimalStatus(a,spec,t,catalog.ranch.capacity,catalog.ranch.starvationSeconds)
  if(type==='animal_clean'){if(status.manure)actions.push({type,animal})}
  else if(type==='animal_collect'){
   if(status.stored<1||(products[a.kind]??0)+status.stored>10000)continue
   actions.push({type,animal});products[a.kind]=(products[a.kind]??0)+status.stored
  }else if(!status.dead&&feed>0&&Math.max(t,a.fedUntil)+spec.seconds<=t+catalog.ranch.maxFedSeconds){
   actions.push({type,animal,count:1});feed--
  }
 }
 if(type==='animal_feed')for(const p of state.pigs?.animals??[]){const spec=catalog.pigs?.find(c=>c.id===p.kind);if(!spec)continue;const v=pigStatus(p,spec,t),units=catalog.leisure.pigFeedUnits??2;if(!v.dead&&!v.adult&&feed>=units&&Math.max(t,p.fedUntil)+catalog.leisure.feedSeconds<=t+catalog.leisure.maxFeedSeconds){actions.push({type:'pig_feed_stock',pig:p.id,count:1});feed-=units}}
 if(type==='animal_clean')for(const p of state.pigs?.animals??[]){const spec=catalog.pigs?.find(c=>c.id===p.kind);if(spec&&pigStatus(p,spec,t).manure)actions.push({type:'pig_clean',pig:p.id})}
 return actions
}
