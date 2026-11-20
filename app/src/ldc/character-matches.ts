export function characterMatches(guess:string,answer:string):('correct'|'present'|'none')[]{
 const normalize=(text:string)=>text.normalize('NFKC').toLocaleLowerCase('en').replace(/[\s\p{P}\p{Z}]/gu,'');
 const target=[...normalize(answer)],letters=new Set(target);let position=0;
 return [...guess].map(char=>{
  const normalized=[...normalize(char)],at=position;position+=normalized.length;
  if(!normalized.length||!normalized.every(c=>/[\p{L}\p{N}]/u.test(c)))return 'none';
  if(normalized.every((c,i)=>target[at+i]===c))return 'correct';
  return normalized.every(c=>letters.has(c))?'present':'none';
 });
}
