export const GUESS_REWARDS=[
 {id:'guess1',level:1,wins:1,name:'猜词新星',symbol:'✧'},
 {id:'guess2',level:2,wins:3,name:'识词达人',symbol:'✦'},
 {id:'guess3',level:3,wins:10,name:'灵感猎手',symbol:'✥'},
 {id:'guess4',level:4,wins:30,name:'谜语大师',symbol:'✺'},
 {id:'guess5',level:5,wins:100,name:'猜词王者',symbol:'✷'},
] as const
export const guessReward=(id:unknown)=>GUESS_REWARDS.find(r=>r.id===id)
