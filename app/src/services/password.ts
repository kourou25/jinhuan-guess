// 密码算法与 pepper 只在 Worker 使用；前端只做输入校验，不导入本模块。
export const PASSWORD_ITERATIONS = 100000
const utf8 = new TextEncoder()
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

function checkPepper(pepper: string) {
  if (typeof pepper !== 'string' || pepper.length < 32) throw new Error('password_pepper_not_configured')
}
async function derive(password: string, pepper: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  checkPepper(pepper)
  const hmac = await crypto.subtle.importKey('raw', utf8.encode(pepper), {name:'HMAC',hash:'SHA-256'}, false, ['sign'])
  const mixed = await crypto.subtle.sign('HMAC', hmac, utf8.encode(password.normalize('NFKC')))
  const key = await crypto.subtle.importKey('raw', mixed, 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:PASSWORD_ITERATIONS},key,256))
}
export async function hashPassword(password: string, pepper: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${b64(salt)}$${b64(await derive(password,pepper,salt))}$p1`
}
export async function verifyPassword(password: string, stored: string, pepper: string): Promise<boolean> {
  checkPepper(pepper)
  const match = /^pbkdf2_sha256\$100000\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})\$p1$/.exec(stored)
  if (!match) return false
  let salt: Uint8Array<ArrayBuffer>, expected: Uint8Array<ArrayBuffer>
  try { salt = unb64(match[1]); expected = unb64(match[2]) } catch { return false }
  if (salt.length !== 16 || expected.length !== 32) return false
  const actual = await derive(password,pepper,salt)
  // Workers 提供常数时间比较；Node 的标准 WebCrypto 没有该扩展，用原生 HMAC verify。
  if (typeof crypto.subtle.timingSafeEqual === 'function') return crypto.subtle.timingSafeEqual(expected,actual)
  const message = utf8.encode('jinhuan-password-comparison-v1')
  const expectedKey = await crypto.subtle.importKey('raw',expected,{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const actualKey = await crypto.subtle.importKey('raw',actual,{name:'HMAC',hash:'SHA-256'},false,['verify'])
  return crypto.subtle.verify('HMAC',actualKey,await crypto.subtle.sign('HMAC',expectedKey,message),message)
}
