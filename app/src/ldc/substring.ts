import {normalizeAnswer} from './core'

type LiteralResult={verdict:'yes'|'no'|'unknown'|'not_question';text:string}
const numeral='[0-9零一二两三四五六七八九十]+'
const suffix='(?:这个|这几个|这两个|这段)?(?:字符串|汉字|字符|字母|词语|词组|字|词)'
const categories=new Set(['汉字','中文字','中文','英文','字母','数字','英文字母','简体字','繁体字','什么','啥'])
function number(text:string){
 if(/^\d+$/.test(text))return Number(text)
 if(text==='两')return 2
 if(!/^(?:[一二三四]?十[一二三四五六七八九]?|[一二三四五六七八九])$/u.test(text))return NaN
 const digit=(s:string)=>'零一二三四五六七八九'.indexOf(s)
 return text.includes('十')?((text.split('十')[0]?digit(text.split('十')[0]):1)*10+(text.split('十')[1]?digit(text.split('十')[1]):0)):digit(text)
}
function term(raw:string,allowBare:boolean){
 if(categories.has(raw))return null
 const quoted=/^(?:「([^」]+)」|“([^”]+)”|‘([^’]+)’|"([^"\r\n]+)"|'([^'\r\n]+)')(.*)$/u.exec(raw)
 if(quoted&&quoted[6]&&!new RegExp('^'+suffix+'$','u').test(quoted[6]))return null
 const typed=new RegExp('^(.+?)'+suffix+'$','u').exec(raw)
 const value=quoted?.slice(1,6).find(v=>v!==undefined)??typed?.[1]??(allowBare?raw:null)
 return value&&(!categories.has(value)||!!quoted)&&[...value].length<=40&&/^[\p{L}\p{N}\p{M}]+$/u.test(value)?normalizeAnswer(value):null
}
const yesno=(value:boolean,text='字词核验'):LiteralResult=>({verdict:value?'yes':'no',text:(value?'是。':'不是。')+' · '+text+'，不消耗 AI'})

// Only explicit text predicates are deterministic; semantic or compound questions stay with AI.
export function judgeLiteralQuestion(answers:string[],kind:string,question:string):LiteralResult|null{
 if(kind!=='question'||!answers.length)return null
 const answer=normalizeAnswer(answers[0]),chars=[...answer],raw=question.normalize('NFKC').trim()
 const call=/^substring\(\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)')\s*\)$/u.exec(raw)
 if(call){const needle=term('"'+(call[1]??call[2])+'"',false);return needle?{verdict:answer.includes(needle)?'yes':'no',text:(answer.includes(needle)?'包含。':'不包含。')+' · 字词核验，不消耗 AI'}:null}
 const explicit=/^(?:(?:这个|这道题的|这题的)?(?:答案|谜底))/u.test(raw)
 const q=raw.replace(/[?？。!！]+$/u,'').replace(/吗$|(?<!什)么$/u,'').trim().replace(/^(?:(?:这个|这道题的|这题的)?(?:答案|谜底))(?:文字|文本)?(?:的|里面|里|中)?/u,'')
 const position='(?:倒数第'+numeral+'|第'+numeral+'|最后一|最前一)(?:个)?(?:字|字符|字母)'
 if(new RegExp('^(?:'+position+'(?:是什么(?:字|字符|字母)?|是啥(?:字)?|是哪(?:个)?字)|(?:告诉我|说出)'+position+')$','u').test(q))return {verdict:'not_question',text:'请改为“第一个字是水吗”这样的判断题，不直接公布答案中的字。'}
 const length=new RegExp('^(?:一共|总共|共有|共)?(?:有|是)?('+numeral+')(?:个)?(?:字|字符|字母)$','u').exec(q)
 if(length&&explicit&&Number.isInteger(number(length[1])))return yesno(chars.length===number(length[1]),'字数核验')
 const pos=new RegExp('^(?:(倒数)?第('+numeral+')|(?:最)?(后一|前一))(?:个)?(?:字|字符|字母)(是不是|是否是|是否为|是否不是|不是|是|为)(.+)$','u').exec(q)
 if(pos){
  const needle=term(pos[5],true),n=pos[3]?1:number(pos[2]);if(!needle||[...needle].length!==1||!Number.isSafeInteger(n))return null
  if(n<1)return {verdict:'not_question',text:'字的位置从第一个字开始，请修改位置。'}
  const index=pos[1]||pos[3]==='后一'?chars.length-n:n-1
  if(index<0||index>=chars.length)return {verdict:'unknown',text:'该位置超出答案字数，请修改位置。'}
  return yesno(/^(?:不是|是否不是)$/u.test(pos[4])?chars[index]!==needle:chars[index]===needle,'字位核验')
 }
 const edge=/^(?:(开头|结尾)(是不是|是否是|是|不是)(.+)|以(.+)(开头|结尾))$/u.exec(q)
 if(edge&&explicit){const needle=term(edge[3]??edge[4],true);if(!needle)return null;const matches=(edge[1]??edge[5])==='开头'?answer.startsWith(needle):answer.endsWith(needle);return yesno(edge[2]==='不是'?!matches:matches)}
 const contains=/^(是否不包含|是否没有|不包含|不含有|不含|没有|有没有|包不包含|含不含|是否包含|是否含有|是否有|包含|含有|含|有)(.+)$/u.exec(q)
 if(!contains)return null
 const needle=term(contains[2],false);if(!needle)return null
 const negative=['是否不包含','是否没有','不包含','不含有','不含','没有'].includes(contains[1])
 return yesno(negative?!answer.includes(needle):answer.includes(needle))
}

export function answerSubstringQuestion(answers:string[],kind:string,question:string){return judgeLiteralQuestion(answers,kind,question)?.verdict??null}
