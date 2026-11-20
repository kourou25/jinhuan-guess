// Spread characters evenly across rows while preserving their answer positions.
export function revealLayout(length,limit=8){
 const count=Math.max(0,Math.floor(length)),rows=Math.ceil(count/limit),columns=rows?Math.ceil(count/rows):1;
 const positions=[];let index=0;
 for(let row=1;row<=rows;row++){
  const size=Math.floor(count/rows)+(row<=count%rows?1:0);
  for(let column=1;column<=size;column++)positions[index++]={row,column};
 }
 return {columns,positions};
}
