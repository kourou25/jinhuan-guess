import {registerHooks,createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {dependencyRoot} from './toolchain.mjs';
const require=createRequire(pathToFileURL(dependencyRoot+'/../package.json'));
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('/')&&!specifier.includes('..'))return {url:new URL('../app/public'+specifier,import.meta.url).href,shortCircuit:true};try{return next(specifier,context)}catch(error){if(specifier.startsWith('.')||specifier.startsWith('/')||specifier.includes(':'))throw error;return {url:pathToFileURL(require.resolve(specifier)).href,shortCircuit:true}}},load(url,context,next){const result=next(url,context);if(url.includes('/app/tests/cases/')&&url.endsWith('.mjs'))return {...result,source:String(result.source).replaceAll("compatibilityDate:'2025-09-01',d1Databases:","compatibilityDate:'2025-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:")};return result;}});
