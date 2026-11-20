export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response=await fetch(path,{credentials:'same-origin',...init})
  const body=await response.json().catch(()=>null)
  if(!response.ok)throw Object.assign(new Error(body?.error||'服务暂不可用，请稍后重试'),{status:response.status,code:body?.code})
  if(body===null)throw new Error('未收到有效结果，请刷新后查看')
  return body
}
