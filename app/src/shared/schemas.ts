import * as v from 'valibot'
// 本地常见弱口令拦截表；不向外部服务发送密码。
const WEAK=new Set(`12345678 123456789 1234567890 12345678910 123456789a 123456789q 123456789z 123456aa 123456ab 123456abc
password password1 password12 password123 password1234 password12345 password! password01 passw0rd passw0rd1
qwertyui qwertyuiop qwerty123 qwerty12345 qwerty12 qwerty11 qwerty99 qwerty88 qwerty01 qwerty!1
11111111 22222222 33333333 44444444 55555555 66666666 77777777 88888888 99999999 00000000
111111111 222222222 333333333 444444444 555555555 666666666 777777777 888888888 999999999 000000000
abcdefgh abcdefghi abcdefghij abcd1234 abc12345 abc123456 abc1234567 abc12345678 abc123456789 abcd12345
iloveyou iloveyou1 iloveyou2 iloveyou123 1q2w3e4r 1q2w3e4r5t 1qaz2wsx 1qazxsw2 qazwsxed zaq12wsx
letmein1 welcome1 welcome123 admin123 admin1234 admin12345 administrator rootroot changeme changeme1
sunshine football baseball princess superman dragon123 computer internet whatever trustno1
123123123 12341234 12121212 11223344 12344321 87654321 987654321 9876543210 52013140 13145200`.split(/\s+/))
const RESERVED=new Set(['admin','administrator','system','root','jinhuan_ai','ai','moderator','support','official','null','undefined'])
export function emailInput(value:unknown):string{
 const result=v.safeParse(v.pipe(v.string(),v.transform(x=>x.trim().normalize('NFKC').toLowerCase()),v.maxLength(254),v.regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/)),value)
 if(!result.success)throw new Error('邮箱格式不对')
 return result.output
}
export function handleInput(value:unknown,owners:string[]=[]):string{
 if(typeof value!=='string')throw new Error('这个用户名不能用')
 const handle=value.trim(),lower=handle.toLowerCase()
 if(!/^[A-Za-z0-9_][A-Za-z0-9_.-]{1,18}[A-Za-z0-9_]$/.test(handle)||/^u?\d+$/i.test(handle)||RESERVED.has(lower)||owners.some(x=>x.toLowerCase()===lower))throw new Error('这个用户名不能用')
 return handle
}
export function passwordInput(value:unknown,email:string,handle=''):string{
 if(typeof value!=='string')throw new Error('密码需要 8～128 个字符')
 const password=value.normalize('NFKC'),length=[...password].length,lower=password.toLowerCase()
 if(length<8||length>128)throw new Error('密码需要 8～128 个字符')
 if(lower===email.toLowerCase()||(handle&&lower===handle.toLowerCase()))throw new Error('密码不能与邮箱或用户名相同')
 if(WEAK.has(lower))throw new Error('这个密码过于常见，请换一个')
 return password
}
export function turnstileInput(value:unknown):string{
 if(typeof value!=='string'||!value||value.length>2048)throw new Error('请先完成人机验证')
 return value
}
export function invitationInput(value:unknown,required=false):string{
 if(value===undefined||value===''){if(required)throw new Error('请填写邀请码');return ''}
 if(typeof value!=='string')throw new Error('邀请码格式不对')
 const code=value.trim().toUpperCase()
 if(!/^[A-HJ-NP-Z2-9]{8}$/.test(code))throw new Error('邀请码格式不对')
 return code
}
export function registrationInput(body:Record<string,unknown>,owners:string[],required:boolean){
 const email=emailInput(body.email),handle=handleInput(body.handle,owners)
 if(body.nick!==undefined&&typeof body.nick!=='string')throw new Error('昵称格式不对')
 return {email,handle,password:passwordInput(body.password,email,handle),nick:[...(String(body.nick??'').replace(/\s+/g,' ').trim())].slice(0,20).join(''),invite:invitationInput(body.invite,required),turnstile:turnstileInput(body.turnstile)}
}
