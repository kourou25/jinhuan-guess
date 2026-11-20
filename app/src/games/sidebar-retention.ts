import type {Env} from '../env'
export const sidebarDay=(at:number)=>Math.floor((at+28800)/86400)*86400-28800
export async function cleanupSidebar(env:Env,at=Math.floor(Date.now()/1000)){
 const day=sidebarDay(at),key='guess.sidebar.cleaned_day';const prior=await env.DB.prepare('SELECT v FROM site_settings WHERE k=?').bind(key).first<{v:string}>();if(Number(prior?.v)>=day)return;
 await env.DB.batch([env.DB.prepare('DELETE FROM guess_sidebar_messages WHERE created_at<?').bind(day),env.DB.prepare('INSERT INTO site_settings(k,v,updated_at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated_at=excluded.updated_at').bind(key,String(day),at)]);
}
