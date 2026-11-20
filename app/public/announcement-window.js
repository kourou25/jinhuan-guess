export function createAnnouncementWindow({onChange,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 let ready=false,dead=false,timer=null,last='';
 const seen=new Map(),active=new Map();
 function publish(){
  if(dead)return;clearTimer(timer);timer=null;const t=now();
  for(const [id,row] of active)if(row.pinUntil<=t)active.delete(id);
  const rows=[...active.values()].sort((a,b)=>b.pinUntil-a.pinUntil||b.item.id-a.item.id);
  const view={toasts:rows.filter(r=>r.toastUntil>t).map(r=>r.item),pins:rows.map(r=>r.item)},key=JSON.stringify(view);
  if(key!==last){last=key;onChange(view)}
  const deadlines=rows.flatMap(r=>[r.pinUntil,r.toastUntil]).filter(at=>at>t);
  if(deadlines.length)timer=setTimer(publish,Math.min(...deadlines)-t);
 }
 return {
  ingest(items,serverNow,silent=false){
   if(dead)return;const t=now(),ids=new Set(items.map(item=>item.id));
   for(const id of active.keys())if(!ids.has(id))active.delete(id);
   for(const item of items){
    const version=JSON.stringify([item.text,item.players]);
    if(seen.get(item.id)===version)continue;
    seen.set(item.id,version);
    const eventAt=item.kind==='start'?item.created_at:Math.max(item.created_at,item.updated_at||0);
    const age=Math.max(0,(serverNow-eventAt)*1000),remaining=60000-age;
    if(remaining>0)active.set(item.id,{item,pinUntil:t+remaining,toastUntil:ready&&!silent?t+Math.min(5000,remaining):t});
   }
   while(seen.size>500)seen.delete(seen.keys().next().value);
   ready=true;publish();
  },
  dismiss(id){active.delete(id);publish()},
  destroy(){dead=true;clearTimer(timer);active.clear();onChange({toasts:[],pins:[]})}
 };
}
