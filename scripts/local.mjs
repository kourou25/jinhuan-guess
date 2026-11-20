import {spawnSync} from 'node:child_process';import {dependencyRoot} from './toolchain.mjs';
if(process.argv[2]==='migrate'){
 const inspect=spawnSync(process.execPath,[dependencyRoot+'/wrangler/bin/wrangler.js','d1','execute','guess-standalone-local','--local','--command',"SELECT name FROM pragma_table_info('guess_prediction_pools') WHERE name IN('ldc_mode','next_check_at') UNION ALL SELECT name FROM sqlite_master WHERE name IN('guess_fish_pools','guess_fish_orders','guess_fish_orders_due','guess_fish_capacity_insert','guess_fish_capacity_update','guess_fish_room_update','guess_prediction_room_update')",'--json'],{encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 if(inspect.status!==0){process.stderr.write(inspect.stderr||'本地迁移检查失败');process.exit(1)}
 const rows=JSON.parse(inspect.stdout).flatMap(r=>r.results||[]);
 if(rows.length===9){console.log('迁移004已完整应用，跳过重复执行。');process.exit(0)}
 if(rows.length){console.error('检测到不完整的004迁移，请核对本地数据库，未重复执行。');process.exit(1)}
 const result=spawnSync(process.execPath,[dependencyRoot+'/wrangler/bin/wrangler.js','d1','execute','guess-standalone-local','--local','--file=standalone/migration-004.sql'],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});process.exit(result.status??1);
}
const action=process.argv[2];const args=action==='init'?['d1','execute','guess-standalone-local','--local','--file=app/schema.sql']:action==='seed'?['d1','execute','guess-standalone-local','--local','--file=standalone/local-seed.sql']:action==='dev'?['dev','--local','--ip','127.0.0.1','--port','8799','--test-scheduled']:null;
if(!args)throw Error('只允许独立本地操作');
const result=spawnSync(process.execPath,[dependencyRoot+'/wrangler/bin/wrangler.js',...args],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});process.exit(result.status??1);
