// 只识别消息本身的反馈标签，引用他人的反馈不重复转入。
export function chatRoadContent(body: string) {
  const own = body.replace(/\[quote(?:="[^"]*")?\][\s\S]*?\[\/quote\]/gi, '')
  const tag = own.match(/[#＃](需求|bug)(?![A-Za-z0-9_])/i)
  if (!tag) return null
  const text = own.replace(/[#＃](需求|bug)(?![A-Za-z0-9_])/gi, '')
    .replace(/(?<![\w@.])@[A-Za-z0-9_][\w.-]*/g, '').replace(/\s+/g, ' ').trim()
  const kind = tag[1].toLowerCase() === 'bug' ? 'bug' : 'feature'
  return { kind, title: Array.from(text || (kind === 'bug' ? '群聊问题反馈' : '群聊功能需求')).slice(0, 40).join(''), body }
}
