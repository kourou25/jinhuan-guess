// Adapt only the transport namespace. Original auth/session/OAuth code is unchanged.
export function cookiePrefix(url:URL){return url.protocol==='https:'?'__Host-cc_':'cc_local_'}
export function incomingCookies(header:string,url:URL){const prefix=cookiePrefix(url);return header.split(';').map(s=>s.trim()).filter(s=>s.startsWith(prefix)).map(s=>s.slice(prefix.length)).join('; ')}
export function outgoingCookie(header:string,url:URL){return cookiePrefix(url)+header.replace(/;\s*Domain=[^;]*/gi,'').replace(/;\s*Path=[^;]*/gi,'')+'; Path=/'+(url.protocol==='https:'&&!/;\s*Secure/i.test(header)?'; Secure':'')}
