import type {NativePacket} from './packets'
import {extraHints} from './core'
export type HintPolicy={hint_source?:'legacy'|'ai'|'preset';preset_hint_trigger?:'cooldown'|'guesses';hint_cooldown_seconds?:number;auto_hint_increment?:number}
export function hintPolicy(b:Record<string,unknown>,every:number):Required<HintPolicy>{
 const source=b.hint_source??'legacy',trigger=b.preset_hint_trigger??'cooldown',seconds=b.hint_cooldown_seconds??30
 if(typeof source!=='string'||!['legacy','ai','preset'].includes(source)||typeof trigger!=='string'||!['cooldown','guesses'].includes(trigger)||typeof seconds!=='number'||!Number.isInteger(seconds)||seconds<1||seconds>86400)throw Error('请选择有效的线索来源、触发方式和1–86400秒冷却时间')
 if(source==='preset'&&b.auto_word)throw Error('仅自己出题时可选择预设线索规则')
 if(source==='preset'&&trigger==='guesses'&&!every)throw Error('按作答次数揭示预设线索时，间隔需为1–1000次')
 if(source==='preset'&&trigger==='cooldown'&&every)throw Error('预设冷却模式不能同时配置猜测次数触发')
 const increment=b.auto_hint_increment===undefined?0:b.auto_hint_increment
 if(typeof increment!=='number'||!Number.isInteger(increment)||increment<0||increment>1000||increment>0&&!every)throw Error('递增间隔需为0–1000次，并开启按作答次数提供线索')
 return {hint_source:source as Required<HintPolicy>['hint_source'],preset_hint_trigger:trigger as Required<HintPolicy>['preset_hint_trigger'],hint_cooldown_seconds:seconds,auto_hint_increment:increment}
}
export const publicHintPolicy=(p:HintPolicy)=>({hint_source:p.hint_source||'legacy',preset_hint_trigger:p.preset_hint_trigger||'cooldown',hint_cooldown_seconds:p.hint_cooldown_seconds||30,auto_hint_increment:p.auto_hint_increment||0})

export const stageHintAt=(ordinal:number,every:number,increment=0)=>ordinal*every+ordinal*(ordinal-1)*increment/2
export function isStageBoundary(n:number,every:number,increment=0){
 if(n<=0||every<=0)return false
 if(!increment)return n%every===0
 const ordinal=Math.round((-(2*every-increment)+Math.sqrt((2*every-increment)**2+8*increment*n))/(2*increment))
 return ordinal>0&&stageHintAt(ordinal,every,increment)===n
}

export function nextStageHintAt(p:Pick<NativePacket,'generated'|'auto_hint_every'|'hints_revealed'|'extra_hints_json'>&HintPolicy):number|null{
 if(!p.auto_hint_every)return null
 if(p.hint_source==='preset')return p.preset_hint_trigger==='guesses'?stageHintAt(p.hints_revealed+1,p.auto_hint_every,p.auto_hint_increment):null
 if(!p.generated&&p.hint_source!=='ai')return null
 const published=(p.generated?p.hints_revealed:0)+extraHints(p.extra_hints_json).filter(h=>h.source==='ai').length
 return stageHintAt(published+1,p.auto_hint_every,p.auto_hint_increment)
}
