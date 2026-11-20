// The deployment binding, never request input, enables the one approved provider.
const networkFetch=globalThis.fetch.bind(globalThis);
let fishEnabled=false;
export function configureOutbound(env:{GUESS_FISH_ENABLED?:string;GUESS_SIMULATED_LDC?:string;GUESS_FISH_CUSTODIAN_ID?:string;ADMIN_USER_IDS?:string}){
 const id=Number(env.GUESS_FISH_CUSTODIAN_ID);
 fishEnabled=env.GUESS_FISH_ENABLED==='1'&&env.GUESS_SIMULATED_LDC!=='1'&&Number.isSafeInteger(id)&&id!==0&&(env.ADMIN_USER_IDS||'').split(',').some(v=>/^-?\d+$/.test(v.trim())&&Number(v)===id);
 return fishEnabled;
}
globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 const method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
 if(!fishEnabled||url.origin!=='https://hb.lafi.sh'||url.username||url.password||!/^\/api\/open\/balance(?:\/transfers(?:\/out\/[-\w]+)?)?$/.test(url.pathname)||!['GET','POST'].includes(method))throw new Error('standalone_external_service_not_configured');
 return networkFetch(input,{...init,redirect:'manual'});
}) as typeof fetch;
