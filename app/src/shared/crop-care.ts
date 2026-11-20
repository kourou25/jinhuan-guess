/** One clock for Worker, field renderers, visitor protection and leased plots. */
export type CropTiming = {wateredAt:number|null;pestAt?:number;careCycle?:number;cycle?:string;readyNotBefore?:number}
export const CROP_CARE = {chance:0.25,appearsAt:0.35,delay:0.1} as const
export function cropMaxSeconds(seconds:number){return seconds+Math.ceil(seconds*CROP_CARE.delay)}
export function cropMatureAt(plot:CropTiming,crop:{seconds:number}){
 return plot.wateredAt===null?Infinity:Math.max(plot.readyNotBefore??0,plot.wateredAt+crop.seconds+(plot.pestAt===undefined?0:Math.ceil(crop.seconds*CROP_CARE.delay)))
}
export function cropHasPests(plot:CropTiming,crop:{seconds:number},t:number){
 return plot.pestAt!==undefined&&plot.wateredAt!==null&&t>=plot.pestAt&&t<cropMatureAt(plot,crop)
}
export function cropProgress(plot:CropTiming,crop:{seconds:number},t:number){
 return plot.wateredAt===null?0:Math.max(0,Math.min(1,(t-plot.wateredAt)/(cropMatureAt(plot,crop)-plot.wateredAt)))
}
export function clearCropPests(plot:CropTiming,crop:{seconds:number},t:number){
 // Clearing a late infestation can ripen the crop now, never retroactively.
 // Visitor protection must still start at the actual moment of ripening.
 if(plot.wateredAt!==null&&plot.wateredAt+crop.seconds<t)plot.readyNotBefore=t
 delete plot.pestAt
}
export function waterCrop(plot:CropTiming,crop:{seconds:number},t:number){
 plot.wateredAt=t
 // Only new, server-created cycles participate. Existing crops keep their old deadline.
 if(plot.careCycle===1&&plot.cycle&&parseInt(plot.cycle.slice(0,2),16)<256*CROP_CARE.chance)plot.pestAt=t+Math.floor(crop.seconds*CROP_CARE.appearsAt)
}
