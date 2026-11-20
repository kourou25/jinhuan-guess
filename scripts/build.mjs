import {requireTool,dependencyRoot} from './toolchain.mjs';
import {mkdirSync,cpSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const esbuild=requireTool('esbuild');
const shared={bundle:true,format:'esm',platform:'browser',target:'es2022',nodePaths:[dependencyRoot],external:['cloudflare:*','node:*'],logLevel:'warning'};
const builtins=['crypto','util','url','https','http','net','tls','assert','stream','buffer','events','zlib'];
const shim=builtins.map(n=>`import * as builtin_${n} from 'node:${n}';`).join('\n')+'\nconst require=(id)=>{switch(id.replace(/^node:/,"")){'+builtins.map(n=>`case '${n}':return builtin_${n}.default??builtin_${n};`).join('')+'default:throw Error("Unsupported builtin "+id)}};';
const worker={...shared,platform:'browser',external:[...shared.external,...builtins],conditions:['workerd','worker','browser'],banner:{js:shim}};
mkdirSync('.build',{recursive:true});mkdirSync('dist/client',{recursive:true});
cpSync('app/public','dist/client',{recursive:true});
await esbuild.build({...worker,entryPoints:['standalone/worker.ts'],outfile:'.build/standalone-worker.mjs'});
// Preserve exact original bundler entry name required by the existing test fixtures.
mkdirSync('app/web/dist/meme_hall',{recursive:true});
await esbuild.build({...worker,stdin:{contents:"import worker_entry_default from './app/src/worker'; export {worker_entry_default as default};",resolveDir:resolve('.'),sourcefile:'original-test-entry.ts'},outfile:'app/web/dist/meme_hall/index.js'});
const originalFile='app/web/dist/meme_hall/index.js';let originalBundle=readFileSync(originalFile,'utf8');originalBundle=originalBundle.replace(/export \{\s*(\w+) as default\s*\};/,(_,name)=>`var worker_entry_default=${name};\nexport { worker_entry_default as default };\n`);writeFileSync(originalFile,originalBundle);
await esbuild.build({...shared,entryPoints:['app/web/src/main.tsx'],outfile:'dist/client/admin/app.js',jsx:'automatic',alias:{'@shared':resolve('app/src/shared')},define:{'process.env.NODE_ENV':'"production"'}});
for(const ext of ['js','css'])cpSync('standalone/entry.'+ext,'dist/client/standalone-entry.'+ext);
cpSync('standalone/ui.css','dist/client/standalone-ui.css');
const uiVersion=JSON.parse(readFileSync('package.json','utf8')).version;
const gameStyles='<link rel="stylesheet" href="/standalone-entry.css"><link rel="stylesheet" href="/game-app.css"><link rel="stylesheet" href="/standalone-ui.css?v='+uiVersion+'">';
const html=readFileSync('app/public/index.html','utf8').replace('</head>',gameStyles+'</head>').replace('</body>','<script type="module" src="/standalone-entry.js"></script></body>');writeFileSync('dist/client/index.html',html);
writeFileSync('dist/client/app.html',readFileSync('app/web/app.html','utf8').replace('/src/main.tsx','/admin/app.js').replace('</head>','<link rel="stylesheet" href="/admin/app.css">'+gameStyles+'</head>').replace('</body>','<script type="module" src="/standalone-entry.js"></script></body>'));
// Original test servers expect these paths. These are copies inside this project, never links to the original worktree.
cpSync('dist/client','app/web/dist/client',{recursive:true});
console.log('应用副本和隔离入口构建完成');
