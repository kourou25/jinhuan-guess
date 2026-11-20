// 暂时下线；只控制展示和新增操作，历史记录与资源保留。
export const DISABLED_RAFFLE_TITLES: readonly string[] = []
export const raffleTitleEnabled = (id: string | null) => !!id && !DISABLED_RAFFLE_TITLES.includes(id)
export const enabledRaffleSql = (column: 'title' | 'r.title' = 'title') => DISABLED_RAFFLE_TITLES.length
  ? `${column} NOT IN (${DISABLED_RAFFLE_TITLES.map(id => "'" + id.replaceAll("'", "''") + "'").join(',')})` : '1=1'
