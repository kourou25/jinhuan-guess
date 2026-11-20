export class AiError extends Error {
 attempts=0
 reason?:'cap'|'breaker'
 constructor(public code:'ai_disabled'|'ai_off'|'quota'|'ai_busy'|'ai_upstream'|'ai_input'|'ai_refused'|'ai_ineligible'|'ai_image_fetch',public status:number,public retryable=false,public failure?:'timeout'|'network'|'http'|'empty'|'invalid_response'|'output_limit'){
  super({ai_disabled:'AI 尚未开放',ai_off:'AI 暂时休息了',quota:'今天的 AI 次数用完了',ai_busy:'AI 太忙了，请稍后再试',ai_upstream:'AI 那边暂时不可用',ai_input:'AI 请求格式不正确',ai_refused:'这段内容 AI 不方便处理',ai_ineligible:'内容已变化，取消本次 AI 处理',ai_image_fetch:'图片暂时无法读取'}[code])
 }
}
export function aiFailureText(error:unknown){
 if(!(error instanceof AiError))return '欢欢本次回答失败，请重新发送这条问题。'
 if(error.code==='ai_upstream'&&error.failure){
  const reason={output_limit:'AI 本次输出额度耗尽，未返回完整回答',empty:'AI 本次返回了空回答',invalid_response:'AI 本次返回格式异常',timeout:'AI 本次响应超时',network:'AI 本次网络连接失败',http:'AI 上游本次返回错误状态'}[error.failure]
  return reason+'，请重新发送；已锁定奖励不会重复发放。'
 }
 return {ai_disabled:'欢欢功能当前未开启，请联系站长。',ai_off:error.reason==='cap'?'全站今天的 AI 次数已用完，明日恢复；准确猜中仍可获奖。':'AI 通道正在短暂恢复，请稍后重新发送。',quota:'当前功能的全站额度已用完或任务状态已变化；缓存回答和准确猜中仍可参与。',ai_busy:'AI 服务当前繁忙，请稍后重新发送。',ai_upstream:'AI 服务本次连接失败或超时，请重新发送；已锁定奖励不会重复发放。',ai_input:'这条 AI 请求格式有误，请调整内容后重发。',ai_refused:'这条内容未被模型接受，请换一种问法。',ai_ineligible:'消息或参与状态已变化，已取消本次回答。',ai_image_fetch:'AI 暂时无法读取这张图片。'}[error.code]
}
