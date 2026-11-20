export const OFFICIAL_TITLES = [
  { id: 'serene', name: '欢欢入圣', mood: '万物看遍，心如止水' },
  { id: 'gentleman', name: '正人君子', mood: '表面正经，心跳失控' },
  { id: 'coder', name: '挂卖不卖', mood: '脚本一开，万事好办' },
  { id: 'banana', name: '一根几把', mood: '蕉个朋友，贴贴就好' },
  { id: 'peach', name: '摸摸柰子', mood: '心动很大，脸红一下' },
  { id: 'oracle', name: '最懂AI之人', mood: '模型万千，尽在掌握' },
  { id: 'whale', name: '大肥鱼看鱼片', mood: '鲸娘出没，深度心动' },
  { id: 'diver', name: '潜入深海', mood: '一言不发，一条不落' },
  { id: 'reborn', name: '重生归来', mood: '王者归来，再燃一次' },
] as const
export const officialTitleId = (id: unknown) => typeof id === 'string' && OFFICIAL_TITLES.some(t => t.id === id) ? id : undefined
