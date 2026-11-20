// Shared by the Worker and the lazily generated browser module.
export const TITLE_MAX_LEVEL=5200
export const TITLE_PITY=60
export const TITLE_STAGES=[1,10,50,100,300,800,1600,2600,4000,5200] as const
export const TITLE_STAGE_NAMES=['初遇','萌动','灵巧','共鸣','跃迁','巡游','星辉','幻境','盛典','永恒'] as const
export const titleStage=(level:number)=>Math.max(1,TITLE_STAGES.filter(n=>n<=Math.min(TITLE_MAX_LEVEL,level)).length)
export const titleChance=(finger:number)=>10+Math.max(0,Math.min(5,Math.trunc(finger)))*3
const rows=[
 ['newcomer','初见欢欢','带着好奇，开启新的故事','sprout','#659d83','#f1ce86','normal'],
 ['mona','莫奈之王','睡莲与湖光，画中漫游','lotus','#5e9b92','#d8a4ca','normal'],
 ['lace','夜绒蕾丝','紫夜天鹅与细绒花纹','swan','#655790','#dba6c1','SSR'],
 ['giant','几把大蕉','大香蕉队长，气势和快乐都拉满','banana','#d9a92f','#4c8ba2','normal'],
 ['worship','寄吧几拜','认真接梗，虔诚拜蕉','banana','#a57744','#e0c46c','normal'],
 ['muscle','筋肉欢欢','元气拳套与柔软猫爪','paw','#c17857','#efd77a','normal'],
 ['deepseek','鲸鱼娘','深海里的蓝色心动','whale','#488caf','#b6dcec','normal'],
 ['deepseekupgrade','鲸澜女仆','鲸蓝水纹里的温柔守候','whale','#486dad','#bda9dc','SSR'],
 ['maid','鲸眠女仆','深蓝裙摆里的温柔陪伴','whale','#497ca7','#accee2','SSR'],
 ['whalepunch','鲸拳出击','蓝色电光里的元气一拳','bolt','#4c8ebc','#f1cc68','SSR'],
 ['nightdevil','夜宴小恶魔','玫瑰与夜色里的俏皮心动','imp','#9a547e','#e8b0b3','SSR'],
 ['whalebuddy','鲸伴','小鲸一路同行，终有星海巡游','whale','#368bad','#b1daef','normal'],
 ['gpt','GPT龙姬','紫星白龙的灵感相伴','dragon','#8864b3','#c7dcb7','SSR'],
 ['claude','拾光司书','每次相遇，都留有光芒','flower','#b9824e','#efcfa1','SSR'],
 ['gemini','Gemini星喵','双星闪烁的小宇宙','star','#8571bd','#99c9da','SSR'],
 ['whitedragon','白龙绮姬','银发与绮花的优雅相逢','dragon','#698aa0','#d8cbe9','SSR'],
 ['rascal','纯坏蛋','偷走饼干的小恶魔，坏得很可爱','imp','#8461b1','#f0b278','normal'],
 ['weirdo','大变态','表情失控的怪趣布偶，专门制造笑场','mask','#c16d90','#8cc4ad','normal'],
 ['blacksilk','黑丝夜羽','黑天鹅的银线与夜色礼服','swan','#536586','#e6b1c7','SSR'],
 ['loli','萝莉糖星','全然童话的月兔魔法师与糖纸星星','bunny','#a083ba','#c3dbe9','normal'],
 ['electric','电光团子','圆滚滚的小电灵，越熟悉越活泼','bolt','#4a91aa','#eed47b','normal'],
 ['blade','刀·赤狐','赤狐守刀，落叶随行','blade','#b47054','#d9bc7d','normal'],
 ['spear','枪·青隼','长风穿云，青隼振翅','spear','#4d8a8c','#b6cdbb','normal'],
 ['sword','剑·流萤','银剑与流萤，共赴长夜','sword','#6d8eb4','#c8d5ee','SSR'],
 ['halberd','戟·玄鹿','山纹古戟，玄鹿守望','halberd','#9c794c','#bfd0b5','SSR'],
 ['snow','雪·绒绒','一团会打盹的雪，轻轻落下','snow','#709db4','#e0e7f2','normal'],
 ['moon','月·银兔','抱着月亮打盹的小银兔','moon','#9381b4','#e4d2a7','SSR'],
 ['wind','风·纸鸢','风带着纸鸢绕过你的肩头','wind','#5f9e8e','#d6e2ac','normal'],
 ['flower','花·春信','花苞醒来，寄出一封春天','flower','#bd789b','#afd0a1','normal'],
 ['sun','日·暖橘','太阳小狮子，暖意扑面','sun','#c8943d','#f2ca97','normal'],
 ['star','星·许愿','把星星揣进口袋，陪你闪光','star','#7c7eb9','#ecd39a','SSR'],
 ['cloud','云·软绵','云朵羊的慢悠悠天空旅行','cloud','#7dabb4','#d9c9e8','normal'],
] as const
export const TITLE_COLLECTION=rows.map(([id,name,mood,motif,color,accent,rarity])=>({id,name,mood,motif,color,accent,rarity,enabled:true,newcomer:id==='newcomer',limited:['blacksilk','sword','halberd','moon','star','nightdevil'].includes(id)}))
export type CollectionTitleId=typeof rows[number][0]
export const collectionTitle=(id:unknown)=>TITLE_COLLECTION.find(t=>t.id===id)
// UTC+8 two-week exhibits. All limited exhibits retain one shared pity counter.
export function titleExhibit(t:number){const period=Math.floor((t+28800)/(14*86400)),limited=TITLE_COLLECTION.filter(x=>x.limited),start=period*14*86400-28800;return {id:period,starts_at:start,ends_at:start+14*86400,titles:[limited[period%limited.length].id,limited[(period+1)%limited.length].id]}}
export const titleAvailable=(id:string,t:number)=>!collectionTitle(id)?.limited||titleExhibit(t).titles.includes(id as CollectionTitleId)
