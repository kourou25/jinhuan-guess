// 退休ID永不重用；保留bot区间，空库起点仍为1,000,000,000。
export const NEXT_ACCOUNT_ID_SQL=`SELECT MAX(999999999,
 COALESCE((SELECT MAX(id) FROM users WHERE id<999000000 OR id>999999999),0),
 COALESCE((SELECT MAX(source_id) FROM account_retirements),0))+1 AS id`
export function isRetiredAccountError(error:unknown){
 let value:unknown=error
 for(let depth=0;depth<4&&value;depth++){
  if(value instanceof Error&&/(?:D1_ERROR: )?account_retired(?:: SQLITE_CONSTRAINT|$)/.test(value.message))return true
  value=value instanceof Error?value.cause:null
 }
 return false
}
