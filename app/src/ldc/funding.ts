import {ensureCoinWallet} from '../farm/coin-packets'
import {now} from '../lib/time'
import type {C} from '../types'
import {fail} from '../lib/http'
import {unseal} from './core'
export type FundingAccount={user_id:number;client_id:string;secret_box:string;enabled:number;payment_provider:'credit'|'fish'|'coin52'}
// Missing provider is legacy API compatibility; all new composer requests explicitly select Fish.
export function fundingProvider(b:Record<string,unknown>){if(b.payment_provider!==undefined&&!['credit','fish','coin52'].includes(String(b.payment_provider)))fail(400,'结算通道无效');return b.payment_provider==='coin52'?'coin52':b.payment_provider==='fish'?'fish':'credit'}
export async function fundingAccount(c:C,uid:number,provider:'credit'|'fish'|'coin52'){
 if(provider==='credit'&&!await c.env.DB.prepare('SELECT 1 FROM ldc_accounts WHERE user_id=? AND create_enabled=1').bind(uid).first())fail(409,'Credit 新发包已关闭，请在支付渠道设置中开启')
 if(provider==='coin52')await ensureCoinWallet(c.env.DB,uid,now())
 const a=await c.env.DB.prepare('SELECT * FROM packet_funding_accounts WHERE user_id=? AND payment_provider=? AND enabled=1').bind(uid,provider).first<FundingAccount>()
 if(!a)fail(409,provider==='fish'?'请先绑定并启用本人的 Fish API Key':'请先绑定并启用自己的 LDC 应用')
 return a!
}
export async function fundingSecret(c:C,a:FundingAccount){try{return await unseal(c.env.LDC_ENCRYPTION_KEY!,`${a.payment_provider==='fish'?'fish':'ldc'}-account:${a.user_id}:${a.client_id}`,a.secret_box)}catch{return fail(503,'发包凭据无法解密，请联系站长检查配置')}}
