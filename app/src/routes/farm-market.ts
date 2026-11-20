import {Hono} from 'hono'
import type {Ctx} from '../types'
import {needUser} from '../services/auth'
import {boundedJson,fail,sameOrigin} from '../lib/http'
import {now} from '../lib/time'
import {marketEnabled,enrollMarket,tradeMarket} from '../farm/market'
import {MARKET_ITEMS} from '../farm/market-stock'
import {MARKET_RULES} from '../farm/market-rules'
import {farmActionLimit} from '../farm/action-limit'
import {marketQuotes} from '../farm/market-quotes'
export const farmMarket=new Hono<Ctx>()
farmMarket.get('/api/farm/market/history',async c=>{
 needUser(c);const item=c.req.query('item'),t=now()
 if(!MARKET_ITEMS.some(i=>i.key===item))return fail(400,'请选择有效物产')
 const snapshot=await marketQuotes(c.env.DB,c.req.url,t,item,typeof caches==='undefined'?undefined:caches.default)
 c.header('Cache-Control','private, no-store')
 return c.json({item,points:snapshot.rows.filter(p=>Number(p.tick_at)>=t-86400),quotes_at:snapshot.sampled_at,server_time:t})
})
farmMarket.get('/api/farm/market',async c=>{
 const uid=needUser(c).id,t=now(),item=c.req.query('item'),page=c.req.query('before')
 if(item&&!MARKET_ITEMS.some(i=>i.key===item)||page&&(!/^\d+$/.test(page)||!Number.isSafeInteger(Number(page))))return fail(400,'行情筛选无效')
 const [account,goods]=await Promise.all([
  c.env.DB.prepare('SELECT remainder_cents FROM farm_market_accounts WHERE user_id=?').bind(uid).first<{remainder_cents:number}>(),
  marketQuotes(c.env.DB,c.req.url,t,undefined,typeof caches==='undefined'?undefined:caches.default),
 ])
 // At most 61 rows from each indexed owner range. Details never poll farm JSON.
 const query=`SELECT l.*,g.price_cents FROM farm_market_lots l JOIN farm_market_goods g ON g.item=l.item WHERE l.owner_id=? AND l.quantity>0 ${item?'AND l.item=?':''} ${page?'AND l.rowid<?':''} ORDER BY l.rowid DESC LIMIT 61`
 const args=(id:number)=>[id,...item?[item]:[],...page?[Number(page)]:[]]
 const [mine,shop]=await c.env.DB.batch<Record<string,unknown>>([
  c.env.DB.prepare(query.replace('SELECT l.*,','SELECT l.rowid AS cursor,l.*,')).bind(...args(uid)),
  c.env.DB.prepare(`SELECT l.rowid AS cursor,l.*,g.price_cents FROM farm_market_lots l JOIN farm_market_goods g ON g.item=l.item WHERE l.owner_id=0 AND l.quantity>0 AND l.expires_at>? ${item?'AND l.item=?':''} ORDER BY l.expires_at,l.id LIMIT 60`).bind(t,...item?[item]:[]),
 ])
 const items=mine.results.slice(0,60)
 c.header('Cache-Control','private, no-store')
 return c.json({enabled:await marketEnabled(c.env.DB),active:!!account,remainder_cents:account?.remainder_cents??0,rules:MARKET_RULES,catalog:MARKET_ITEMS,goods:goods.rows,quotes_at:goods.sampled_at,lots:items,next:mine.results.length>60?items.at(-1)?.cursor:null,shop:shop.results,server_time:t})
})
farmMarket.post('/api/farm/market',async c=>{
 sameOrigin(c);const uid=needUser(c).id,b=await boundedJson(c,1024),t=now()
 if(typeof b.id!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(b.id))return fail(400,'交易编号无效')
 await farmActionLimit(c.env.DB,uid,t,6)
 if(b.kind==='enroll'){
  if(Object.keys(b).some(k=>!['id','kind'].includes(k)))return fail(400,'开通参数无效')
  return c.json(await enrollMarket(c.env.DB,uid,b.id,t))
 }
 if(Object.keys(b).some(k=>!['id','kind','lot','quantity','price','expected_total'].includes(k))||!['buy','sell'].includes(String(b.kind))||typeof b.lot!=='string'||b.lot.length>80||!Number.isSafeInteger(b.quantity)||Number(b.quantity)<1||Number(b.quantity)>MARKET_RULES.maxTrade||!Number.isSafeInteger(b.price)||Number(b.price)<1||b.expected_total!==undefined&&(!Number.isSafeInteger(b.expected_total)||Number(b.expected_total)<0))return fail(400,'交易参数无效，数量为1至99')
 try{return c.json(await tradeMarket(c.env.DB,uid,b as {id:string;kind:'buy'|'sell';lot:string;quantity:number;price:number},t))}catch(e){if(e instanceof Error&&['D币余额不足或超出可结算范围','仓库数量不足或已满','所选来源的库存不足'].includes(e.message))return fail(400,e.message);throw e}
})
