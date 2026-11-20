import {existsSync,writeFileSync} from 'node:fs';import {randomBytes} from 'node:crypto';
if(!existsSync('.dev.vars'))writeFileSync('.dev.vars',`DEV_LOGIN_KEY="${randomBytes(24).toString('hex')}"\nLDC_ENCRYPTION_KEY="${randomBytes(32).toString('base64')}"\nPASSWORD_PEPPER="${randomBytes(32).toString('hex')}"\n`);
console.log('已准备独立本地密钥，保存在忽略文件 .dev.vars；未读取或复制原站密钥');
