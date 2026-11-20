// Official host detection supports saved connections without guessing from model names.
export function isTypeSafe(base:string):boolean{
 try{return new URL(base).hostname.toLowerCase()==='api.typesafe.ai'}catch{return false}
}
export const supportsTypeSafeTask=(task:string)=>task==='similarity'||task==='yesno'
