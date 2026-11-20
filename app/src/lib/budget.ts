/** 按实际派发计数；失败请求也占用预算。D1 batch 在派发前一次预留全部语句。 */
export class InvocationBudget {
 private queries=0
 private requests=0
 constructor(private ceiling:number){if(!Number.isSafeInteger(ceiling)||ceiling<0)throw new Error('invalid_invocation_budget')}
 get limit(){return this.ceiling}
 restrict(limit:number){if(!Number.isSafeInteger(limit)||limit<0||limit<this.sql+this.fetches)throw new Error('invalid_invocation_budget');this.ceiling=Math.min(this.ceiling,limit)}
 get sql(){return this.queries}
 get fetches(){return this.requests}
 get remaining(){return this.limit-this.queries-this.requests}
 chargeSql(count:number){
  if(!Number.isSafeInteger(count)||count<0||count>this.remaining)throw new Error('invocation_budget_exhausted')
  this.queries+=count
 }
 async fetch(perform:typeof fetch,input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]){
  if(this.remaining<1)throw new Error('invocation_budget_exhausted')
  this.requests++
  // 自动跳转会产生计数器看不见的子请求；调用方必须逐跳检查与计数。
  return perform(input,{...init,redirect:'manual'})
 }
}

export function meterDatabase(db:D1Database,budget:InvocationBudget):D1Database {
 const raw=new WeakMap<D1PreparedStatement,D1PreparedStatement>()
 const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>{
  const proxy=new Proxy(statement,{get(target,key){
   if(key==='bind')return (...args:unknown[])=>wrap(target.bind(...args))
   if(key==='first'||key==='all'||key==='run'||key==='raw')return (...args:unknown[])=>{
    budget.chargeSql(1)
    return Reflect.apply(target[key],target,args)
   }
   throw new Error('unmetered_d1_operation')
  }})
  raw.set(proxy,statement);return proxy
 }
 return new Proxy(db,{get(target,key){
  if(key==='prepare')return (sql:string)=>wrap(target.prepare(sql))
  if(key==='batch')return (statements:D1PreparedStatement[])=>{
   const unwrapped=statements.map(statement=>{
    const value=raw.get(statement);if(!value)throw new Error('foreign_d1_statement');return value
   })
   budget.chargeSql(unwrapped.length)
   return target.batch(unwrapped)
  }
  // exec、多会话及未来新 API 必须显式增加计量，不允许绕过计数器。
  throw new Error('unmetered_d1_operation')
 }})
}
