import baseline from '../.build/shared/base';
import upgraded from '../app/src/worker';
import {settlePredictions} from '../app/src/ldc/predictions';
import {upgradedPaths,baselineHasPredictions} from '../.build/shared/paths';
import {cleanupSidebar} from '../app/src/games/sidebar-retention';
import {importHistoryWords} from '../app/src/games/word-library';
import type {Env} from '../app/src/env';
export default {
 async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const path=new URL(request.url).pathname;
  if(path.startsWith('/auth/guess/')||path.startsWith('/api/guess-sidebar/')||path.startsWith('/api/game-runtime/')||path==='/api/admin/guess-ai-signals'||path==='/api/game-word-library'||path==='/api/me/guess-ai'||path==='/api/guess-meme/random'||upgradedPaths.some((p:RegExp)=>p.test(path)))return upgraded.fetch(request,env,ctx);
  return baseline.fetch(request,env,ctx);
 },
 async scheduled(event:ScheduledController,env:Env,ctx:ExecutionContext){
  await baseline.scheduled(event,env,ctx);
  if(event.cron==='* * * * *'&&!baselineHasPredictions)await settlePredictions(env).catch(()=>console.error('guess_prediction_settlement_failed'));
  if(event.cron==='* * * * *')await cleanupSidebar(env).catch(()=>console.error('sidebar_retention_failed'));
  if(event.cron==='* * * * *')await importHistoryWords(env).catch(()=>console.error('game_word_history_import_failed'));
 }
};
